import { icon } from './icons.js';
import { COLORS, MAPS, BUILT_INS, clone, uid, emptyState, createMiragePreset, validateState } from './presets.js';

const $ = (q, root = document) => root.querySelector(q);
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const storage = { get(k, fallback) { try { return JSON.parse(localStorage.getItem(k)) ?? fallback; } catch { return fallback; } }, set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch { return false; } } };
const saved = storage.get('tactic-draft-v1', null);
let state = validateState(saved) ? saved : createMiragePreset();
const storedPresets = storage.get('tactic-presets-v1', []);
let presets = Array.isArray(storedPresets) ? storedPresets.filter(p => p && typeof p.id === 'string' && typeof p.name === 'string' && validateState(p.state)) : [];
let history = [], future = [], inputGroup = null, tool = 'select', selectedPlayer = 0, activePreset = 'mirage-a', selectedElement = null;
let roomId = new URLSearchParams(location.search).get('room')?.toUpperCase() || null;
let ownerToken = roomId ? storage.get(`tactic-owner-${roomId}`, null) : null;
let revision = 0, stream, viewers = 0, connected = false, loading = !!roomId, unavailable = false;
let dirty = false, saving = false, inFlightState = null, saveTimer, toastTimer, localVersion = 0, camera = { x: 0, y: 0, size: 1000 }, gesture = null;
const editable = () => !loading && !unavailable && (!roomId || !!ownerToken);
const phase = () => state.phases[state.phaseIndex];
const money = n => '$' + Number(n).toLocaleString('en-US');
const TOOL_NAMES = { select: ['cursor', '选择 / 移动', 'V'], pan: ['hand', '平移地图', 'H'], route: ['route', '进攻路线', 'A'], pen: ['pen', '自由绘画', 'P'], smoke: ['smoke', '烟雾弹', 'S'], flash: ['flash', '闪光弹', 'F'], fire: ['fire', '燃烧弹', 'M'], grenade: ['grenade', '高爆手雷', 'G'], player: ['player', '队员位置', '1–5'], text: ['tag', '文字标注', 'T'], eraser: ['eraser', '删除标记', 'E'] };

function shell() {
  $('#app').innerHTML = `
    <header class="topbar">
      <a class="brand" href="/" aria-label="TACTIC 战术室首页"><span class="brand-mark">T<span></span></span><span>TACTIC<span class="brand-sub">CS2 TEAM PLAYBOOK</span></span></a>
      <div class="top-breadcrumb"><span>作战空间</span>${icon('chevron', 14)}<strong>战术指挥室</strong><span class="beta-badge">BETA</span></div>
      <div class="top-actions"><div id="connection"></div><button class="icon-button" data-action="help" title="操作指南" aria-label="操作指南">${icon('help')}</button><span class="top-divider"></span><span class="commander-avatar">IGL</span></div>
    </header>
    <div class="app-layout">
      <aside class="sidebar">
        <div class="workspace-label"><span class="tiny-square"></span> YOUR TEAM, YOUR CALL.</div>
        <button class="nav-item active" data-action="board">${icon('board')}<span>战术指挥室</span><span class="nav-live"></span></button>
        <button class="nav-item" data-action="library">${icon('book')}<span>战术资料库</span><span class="count-badge" id="preset-count"></span></button>
        <div class="sidebar-section"><span>战术预设</span><button class="tiny-button" data-action="new" title="新建空白战术" aria-label="新建空白战术">${icon('plus', 16)}</button></div>
        <div class="preset-filters"><button class="filter-chip active" data-filter="all">全部</button><button class="filter-chip" data-filter="mine">我的战术</button></div>
        <div id="preset-list" class="preset-list"></div>
        <button class="new-preset" data-action="save-preset">${icon('plus', 17)} 保存当前为预设</button>
        <div class="sidebar-footer"><div class="pause-tip">${icon('clock', 18)}<div><strong>暂停 30 秒，计划一整局。</strong><span>少一点犹豫，多一点配合。</span></div></div><button class="sidebar-help" data-action="help">${icon('help', 15)} 操作与快捷键 <span>?</span></button><div class="version-label"><span class="status-dot"></span> TACTIC WORKSPACE <span>v1.0</span></div></div>
      </aside>
      <main class="main-workspace">
        <section class="workspace-heading"><div><div class="eyebrow"><span class="lime-dash"></span> THE NEXT ROUND STARTS HERE</div><h1>战术指挥室<span class="title-dot">.</span></h1></div><div class="heading-actions"><button class="button secondary mobile-library" data-action="library" aria-label="打开战术资料库" title="战术资料库">${icon('book',17)}</button><button class="button secondary" data-action="save-preset">${icon('save', 17)}<span>保存战术</span></button><button class="button primary" data-action="share">${icon('link', 17)}<span id="share-label">创建共享房间</span>${icon('arrow', 16)}</button></div></section>
        <div id="room-banner" hidden></div>
        <section class="workspace-content">
          <div class="board-column">
            <div class="board-topline"><div class="map-picker">${icon('map', 18)}<select id="map-select" aria-label="选择地图">${Object.entries(MAPS).map(([k,m])=>`<option value="${k}">${m.en} / ${m.name}</option>`).join('')}</select></div><div class="side-switch"><button data-side="T">T <span>进攻方</span></button><button data-side="CT">CT <span>防守方</span></button></div><button class="icon-button small" data-action="upload-map" title="上传自定义雷达图" aria-label="上传自定义雷达图">${icon('image',18)}</button><button class="icon-button small" data-action="focus" title="专注模式" aria-label="切换专注模式">${icon('expand', 17)}</button></div>
            <div class="tactic-name-row"><div class="tactic-label"><span class="tactic-indicator"></span><input id="tactic-title" maxlength="80" aria-label="战术名称"></div><span id="board-save-status" class="save-state"></span></div>
            <div class="map-stage" id="map-stage">
              <div class="map-grid"></div><div class="map-watermark">TACTIC <span>LIVE BOARD</span></div>
              <div class="map-meta"><span id="map-label"></span><span class="map-coordinate">N ↑</span></div>
              <div class="drawing-toolbar" id="drawing-toolbar"></div>
              <svg id="tactical-map" viewBox="0 0 1000 1000" xmlns="http://www.w3.org/2000/svg" aria-label="CS2 交互战术地图" role="img"><defs><filter id="token-shadow"><feDropShadow dx="0" dy="2" stdDeviation="4" flood-opacity=".7"/></filter></defs><image id="radar-image" x="0" y="0" width="1000" height="1000" preserveAspectRatio="xMidYMid meet"/><g id="map-labels" pointer-events="none"></g><g id="map-elements"></g><g id="drawing-preview"></g></svg>
              <div id="viewer-tag" class="viewer-tag" hidden>${icon('eye', 14)} 队友视角 · 实时同步</div>
              <div class="board-zoom"><button class="icon-button small" data-action="zoom-out" title="缩小" aria-label="缩小地图">${icon('minus',16)}</button><button class="zoom-value" data-action="zoom-reset" title="重置缩放" id="zoom-value">100%</button><button class="icon-button small" data-action="zoom-in" title="放大" aria-label="放大地图">${icon('plus',16)}</button></div>
              <div class="board-history"><button class="icon-button small" data-action="undo" title="撤销 (Ctrl/⌘ Z)" aria-label="撤销">${icon('undo',18)}</button><button class="icon-button small" data-action="redo" title="重做 (Ctrl/⌘ Shift Z)" aria-label="重做">${icon('redo',18)}</button><span></span><button class="icon-button small danger-hover" data-action="clear" title="清空当前阶段标记" aria-label="清空当前阶段标记">${icon('trash',17)}</button></div>
              <div class="map-sourcelabel">CS2 RADAR · 战术示意，非精确投掷教学</div>
            </div>
            <div class="board-footer"><div class="player-palette" id="player-palette"></div><div class="tool-hint" id="tool-hint"></div></div>
            <div class="phases-wrap"><div class="section-heading"><span>${icon('route', 15)} 执行阶段</span><button class="text-button" data-action="add-phase">${icon('plus', 14)} 添加阶段</button></div><div class="phase-list" id="phase-list"></div></div>
            <div class="callout"><span class="callout-icon">${icon('crosshair', 19)}</span><div><label for="team-notes">指挥备忘 <span>THE CALL</span></label><textarea id="team-notes" rows="2" maxlength="2000" placeholder="写下这次进攻的关键：何时爆弹、谁先出、包下哪里…"></textarea></div></div>
          </div>
          <aside class="team-panel"><div class="team-panel-heading"><div><span class="eyebrow">FIVE PLAYERS. ONE PLAN.</span><h2>队伍部署 <span>5</span></h2></div>${icon('users',22)}</div><div class="economy-bar"><div><span>团队当前经济</span><strong id="team-money"></strong></div><select id="round-type" aria-label="本局购买策略"><option value="full">全起局</option><option value="force">强起局</option><option value="eco">经济局</option></select></div><div class="round-control"><label for="round-number">当前回合</label><span>ROUND <input id="round-number" type="number" min="1" max="99" aria-label="当前回合数"></span></div><div class="players-list" id="players-list"></div><div class="team-footnote">${icon('shield', 14)} 经济和装备由指挥手动填写，不读取游戏数据。</div></aside>
        </section>
        <footer class="app-footer"><span>PLAN TOGETHER. WIN TOGETHER.</span><div><span class="legend-dot smoke-dot"></span>烟雾 <span class="legend-dot flash-dot"></span>闪光 <span class="legend-dot fire-dot"></span>燃烧 <button class="text-button" data-action="export">${icon('download', 13)} 导出</button><button class="text-button" data-action="import">${icon('upload', 13)} 导入</button></div></footer>
      </main>
    </div>`;
  bindEvents();
}

