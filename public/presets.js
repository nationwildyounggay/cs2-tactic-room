export const COLORS = ['#c5ef78', '#7cc9ff', '#c59bff', '#ffbb70', '#fb879b'];
export const MAPS = {
  mirage: { name: '荒漠迷城', en: 'MIRAGE', image: '/maps/de_mirage.png', letter: 'M', subtitle: '中路控制 · 双点夹击' },
  inferno: { name: '炼狱小镇', en: 'INFERNO', image: '/maps/de_inferno.png', letter: 'I', subtitle: '香蕉道控制 · 协同爆弹' },
  dust2: { name: '炙热沙城 II', en: 'DUST II', image: '/maps/de_dust2.png', letter: 'D', subtitle: '长门突破 · A 大进攻' },
};
const id = () => globalThis.crypto?.randomUUID?.() || Math.random().toString(36).slice(2);
export const uid = id;
export const clone = value => JSON.parse(JSON.stringify(value));
const route = (player, points) => ({ id: id(), type: 'route', player, color: COLORS[player], points });
const item = (type, x, y, player) => ({ id: id(), type, x, y, player, color: COLORS[player] });
const token = (x, y, player) => item('player', x, y, player);
const phase = (name, elements = []) => ({ id: id(), name, elements });
const tasks = ['A1 等烟爆开，闪后第一身位进点', '补闪跟进，补枪并检查近点', '跳台烟落地后进宫殿协同', '拱门烟，架住回防与中路', '携带 C4，跟队进点下默认包'];
export function emptyState(map = 'mirage') {
  return {
    schemaVersion: 1, title: '新战术', map, side: 'T', round: 1, roundType: 'full', phaseIndex: 0,
    phases: [phase('默认展开'), phase('道具协同'), phase('进点与守包')],
    players: COLORS.map((color, i) => ({ id: id(), name: ['Ace', 'Luna', 'Echo', 'Ghost', 'You'][i], role: ['突破手', '补枪手', '自由人', '狙击手', '指挥 / C4'][i], color, money: [5400, 4800, 4200, 6500, 5100][i], weapon: i === 3 ? 'AWP' : 'AK-47', grenades: i === 0 ? ['flash', 'fire'] : ['smoke', 'flash'], task: '' })),
    notes: '', customMap: null,
  };
}
export function createMiragePreset() {
  const state = emptyState('mirage');
  state.title = 'A 区协同爆弹'; state.round = 12;
  state.notes = '等三颗烟到位再出。1 号第一身位，2 号补枪，宫殿同步拉出；下包后交叉架枪，不主动送单。';
  state.players.forEach((p, i) => p.task = tasks[i]);
  state.phases = [
    phase('集结与控图', [token(825, 545, 0), token(860, 585, 1), token(825, 710, 2), token(690, 430, 3), token(830, 635, 4), route(0, [[825, 545], [775, 565], [745, 610], [715, 645]]), route(2, [[825, 710], [810, 755], [760, 770]]), route(3, [[690, 430], [590, 455], [545, 490]])]),
    phase('三烟协同', [token(730, 620, 0), token(775, 630, 1), token(785, 765, 2), token(545, 490, 3), token(755, 675, 4), item('smoke', 490, 625, 3), item('smoke', 440, 790, 4), item('smoke', 630, 697, 2), item('flash', 610, 685, 1), item('fire', 655, 780, 0), route(0, [[730, 620], [715, 655], [660, 650], [600, 697], [570, 750]]), route(2, [[785, 765], [720, 765], [680, 805], [605, 805]]), route(3, [[545, 490], [500, 520], [485, 565]])]),
    phase('进点与守包', [token(510, 733, 0), token(610, 680, 1), token(680, 805, 2), token(480, 570, 3), token(555, 775, 4), item('smoke', 490, 625, 3), item('smoke', 440, 790, 4), item('smoke', 630, 697, 2)]),
  ];
  state.phaseIndex = 1;
  return state;
}
export function createInfernoPreset() {
  const s = emptyState('inferno'); s.title = 'B 区香蕉道提速'; s.notes = '先用火清近点，队友补反清闪。双烟封警家和棺材，第一身位看死点，第二身位补枪。';
  const assignments = ['香蕉道第一身位，清近点与死点', '反清闪后跟进，补枪', '警家烟，进点检查三箱', '棺材烟，架回防', '带包跟进，安全后下包'];
  s.players.forEach((p,i) => p.task = assignments[i]);
  s.phases = [
    phase('争夺香蕉道', [token(410, 580, 0),token(365, 600, 1),token(325, 625, 2),token(475, 690, 3),token(310, 665, 4),route(0,[[410,580],[430,510],[455,450],[485,390]]),item('fire',475,380,0),item('flash',460,465,1)]),
    phase('封烟进点', [token(465, 440, 0),token(440, 480, 1),token(425, 520, 2),token(480, 375, 3),token(415, 565, 4),item('smoke',620,390,2),item('smoke',560,200,3),item('flash',485,295,1),item('fire',440,250,0),route(0,[[465,440],[485,370],[470,315],[470,260]]),route(2,[[425,520],[450,465],[490,400],[545,375]])]),
    phase('下包与交叉火力',[token(450,280,0),token(535,350,1),token(590,385,2),token(560,250,3),token(485,230,4),item('smoke',620,390,2),item('smoke',560,200,3)]),
  ];
  s.phaseIndex = 1; return s;
}
export function createDustPreset() {
  const s = emptyState('dust2'); s.title = 'A 大爆闪提速'; s.notes = '出生位好的队员先抢长门，队友连续补闪。A 大站稳后再封过点烟，切勿在烟未落地时过马路。';
  ['抢 A 大，第一身位出门', '连续补闪，跟进补枪', '控制蓝箱与大坑', '架中门，防止 CT 前压', '携带 C4，过点烟后跟进'].forEach((t,i) => s.players[i].task=t);
  s.phases = [
    phase('抢占 A 大',[token(650,770,0),token(610,815,1),token(570,870,2),token(470,650,3),token(510,865,4),item('flash',760,520,1),item('flash',830,475,4),route(0,[[650,770],[655,690],[680,660],[740,650],[770,590],[790,540],[860,520]]),route(3,[[470,650],[470,550],[480,470]])]),
    phase('封烟过点',[token(875,450,0),token(920,500,1),token(845,620,2),token(480,450,3),token(920,560,4),item('smoke',765,285,4),item('smoke',700,250,2),item('flash',850,235,1),route(0,[[875,450],[875,360],[865,285],[840,245],[815,200]]),route(4,[[920,560],[925,450],[910,340],[880,275]])]),
    phase('平台下包',[token(875,195,0),token(760,220,1),token(880,360,2),token(650,355,3),token(795,165,4),item('smoke',765,285,4),item('smoke',700,250,2)]),
  ]; s.phaseIndex = 0; return s;
}
export const BUILT_INS = [
  { id: 'mirage-a', name: 'A 区协同爆弹', map: 'mirage', tag: '全起局', difficulty: '3 烟 · 1 闪 · 1 火', factory: createMiragePreset },
  { id: 'inferno-b', name: 'B 区香蕉道提速', map: 'inferno', tag: '提速战术', difficulty: '清点 → 封烟 → 进点', factory: createInfernoPreset },
  { id: 'dust2-a', name: 'A 大爆闪提速', map: 'dust2', tag: '抢点战术', difficulty: '抢 A 大 · 封过点', factory: createDustPreset },
];
export function validateState(s) {
  if (!s || s.schemaVersion !== 1 || typeof s.map !== 'string' || !Object.hasOwn(MAPS, s.map) || !['T', 'CT'].includes(s.side) || typeof s.title !== 'string' || s.title.length > 80) return false;
  if (!Array.isArray(s.players) || s.players.length !== 5 || !Array.isArray(s.phases) || !s.phases.length || s.phases.length > 12 || !Number.isInteger(s.phaseIndex) || s.phaseIndex < 0 || s.phaseIndex >= s.phases.length) return false;
  if (typeof s.notes !== 'string' || s.notes.length > 2000 || !Number.isInteger(s.round) || s.round < 1 || s.round > 99 || !['full','force','eco'].includes(s.roundType)) return false;
  if (!s.players.every(p => p && typeof p.name === 'string' && p.name.length <= 20 && typeof p.role === 'string' && p.role.length <= 30 && typeof p.task === 'string' && p.task.length <= 200 && Number.isFinite(p.money) && p.money >= 0 && p.money <= 16000 && typeof p.weapon === 'string' && p.weapon.length <= 20 && Array.isArray(p.grenades) && p.grenades.length <= 4 && p.grenades.every(g => ['smoke','flash','fire','grenade'].includes(g)))) return false;
  const point = a => Array.isArray(a) && a.length === 2 && a.every(v => Number.isFinite(v) && v >= 0 && v <= 1000);
  const coord = v => Number.isFinite(v) && v >= 0 && v <= 1000;
  if (!s.phases.every(p => p && typeof p.name === 'string' && p.name.length <= 40 && Array.isArray(p.elements) && p.elements.length <= 500 && p.elements.every(e => e && typeof e.id === 'string' && e.id.length <= 80 && ['route','pen','smoke','flash','fire','grenade','player','text'].includes(e.type) && Number.isInteger(e.player) && e.player >= 0 && e.player < 5 && /^#[a-fA-F0-9]{6}$/.test(e.color) && ((e.type === 'route' || e.type === 'pen') ? Array.isArray(e.points) && e.points.length >= 2 && e.points.length <= 2000 && e.points.every(point) : coord(e.x) && coord(e.y) && (e.type !== 'text' || typeof e.text === 'string' && e.text.length <= 80))))) return false;
  if (s.customMap && (typeof s.customMap.data !== 'string' || !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(s.customMap.data) || s.customMap.data.length > 4300000 || typeof s.customMap.name !== 'string' || s.customMap.name.length > 200)) return false;
  return true;
}