let presetFilter = 'all';
function renderPresets() {
  const mine = presets.map(p=>({ ...p, mine:true, map:p.state.map, tag:'我的战术', difficulty:`${p.state.phases.length} 个执行阶段` }));
  const list = presetFilter === 'mine' ? mine : [...BUILT_INS, ...mine];
  $('#preset-count').textContent = BUILT_INS.length + presets.length;
  $('#preset-list').innerHTML = list.length ? list.map(p=>`<div class="preset-item ${p.id===activePreset?'selected':''}"><button class="preset-main" data-preset="${esc(p.id)}"><span class="preset-map-art map-art-${p.map}"><b>${MAPS[p.map].letter}</b><span>${MAPS[p.map].en}</span></span><span class="preset-details"><strong>${esc(p.name)}</strong><span>${MAPS[p.map].en}<i>·</i>${esc(p.tag)}</span><small>${esc(p.difficulty)}</small></span>${p.id===activePreset?'<span class="preset-active-dot"></span>':''}</button>${p.mine?`<button class="preset-delete" data-delete-preset="${esc(p.id)}" title="删除预设" aria-label="删除 ${esc(p.name)}">${icon('close',13)}</button>`:''}</div>`).join('') : '<div class="empty-presets">还没有自定义战术。<br>画好战术后，点击下方保存。</div>';
}
function render() {
  if(gesture) cancelGesture();
  $('#map-select').value = state.map;
  $('#tactic-title').value = state.title;
  $('#team-notes').value = state.notes;
  $('#round-type').value = state.roundType;
  $('#round-number').value = state.round;
  $('#map-label').innerHTML = `<b>${MAPS[state.map].en}</b> / ${state.customMap ? '自定义雷达' : esc(MAPS[state.map].name)}`;
  $('#radar-image').setAttribute('href', state.customMap?.data || MAPS[state.map].image);
  const anchors = {
    mirage: [['A',545,763],['B',230,282],['T 出生',880,360],['CT 出生',288,698],['中路',560,455],['A1',728,622],['宫殿',785,762],['拱门',485,570],['B 小',430,330]],
    inferno: [['A',812,680],['B',485,220],['T 出生',100,668],['CT 出生',893,352],['中路',540,785],['香蕉道',455,455]],
    dust2: [['A',796,168],['B',207,127],['T 出生',390,895],['CT 出生',605,207],['中路',478,455],['A 大',880,450],['A 小',620,368]],
  };
  $('#map-labels').innerHTML = state.customMap ? '' : anchors[state.map].map(([label,x,y])=>`<text x="${x}" y="${y}" text-anchor="middle" dominant-baseline="middle" fill="${label.length===1?'#efd5a2':'#d0d5cc'}" font-family="sans-serif" font-weight="${label.length===1?800:500}" font-size="${label.length===1?35:17}" stroke="#131913" stroke-width="5" paint-order="stroke" opacity="${label.length===1?'.9':'.7'}">${label}</text>`).join('');
  document.querySelectorAll('[data-side]').forEach(b=>b.classList.toggle('active', b.dataset.side===state.side));
  renderToolbar(); renderElements(); renderPlayers(); renderPalette(); renderPhases(); renderPresets(); renderConnection();
  document.querySelectorAll('#tactic-title, #team-notes, #map-select, #round-type, #round-number, [data-side], [data-action="upload-map"], [data-action="add-phase"], [data-action="clear"]').forEach(el=>el.disabled=!editable());
  $('#viewer-tag').hidden = !roomId || !!ownerToken;
  $('#drawing-toolbar').hidden = !editable();
  $('#map-stage').classList.toggle('view-only', !editable());
  $('#tactical-map').style.cursor = !editable() ? 'grab' : tool==='select'?'default':tool==='eraser'?'not-allowed':'crosshair';
  $('[data-action="undo"]').disabled = !editable() || !history.length;
  $('[data-action="redo"]').disabled = !editable() || !future.length;
}
function renderToolbar() {
  $('#drawing-toolbar').innerHTML = Object.entries(TOOL_NAMES).map(([key,[ic,name,shortcut]],i)=>`${i===4||i===8?'<div class="toolbar-separator"></div>':''}<button class="tool-button ${tool===key?'active':''}" data-tool="${key}" aria-label="${name}" title="${name} (${shortcut})" aria-pressed="${tool===key}">${key==='text'?'<b class="text-tool">T</b>':icon(ic,19)}</button>`).join('');
  $('#tool-hint').innerHTML = editable() ? `<span class="hint-key">${esc(TOOL_NAMES[tool][2])}</span> ${tool==='select'?'拖动标记 · 滚轮缩放':tool==='pan'?'按住拖动，平移已放大的地图':tool==='route'?'按住拖动，画出进攻路线':tool==='player'?'点击地图，放置当前队员':tool==='eraser'?'点击标记即可删除':tool==='text'?'点击地图，添加文字':'点击放置 · 按住拖动画线'}` : `${icon('eye',14)} ${loading?'正在连接战术室…':'指挥布置，你来执行'}`;
}
function renderPalette() {
  $('#player-palette').innerHTML = `<span class="palette-label">当前队员</span>${state.players.map((p,i)=>`<button class="palette-player ${i===selectedPlayer?'active':''}" style="--player-color:${COLORS[i]}" data-player="${i}" title="${esc(p.name)} · 数字键 ${i+1}" aria-label="选择队员 ${i+1} ${esc(p.name)}"><span>${i+1}</span><b>${esc(p.name)}</b></button>`).join('')}`;
}
function renderPlayers() {
  $('#players-list').innerHTML = state.players.map((p,i)=>`<article class="player-card ${selectedPlayer===i?'selected':''}" style="--player-color:${COLORS[i]}"><div class="player-header"><button class="player-number" data-player="${i}" title="在地图中选择此队员">${String(i+1).padStart(2,'0')}</button><input class="player-name" data-field="name" data-index="${i}" value="${esc(p.name)}" maxlength="20" aria-label="队员 ${i+1} 名称" ${!editable()?'disabled':''}><input class="player-role" data-field="role" data-index="${i}" value="${esc(p.role)}" maxlength="30" aria-label="队员 ${i+1} 角色" ${!editable()?'disabled':''}></div><div class="player-economy"><label class="money-input"><span>$</span><input type="number" min="0" max="16000" step="50" data-field="money" data-index="${i}" value="${p.money}" aria-label="${esc(p.name)} 当前经济" ${!editable()?'disabled':''}></label><select data-field="weapon" data-index="${i}" aria-label="${esc(p.name)} 主武器" ${!editable()?'disabled':''}>${['AK-47','M4A1-S','M4A4','AWP','Galil AR','FAMAS','MAC-10','MP9','SSG 08','Desert Eagle','P250','Glock / USP','无主武器'].map(w=>`<option ${p.weapon===w?'selected':''}>${w}</option>`).join('')}</select><div class="player-grenades">${['smoke','flash','fire','grenade'].map(g=>`<button class="grenade-toggle ${p.grenades.includes(g)?'equipped':''}" data-grenade="${g}" data-index="${i}" title="${TOOL_NAMES[g][1]}：${p.grenades.includes(g)?'已配备':'未配备'}" aria-label="${esc(p.name)} ${TOOL_NAMES[g][1]}" aria-pressed="${p.grenades.includes(g)}" ${!editable()?'disabled':''}>${icon(TOOL_NAMES[g][0],13)}</button>`).join('')}</div></div><div class="player-task"><span>任务</span><textarea rows="1" data-field="task" data-index="${i}" maxlength="200" aria-label="${esc(p.name)} 本局任务" placeholder="分配本局任务…" ${!editable()?'disabled':''}>${esc(p.task)}</textarea></div></article>`).join('');
  renderEconomy();
}
function renderEconomy() { $('#team-money').textContent = money(state.players.reduce((sum,p)=>sum+p.money,0)); }
function renderPhases() {
  $('#phase-list').innerHTML = state.phases.map((p,i)=>`<button class="phase-tab ${state.phaseIndex===i?'active':''}" data-phase="${i}" title="${editable()?'双击重命名阶段':''}"><span>${String(i+1).padStart(2,'0')}</span><strong>${esc(p.name)}</strong>${state.phaseIndex===i?icon('chevron',14):''}</button>`).join('') + (editable()&&state.phases.length>1?`<button class="phase-remove" data-action="remove-phase" title="删除当前阶段" aria-label="删除当前阶段">${icon('trash',15)}</button>`:'');
}
function renderConnection() {
  const label = loading?'连接中':unavailable?'房间不可用':roomId?(connected?'实时同步': '正在重连'):'本地草稿';
  $('#connection').innerHTML = `<span class="connection-state ${connected?'online':unavailable?'error':''}"><span class="status-dot"></span>${label}${roomId&&!unavailable?`<span class="connection-count">${icon('users',13)} ${viewers}</span>`:''}</span>`;
  $('#share-label').textContent = roomId?'邀请队友':'创建共享房间';
  $('#board-save-status').innerHTML = saving?'<span class="status-dot"></span>同步中':dirty?'<span class="status-dot"></span>待同步':`${icon('check',12)} ${roomId?'已同步':'自动保存'}`;
  const banner = $('#room-banner');
  banner.hidden = !roomId;
  banner.className = `room-banner ${unavailable?'error':''}`;
  banner.innerHTML = unavailable ? `${icon('wifi',15)} <span>无法载入房间。房间可能不存在，或服务器暂时不可用。</span><button class="text-button" data-action="retry">重试</button><a class="text-button" href="/">返回本地战术板</a>` : `${icon(ownerToken?'wifi':'eye',15)}<span>房间 <b>${esc(roomId)}</b> · ${ownerToken?'你是指挥，编辑将实时同步给队友':'队友只读视角，指挥的最新布置会自动出现'}</span><button class="text-button" data-action="share">${icon('link',13)} 复制邀请链接</button>`;
}

function elementSVG(e, preview=false) {
  const selected = e.id===selectedElement&&!preview;
  const color = /^#[a-fA-F0-9]{6}$/.test(e.color)?e.color:COLORS[e.player];
  const attr = `data-element="${esc(e.id)}" class="map-element ${selected?'is-selected':''}"`;
  if(e.type==='route'||e.type==='pen') {
    if(!e.points?.length) return '';
    const points=e.points.map(p=>p.join(',')).join(' '), last=e.points.at(-1), prev=e.points.at(-2)||last;
    const angle=Math.atan2(last[1]-prev[1], last[0]-prev[0])*180/Math.PI;
    return `<g ${attr}><polyline points="${points}" fill="none" stroke="transparent" stroke-width="25" pointer-events="stroke"/><polyline points="${points}" fill="none" stroke="${color}" stroke-width="${e.type==='route'?5:4}" stroke-linecap="round" stroke-linejoin="round" ${e.type==='route'?'stroke-dasharray="11 7"':''} pointer-events="none"/>${e.type==='route'?`<path d="M-16-9 0 0-16 9" transform="translate(${last[0]} ${last[1]}) rotate(${angle})" fill="none" stroke="${color}" stroke-width="5" stroke-linecap="round" stroke-linejoin="round" pointer-events="none"/>`:''}${selected?`<polyline points="${points}" stroke="white" stroke-width="1" fill="none" opacity=".8" pointer-events="none"/>`:''}</g>`;
  }
  let inner='';
  if(e.type==='player') inner=`<circle r="22" fill="#111916" stroke="${color}" stroke-width="3" filter="url(#token-shadow)"/><circle r="16" fill="${color}"/><text y="5" text-anchor="middle" fill="#14200b" font-family="Arial,sans-serif" font-weight="800" font-size="17">${e.player+1}</text>`;
  if(e.type==='smoke') inner='<circle r="32" fill="#b3c4ad" fill-opacity=".24" stroke="#c2d5ba" stroke-width="2" stroke-dasharray="5 4"/><circle r="20" fill="#c3d1b8" fill-opacity=".22"/><path d="M-12 5c-10-5-4-14 3-12 0-8 13-9 16-1 12-1 13 14 3 14h-19" fill="none" stroke="#e0ead8" stroke-width="2.5"/>';
  if(e.type==='flash') inner='<circle r="21" fill="#e6d271" fill-opacity=".15" stroke="#eddc8d" stroke-width="1.5"/><path d="m3-15-13 18h9l-2 12L11-4H2z" fill="#f2df8c"/>';
  if(e.type==='fire') inner='<circle r="29" fill="#ff9f59" fill-opacity=".18" stroke="#ff9f59" stroke-width="1.5" stroke-dasharray="4 5"/><path d="M0-18c3 9-7 11-2 19 3-2 5-5 4-9 12 10 11 23-3 23s-15-15-7-22c-2 8 2 10 3 7-4-9 2-11 5-18" fill="#ffae6c"/>';
  if(e.type==='grenade') inner='<circle r="22" fill="#fc7c7c" fill-opacity=".2" stroke="#fc7c7c" stroke-width="1.5"/><circle cy="3" r="10" fill="#ed7a7a"/><path d="M-3-7v-6h8v6m-2-6h7v5" fill="none" stroke="#ffc9c9" stroke-width="2"/>';
  if(e.type==='text') inner=`<rect x="-6" y="-22" width="${Math.min(640,e.text.length*17+18)}" height="32" rx="5" fill="#141919" fill-opacity=".9" stroke="${color}"/><text x="3" y="1" fill="${color}" font-family="sans-serif" font-size="18" font-weight="600">${esc(e.text)}</text>`;
  return `<g ${attr} transform="translate(${e.x} ${e.y})">${selected?'<circle r="37" fill="none" stroke="white" stroke-width="1.5" stroke-dasharray="4 4"/>':''}${inner}</g>`;
}
function renderElements() { $('#map-elements').innerHTML = phase().elements.map(e=>elementSVG(e)).join(''); }
function toast(message, error=false) {
  clearTimeout(toastTimer); $('#toast').innerHTML=`${icon(error?'help':'check',17)}<span>${esc(message)}</span>`; $('#toast').className=`visible ${error?'error':''}`;
  toastTimer=setTimeout(()=>$('#toast').classList.remove('visible'),4000);
}
function commit(mutator, options={}) {
  if(!editable()) return;
  if(gesture) cancelGesture();
  if(!options.group || inputGroup !== options.group) { history.push(clone(state)); if(history.length>50) history.shift(); }
  inputGroup=options.group||null; future=[];
  mutator(state); selectedElement=null; localVersion++;
  persist();
  if(options.render!==false) render(); else { renderEconomy(); renderConnection(); $('[data-action="undo"]').disabled=false; $('[data-action="redo"]').disabled=true; }
}
function persist() {
  if(!roomId) { if(!storage.set('tactic-draft-v1',state)) toast('浏览器空间不足，请导出战术备份。',true); }
  else if(ownerToken) { dirty=true; clearTimeout(saveTimer); saveTimer=setTimeout(syncRoom,180); }
}
async function request(url, options={}) {
  const response=await fetch(url,{...options,headers:{'Content-Type':'application/json',...options.headers}});
  const data=await response.json().catch(()=>({error:'服务器返回异常'}));
  if(!response.ok) { const err=new Error(typeof data.error==='string'?data.error:'请求未成功'); err.status=response.status; err.data=data; throw err; }
  return data;
}
async function syncRoom() {
  if(saving||!dirty||!roomId||!ownerToken) return;
  saving=true; const sentVersion=localVersion, expected=revision; inFlightState=JSON.stringify(state); renderConnection();
  try {
    const result=await request(`/api/rooms/${roomId}`,{method:'PUT',headers:{Authorization:`Bearer ${ownerToken}`},body:`{"state":${inFlightState},"revision":${expected}}`});
    revision=Math.max(revision,result.revision); if(localVersion===sentVersion) dirty=false;
  } catch(err) {
    if(err.status===409&&validateState(err.data.state)) {
      // A concurrent commander tab won. Never silently overwrite their newer plan.
      state=err.data.state; revision=err.data.revision; dirty=false; history=[]; future=[]; render(); toast('另一指挥窗口更新了战术，已载入最新版本。',true);
    } else if(err.status===401||err.status===403) { ownerToken=null; dirty=false; toast('指挥权限失效，已切换为队友视角。',true); render(); }
    else { toast('暂未同步成功，连接恢复后会继续同步。',true); }
  } finally { saving=false; inFlightState=null; renderConnection(); if(dirty&&connected) {clearTimeout(saveTimer);saveTimer=setTimeout(syncRoom,1500);} }
}
function connectStream() {
  stream?.close(); stream=new EventSource(`/api/rooms/${roomId}/events`);
  stream.onopen=()=>{connected=true;renderConnection();if(dirty)syncRoom();};
  stream.onerror=()=>{connected=false;renderConnection();};
  stream.addEventListener('snapshot',event=>{
    try {
      const data=JSON.parse(event.data); if(!validateState(data.state)) throw new Error('无效战术数据');
      viewers=data.viewers??viewers;
      if(data.revision>revision) {
        const ownEcho = ownerToken && saving && JSON.stringify(data.state) === inFlightState;
        if (!ownEcho) {
          const hadPendingChanges = ownerToken && dirty;
          state=data.state; dirty=false; localVersion++; selectedElement=null; history=[];future=[]; render();
          if(hadPendingChanges) toast('另一指挥窗口更新了战术，已载入最新版本。',true);
        }
        revision=data.revision;
      }
      renderConnection();
    }catch{toast('收到无法识别的战术数据。',true);}
  });
  stream.addEventListener('presence',event=>{try{viewers=JSON.parse(event.data).viewers;renderConnection();}catch{}});
}
async function joinRoom() {
  loading=true; unavailable=false; render();
  try {
    if(!/^[A-Z0-9]{6}$/.test(roomId)) throw new Error('房间号格式错误');
    const data=await request(`/api/rooms/${roomId}`);
    if(!validateState(data.state)) throw new Error('战术数据格式不兼容');
    state=data.state; revision=data.revision; viewers=data.viewers||0; loading=false; unavailable=false; history=[];future=[];render();connectStream();
  }catch(err){loading=false;unavailable=true;render();toast(err.message==='Failed to fetch'?'无法连接服务器，请检查网络。':err.message,true);}
}
function modal(title, content, actions=[], options={}) {
  const root=$('#modal-root'); const previous=document.activeElement;
  root.innerHTML=`<div class="modal-backdrop"><section class="modal ${options.wide?'wide':''}" role="dialog" aria-modal="true" aria-labelledby="modal-title"><header><div><span class="eyebrow">TACTIC WORKSPACE</span><h2 id="modal-title">${esc(title)}</h2></div><button class="icon-button" data-close-modal aria-label="关闭弹窗">${icon('close')}</button></header><div class="modal-content">${content}</div><footer>${actions.map((a,i)=>`<button class="button ${a.primary?'primary':a.danger?'danger':'secondary'}" data-modal-action="${i}">${a.icon?icon(a.icon,16):''}${esc(a.label)}</button>`).join('')}</footer></section></div>`;
  const close=()=>{root.innerHTML='';document.removeEventListener('keydown',trap);previous?.focus();};
  const trap=e=>{if(e.key==='Escape')close();if(e.key==='Tab'){const els=[...root.querySelectorAll('button,input,textarea,select,a[href]')].filter(e=>!e.disabled);if(!els.length)return;const first=els[0],last=els.at(-1);if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}}};
  document.addEventListener('keydown',trap);
  root.onclick=e=>{if(e.target.closest('[data-close-modal]')||e.target.classList.contains('modal-backdrop'))close();const b=e.target.closest('[data-modal-action]');if(b){const action=actions[Number(b.dataset.modalAction)];if(action?.run)action.run(close,b);else close();}};
  setTimeout(()=>root.querySelector('input,textarea,button[data-modal-action]')?.focus(),20);
  return close;
}
function confirmAction(title, message, action, label='确认') { modal(title,`<p class="modal-description">${esc(message)}</p>`,[{label:'取消'},{label,danger:true,run:close=>{close();action();}}]); }
async function copyText(text) {
  try { if(!navigator.clipboard)throw new Error(); await navigator.clipboard.writeText(text); toast('邀请链接已复制，发给队友即可。'); }
  catch {const input=$('#invite-link');input?.focus();input?.select();toast('请手动复制已选中的邀请链接。');}
}
function showShare() {
  if(loading||unavailable) {toast('请先连接有效房间。',true);return;}
  if(roomId) {
    const link=new URL(location.href);link.search='';link.searchParams.set('room',roomId);link.hash='';
    modal('让队友看到你的下一步',`<div class="share-illustration">${icon('users',35)}<span class="status-dot"></span><strong>${esc(roomId)}</strong></div><p class="modal-description">把链接发给队友。无需注册，打开即可实时查看地图、道具和自己的分工。</p><label class="form-label" for="invite-link">队友邀请链接 · 只读权限</label><input class="form-input mono" id="invite-link" readonly value="${esc(link.href)}"><div class="info-box">${icon('shield',17)}<span>指挥权限仅保存在创建房间的浏览器中，邀请链接不包含编辑密钥。${['localhost','127.0.0.1','::1'].includes(location.hostname)?'<br><b>当前是本机地址。请用服务器的局域网 IP 或部署后的公网域名打开，再分享链接。</b>':''}</span></div>`,[{label:'完成'},{label:'复制邀请链接',primary:true,icon:'link',run:()=>copyText(link.href)}]);
  } else {
    modal('把战术板变成共享战术室',`<div class="share-illustration">${icon('wifi',40)}<span class="share-line"></span>${icon('users',40)}</div><p class="modal-description">创建房间后，你继续担任指挥。所有队友通过同一个链接，就能实时看到你的战术布置。</p><div class="share-features"><span>${icon('check',15)} 无需注册</span><span>${icon('check',15)} 实时同步</span><span>${icon('check',15)} 队友只读</span></div><div class="info-box">${icon('help',17)}<span>同局域网可直接使用；异地队友需要把服务部署到可访问的公网服务器。房间链接请只发给自己的队伍。</span></div>`,[{label:'暂不创建'},{label:'创建并获取链接',primary:true,icon:'link',run:async(close,button)=>{
      button.disabled=true;button.textContent='创建中…';
      const createdVersion=localVersion;
      try{
        const data=await request('/api/rooms',{method:'POST',body:JSON.stringify({state})});
        roomId=data.roomId;ownerToken=data.ownerToken;revision=data.revision;dirty=localVersion!==createdVersion;
        if(!storage.set(`tactic-owner-${roomId}`,ownerToken)) toast('浏览器存储不可用：刷新会丢失指挥权限，请先导出战术备份。',true);
      }catch(err){button.disabled=false;button.textContent='重试创建';toast('创建失败：'+err.message,true);return;}
      window.history.replaceState(null,'',`?room=${roomId}`);close();render();connectStream();showShare();
    }}]);
  }
}
function savePreset() {
  modal('保存你的战术',`<p class="modal-description">保存地图标记、所有阶段、五人分工与经济配置。下次暂停时，一键调用。</p><label class="form-label" for="preset-name">战术名称</label><input id="preset-name" class="form-input" maxlength="60" value="${esc(state.title)}"><div class="preset-save-summary"><span>${MAPS[state.map].en}</span><span>${state.side==='T'?'进攻方':'防守方'}</span><span>${state.phases.length} 个阶段</span><span>5 人分工</span></div>`,[{label:'取消'},{label:'保存到战术库',primary:true,icon:'save',run:close=>{
    const name=$('#preset-name').value.trim();if(!name){$('#preset-name').focus();return;}
    const entry={id:uid(),name,state:clone(state),createdAt:Date.now()};entry.state.title=name;
    const next=[...presets,entry];if(!storage.set('tactic-presets-v1',next)){toast('存储空间不足，请先导出战术。',true);return;}
    presets=next;activePreset=entry.id;presetFilter='all';renderPresets();close();toast('已保存到「我的战术」，本浏览器随时可用。');
  }}]);
}
function applyPreset(id) {
  if(!editable()) {toast('队友视角不能更换指挥的战术，可导出后在本地使用。');return;}
  const preset=BUILT_INS.find(p=>p.id===id)||presets.find(p=>p.id===id);if(!preset)return;
  confirmAction('载入战术预设？','将替换当前地图、阶段、经济和分工。未保存的内容可通过撤销恢复。',()=>{commit(()=>{state=preset.factory?preset.factory():clone(preset.state);});activePreset=id;camera={x:0,y:0,size:1000};updateCamera();renderPresets();document.body.classList.remove('library-open');toast('战术已就位，按队伍情况微调即可。');},'载入战术');
}
function newTactic() { if(!editable())return toast('队友只读视角不能新建战术。');confirmAction('开始一份新战术？','当前内容将被替换。建议先保存为预设，也可以在之后撤销恢复。',()=>{commit(()=>{state=emptyState(state.map);});activePreset=null;renderPresets();},'新建空白战术'); }
function exportTactic() {
  const blob=new Blob([JSON.stringify({format:'tactic-playbook',version:1,exportedAt:new Date().toISOString(),state},null,2)],{type:'application/json'});
  const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=`TACTIC-${state.map}-${state.title.replace(/[^\p{L}\p{N}_-]/gu,'_').slice(0,45)}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);toast('战术已导出，可在其他设备导入。');
}
function help() {
  modal('更少操作，更清晰的指挥',`<div class="help-grid"><div><span class="help-number">01</span><h3>先选队员，再画路线</h3><p>下方选择队员颜色。拖动绘制路线或自由线条；点击地图放置烟、闪、火与队员。选择工具可以拖动标记。</p></div><div><span class="help-number">02</span><h3>分阶段，把时序说清楚</h3><p>每个阶段有独立的地图标记。双击阶段可改名。右侧直接编辑经济、武器、道具和任务。</p></div><div><span class="help-number">03</span><h3>一个链接，全队同步</h3><p>创建共享房间后发给队友。指挥编辑，队友实时查看。预设只保存在当前浏览器，跨设备请导出备份。</p></div></div><div class="shortcut-grid">${[['V','选择 / 移动'],['H','平移地图'],['A','进攻路线'],['P','自由绘画'],['S / F / M / G','烟 / 闪 / 火 / 雷'],['1–5','选择并放置队员'],['T','文字标注'],['E','删除标记'],['⌘ / Ctrl + Z','撤销'],['Shift + ⌘ / Ctrl + Z','重做'],['空格 + 拖动','平移地图'],['滚轮','缩放地图'],['Esc','回到选择工具']].map(([k,v])=>`<div><kbd>${k}</kbd><span>${v}</span></div>`).join('')}</div><p class="help-disclaimer">地图雷达 © Valve Corporation，来源：<a href="https://github.com/MurkyYT/cs2-map-icons" target="_blank" rel="noopener noreferrer">MurkyYT/cs2-map-icons ↗</a>。本项目不隶属 Valve；标注仅作战术示意，不保证投掷落点。经济与道具为手动计划，不与游戏客户端连接。</p>`,[{label:'开始布置',primary:true}],{wide:true});
}
function setTool(t) {tool=t;selectedElement=null;renderToolbar();renderElements();$('#tactical-map').style.cursor=t==='select'?'default':t==='pan'?'grab':t==='eraser'?'not-allowed':'crosshair';}
function selectPlayer(i, place=false) {selectedPlayer=i;if(place&&editable())setTool('player');renderPalette();document.querySelectorAll('.player-card').forEach((p,n)=>p.classList.toggle('selected',n===i));}
function editText(title, value, maxlength, callback) {
  modal(title,`<input class="form-input" id="edit-text" maxlength="${maxlength}" value="${esc(value)}" aria-label="${esc(title)}">`,[{label:'取消'},{label:'确认',primary:true,run:close=>{const text=$('#edit-text').value.trim();if(!text)return;close();callback(text);}}]);
}

function bindEvents() {
  $('#app').addEventListener('click',e=>{
    const action=e.target.closest('[data-action]')?.dataset.action;
    const actions={share:showShare,'save-preset':savePreset,new:newTactic,help,export:exportTactic,import:()=>editable()?$('#preset-import').click():toast('队友视角不可导入战术。'), 'upload-map':()=>editable()&&$('#map-upload').click(), 'zoom-in':()=>zoom(.8),'zoom-out':()=>zoom(1.25),'zoom-reset':()=>{camera={x:0,y:0,size:1000};updateCamera();},focus:()=>document.body.classList.toggle('focus-mode'),retry:joinRoom,board:()=>$('.main-workspace').scrollIntoView({behavior:'smooth'}),library:()=>{presetFilter='all';renderPresets();document.body.classList.toggle('library-open');$('#preset-list').scrollIntoView({behavior:'smooth',block:'nearest'});},undo:()=>undo(false),redo:()=>undo(true),clear:()=>{if(editable()&&phase().elements.length)confirmAction('清空当前阶段的标记？','只删除这个执行阶段的地图标记，其他阶段与队员分工保持不变。',()=>commit(()=>phase().elements=[]),'清空标记');},'add-phase':()=>{if(!editable())return;if(state.phases.length>=12)return toast('每份战术最多 12 个阶段。');editText('添加执行阶段','',40,name=>commit(s=>{s.phases.push({id:uid(),name,elements:[]});s.phaseIndex=s.phases.length-1;}));},'remove-phase':()=>{if(editable()&&state.phases.length>1)confirmAction('删除当前执行阶段？','这一阶段内的标记也会被删除，可通过撤销恢复。',()=>commit(s=>{s.phases.splice(s.phaseIndex,1);s.phaseIndex=Math.min(s.phaseIndex,s.phases.length-1);}),'删除阶段');}};
    if(actions[action])actions[action]();
    const toolBtn=e.target.closest('[data-tool]');if(toolBtn&&editable())setTool(toolBtn.dataset.tool);
    const player=e.target.closest('[data-player]');if(player)selectPlayer(Number(player.dataset.player));
    const preset=e.target.closest('[data-preset]');if(preset)applyPreset(preset.dataset.preset);
    const del=e.target.closest('[data-delete-preset]');if(del)confirmAction('删除这份预设？','只删除浏览器战术库中的预设，不影响当前战术板。',()=>{presets=presets.filter(p=>p.id!==del.dataset.deletePreset);storage.set('tactic-presets-v1',presets);renderPresets();},'删除预设');
    const filter=e.target.closest('[data-filter]');if(filter){presetFilter=filter.dataset.filter;document.querySelectorAll('[data-filter]').forEach(b=>b.classList.toggle('active',b===filter));renderPresets();}
    const side=e.target.closest('[data-side]');if(side&&editable())commit(s=>s.side=side.dataset.side);
    const stage=e.target.closest('[data-phase]');if(stage){const index=Number(stage.dataset.phase);if(editable())commit(s=>s.phaseIndex=index);else {state.phaseIndex=index;renderPhases();renderElements();}}
    const grenade=e.target.closest('[data-grenade]');if(grenade&&editable())commit(s=>{const p=s.players[Number(grenade.dataset.index)],g=grenade.dataset.grenade;p.grenades=p.grenades.includes(g)?p.grenades.filter(v=>v!==g):[...p.grenades,g];});
  });
  $('#phase-list').addEventListener('dblclick',e=>{const b=e.target.closest('[data-phase]');if(b&&editable()){const i=Number(b.dataset.phase);editText('重命名执行阶段',state.phases[i].name,40,name=>commit(s=>s.phases[i].name=name));}});
  const handleFormInput=e=>{
    const el=e.target;if(!editable())return;
    if(e.type==='input' && el.tagName==='SELECT') return;
    const grouped={render:false,group:el};
    if(el.id==='tactic-title')commit(s=>s.title=el.value.trim()||'未命名战术',grouped);
    else if(el.id==='team-notes')commit(s=>s.notes=el.value,grouped);
    else if(el.id==='round-type')commit(s=>s.roundType=el.value,{render:false});
    else if(el.id==='round-number'){const n=Math.max(1,Math.min(99,Math.round(Number(el.value)||1)));if(e.type==='change')el.value=n;commit(s=>s.round=n,grouped);}
    else if(el.dataset.field){const i=Number(el.dataset.index),field=el.dataset.field;let value=field==='money'?Math.max(0,Math.min(16000,Math.round(Number(el.value)||0))):el.value;if(e.type==='change')el.value=value;commit(s=>s.players[i][field]=value,grouped);if(field==='name')renderPalette();}
    else if(el.id==='map-select'){const map=el.value;el.value=state.map;if(map===state.map)return;confirmAction('切换地图？','不同地图的点位不通用。切换会清空所有阶段的地图标记，保留队员分工，可通过撤销恢复。',()=>{commit(s=>{s.map=map;s.customMap=null;s.phases.forEach(p=>p.elements=[]);});camera={x:0,y:0,size:1000};updateCamera();},'切换地图');}
    if(e.type==='change')inputGroup=null;
  };
  $('#app').addEventListener('input',handleFormInput);
  $('#app').addEventListener('change',handleFormInput);
  $('#tactical-map').addEventListener('pointerdown',pointerDown);
  $('#tactical-map').addEventListener('pointermove',pointerMove);
  $('#tactical-map').addEventListener('pointerup',pointerUp);
  $('#tactical-map').addEventListener('pointercancel',cancelGesture);
  $('#tactical-map').addEventListener('wheel',e=>{e.preventDefault();zoom(e.deltaY>0?1.12:.89,mapPoint(e));},{passive:false});
  $('#tactical-map').addEventListener('contextmenu',e=>e.preventDefault());
}
function undo(redo) {
  if(!editable())return;if(gesture)cancelGesture();inputGroup=null;const from=redo?future:history,to=redo?history:future;if(!from.length)return;to.push(clone(state));state=from.pop();selectedElement=null;localVersion++;persist();render();
}
function mapPoint(event) {
  const svg=$('#tactical-map');const p=new DOMPoint(event.clientX,event.clientY).matrixTransform(svg.getScreenCTM().inverse());
  return [Math.max(0,Math.min(1000,p.x)),Math.max(0,Math.min(1000,p.y))];
}
function updateCamera() {$('#tactical-map').setAttribute('viewBox',`${camera.x} ${camera.y} ${camera.size} ${camera.size}`);$('#zoom-value').textContent=`${Math.round(100000/camera.size)}%`;}
function zoom(factor, center) {
  const next=Math.max(300,Math.min(1000,camera.size*factor));const [cx,cy]=center||[camera.x+camera.size/2,camera.y+camera.size/2];
  camera.x=Math.max(0,Math.min(1000-next,cx-(cx-camera.x)*(next/camera.size)));camera.y=Math.max(0,Math.min(1000-next,cy-(cy-camera.y)*(next/camera.size)));camera.size=next;updateCamera();
}
let spaceDown=false;
function pointerDown(e) {
  if(e.button!==0&&e.button!==1)return;
  if(loading||unavailable)return;
  if(document.activeElement?.matches('input,textarea,select')) document.activeElement.blur();
  if(gesture) return;
  const [x,y]=mapPoint(e),element=e.target.closest('[data-element]')?.dataset.element;
  if(spaceDown||tool==='pan'||e.button===1||!editable()) {gesture={kind:'pan',pointerId:e.pointerId,client:[e.clientX,e.clientY],camera:{...camera}};$('#tactical-map').setPointerCapture(e.pointerId);return;}
  if(tool==='eraser'){if(element)commit(()=>phase().elements=phase().elements.filter(el=>el.id!==element));return;}
  if(tool==='select') {
    selectedElement=element||null;renderElements();
    if(element)gesture={kind:'move',element,start:[x,y],original:clone(phase().elements.find(el=>el.id===element))};
  } else if(tool==='route'||tool==='pen') {
    gesture={kind:'draw',element:{id:uid(),type:tool,player:selectedPlayer,color:COLORS[selectedPlayer],points:[[x,y]]}};
  } else if(tool==='text') {
    if(phase().elements.length>=500)return toast('当前阶段标记已达上限，请新建阶段。',true);
    editText('添加地图标注','',80,text=>{if(phase().elements.length>=500)return toast('当前阶段标记已达上限。',true);commit(()=>phase().elements.push({id:uid(),type:'text',x,y,text,player:selectedPlayer,color:COLORS[selectedPlayer]}));});
  }
  else {
    if(phase().elements.length>=500)return toast('当前阶段标记已达上限，请新建阶段。',true);
    commit(()=>{if(tool==='player')phase().elements=phase().elements.filter(el=>!(el.type==='player'&&el.player===selectedPlayer));phase().elements.push({id:uid(),type:tool,x,y,player:selectedPlayer,color:COLORS[selectedPlayer]});});
  }
  if(gesture){gesture.pointerId=e.pointerId;$('#tactical-map').setPointerCapture(e.pointerId);}
}
function pointerMove(e) {
  if(!gesture||e.pointerId!==gesture.pointerId)return;
  if(gesture.kind==='pan'){
    const rect=$('#tactical-map').getBoundingClientRect(),scale=gesture.camera.size/Math.min(rect.width,rect.height);
    camera.x=Math.max(0,Math.min(1000-camera.size,gesture.camera.x-(e.clientX-gesture.client[0])*scale));camera.y=Math.max(0,Math.min(1000-camera.size,gesture.camera.y-(e.clientY-gesture.client[1])*scale));updateCamera();return;
  }
  const p=mapPoint(e);
  if(gesture.kind==='draw') {
    const points=gesture.element.points,last=points.at(-1);if(Math.hypot(p[0]-last[0],p[1]-last[1])>4&&points.length<1999)points.push(p);
    $('#drawing-preview').innerHTML=elementSVG(gesture.element,true);
  }else if(gesture.kind==='move'){
    const el=clone(gesture.original),dx=p[0]-gesture.start[0],dy=p[1]-gesture.start[1];
    if(el.points){const xs=el.points.map(p=>p[0]),ys=el.points.map(p=>p[1]);const boundedX=Math.max(-Math.min(...xs),Math.min(1000-Math.max(...xs),dx)),boundedY=Math.max(-Math.min(...ys),Math.min(1000-Math.max(...ys),dy));el.points=el.points.map(([x,y])=>[x+boundedX,y+boundedY]);}else {el.x=Math.max(0,Math.min(1000,el.x+dx));el.y=Math.max(0,Math.min(1000,el.y+dy));}
    gesture.moved=el;$('#map-elements').innerHTML=phase().elements.map(item=>elementSVG(item.id===el.id?el:item)).join('');
  }
}
function pointerUp(e) {
  if(!gesture||e.pointerId!==gesture.pointerId)return;
  const g=gesture;gesture=null;$('#drawing-preview').innerHTML='';
  if(g.kind==='draw'&&g.element.points.length>1){if(phase().elements.length>=500)return toast('当前阶段标记已达上限。',true);commit(()=>phase().elements.push(g.element));}
  if(g.kind==='move'&&g.moved)commit(()=>{const i=phase().elements.findIndex(el=>el.id===g.element);if(i>=0)phase().elements[i]=g.moved;});
  if($('#tactical-map').hasPointerCapture(e.pointerId))$('#tactical-map').releasePointerCapture(e.pointerId);
}
function cancelGesture(event) {
  if(event?.pointerId!==undefined&&gesture&&event.pointerId!==gesture.pointerId)return;
  const pointerId=gesture?.pointerId;gesture=null;
  if(pointerId!==undefined&&$('#tactical-map').hasPointerCapture(pointerId))$('#tactical-map').releasePointerCapture(pointerId);
  $('#drawing-preview').innerHTML='';renderElements();
}

document.addEventListener('keydown',e=>{
  if($('#modal-root').children.length||['INPUT','TEXTAREA','SELECT'].includes(document.activeElement?.tagName)||document.activeElement?.isContentEditable)return;
  if(e.code==='Space'){spaceDown=true;e.preventDefault();return;}
  if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='z'){e.preventDefault();undo(e.shiftKey);return;}
  if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='y'){e.preventDefault();undo(true);return;}
  if(e.key==='?'){help();return;}
  if(!editable())return;
  if(e.key==='Escape'){setTool('select');cancelGesture();document.body.classList.remove('focus-mode');return;}
  if(['Delete','Backspace'].includes(e.key)&&selectedElement){e.preventDefault();commit(()=>phase().elements=phase().elements.filter(el=>el.id!==selectedElement));return;}
  if(/^[1-5]$/.test(e.key)){selectPlayer(Number(e.key)-1,true);return;}
  const keyTools={v:'select',h:'pan',a:'route',p:'pen',s:'smoke',f:'flash',m:'fire',g:'grenade',e:'eraser',t:'text'};
  if(!e.metaKey&&!e.ctrlKey&&keyTools[e.key.toLowerCase()]){e.preventDefault();setTool(keyTools[e.key.toLowerCase()]);}
});
document.addEventListener('keyup',e=>{if(e.code==='Space')spaceDown=false;});
window.addEventListener('blur',()=>spaceDown=false);
window.addEventListener('beforeunload',e=>{if(dirty){e.preventDefault();e.returnValue='';}});
$('#map-upload').addEventListener('change',async e=>{
  const file=e.target.files[0];e.target.value='';if(!file||!editable())return;
  if(!['image/png','image/jpeg','image/webp'].includes(file.type)||file.size>3*1024*1024){toast('请选择 3MB 以内的 PNG、JPG 或 WebP 雷达图。',true);return;}
  try {const data=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=reject;reader.readAsDataURL(file);});await new Promise((resolve,reject)=>{const img=new Image();img.onload=resolve;img.onerror=reject;img.src=data;});commit(s=>s.customMap={name:file.name.slice(0,200),data});toast('雷达图已更新，建议使用正方形图片。');}catch{toast('无法读取这张图片，请更换文件。',true);}
});
$('#preset-import').addEventListener('change',async e=>{
  const file=e.target.files[0];e.target.value='';if(!file||!editable())return;
  if(file.size>6*1024*1024)return toast('战术文件不能超过 6MB。',true);
  try{const data=JSON.parse(await file.text()),incoming=data.state||data;if(!validateState(incoming))throw new Error('格式不正确或包含无效内容');confirmAction('导入战术文件？','这将替换当前战术板，未保存的内容可通过撤销恢复。',()=>{commit(()=>state=clone(incoming));activePreset=null;renderPresets();toast('战术导入成功。');},'导入战术');}catch(err){toast('导入失败：'+err.message,true);}
});

shell();render();if(roomId)joinRoom();
