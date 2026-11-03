import { test, expect } from '@playwright/test';

async function mapLocation(page, x, y) {
  return page.locator('#tactical-map').evaluate((svg, {x,y}) => {
    const point = new DOMPoint(x,y).matrixTransform(svg.getScreenCTM());
    return { x: point.x, y: point.y };
  }, {x,y});
}
async function mapClick(page,x,y) { const p=await mapLocation(page,x,y);await page.mouse.click(p.x,p.y); }
async function mapDrag(page, from, to) {const p=await mapLocation(page,...from),q=await mapLocation(page,...to);await page.mouse.move(p.x,p.y);await page.mouse.down();await page.mouse.move(q.x,q.y,{steps:15});await page.mouse.up();}
async function snapshot(page) {return page.evaluate(()=>JSON.parse(localStorage.getItem('tactic-draft-v1')));}
async function createRoom(page) {
  await page.locator('.heading-actions [data-action="share"]').click();
  await page.getByRole('button',{name:'创建并获取链接'}).click();
  await expect(page.locator('#invite-link')).toBeVisible();
  const link=await page.locator('#invite-link').inputValue();
  await page.getByRole('button',{name:'完成',exact:true}).click();
  return link;
}

test('desktop dashboard, drawing, editing, drag, undo, phases, presets and export',async({page})=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('/');
  await expect(page.getByRole('heading',{name:'战术指挥室.'})).toBeVisible();
  await expect(page.locator('.player-card')).toHaveCount(5);
  await expect(page.locator('#team-money')).toHaveText('$26,000');
  await expect(page.locator('#radar-image')).toHaveAttribute('href','/maps/de_mirage.png');
  await page.screenshot({path:'artifacts/desktop.png',fullPage:true});
  const initial=await page.locator('#map-elements > .map-element').count();
  await page.locator('[data-field="task"][data-index="0"]').fill('暂停计划：第一身位清近点，闪后出');
  await page.keyboard.press('Tab');
  await page.locator('[data-tool="smoke"]').click();await mapClick(page,330,390);
  await expect(page.locator('#map-elements > .map-element')).toHaveCount(initial+1);
  expect((await snapshot(page)).players[0].task).toContain('暂停计划');
  await page.locator('[data-field="money"][data-index="0"]').fill('16001');await page.keyboard.press('Tab');
  await expect(page.locator('#team-money')).toHaveText('$36,600');
  await page.locator('[data-tool="route"]').click();await mapDrag(page,[300,500],[480,550]);
  await expect(page.locator('#map-elements > .map-element')).toHaveCount(initial+2);
  await page.locator('[data-action="undo"]').click();await expect(page.locator('#map-elements > .map-element')).toHaveCount(initial+1);
  await page.locator('[data-action="redo"]').click();await expect(page.locator('#map-elements > .map-element')).toHaveCount(initial+2);
  await page.locator('[data-tool="player"]').click();await mapClick(page,300,500);
  await page.locator('[data-tool="select"]').click();await mapDrag(page,[300,500],[350,540]);
  const positioned=(await snapshot(page)).phases[1].elements.find(e=>e.type==='player'&&e.player===0);
  expect(positioned.x).toBeCloseTo(350,-1);expect(positioned.y).toBeCloseTo(540,-1);
  await page.locator('[data-action="add-phase"]').click();await page.locator('#edit-text').fill('暂停后执行');await page.getByRole('button',{name:'确认',exact:true}).click();
  await expect(page.locator('.phase-tab')).toHaveCount(4);await expect(page.locator('#map-elements > .map-element')).toHaveCount(0);
  await page.locator('[data-tool="text"]').click();await mapClick(page,400,400);await page.locator('#edit-text').fill('等闪再出');await page.getByRole('button',{name:'确认',exact:true}).click();
  await expect(page.locator('#map-elements')).toContainText('等闪再出');
  await page.locator('.heading-actions [data-action="save-preset"]').click();await page.locator('#preset-name').fill('比赛专用战术');await page.getByRole('button',{name:'保存到战术库'}).click();
  await expect(page.locator('.preset-details strong').filter({hasText:'比赛专用战术'})).toBeVisible();
  const downloadPromise=page.waitForEvent('download');await page.locator('[data-action="export"]').click();const download=await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/\.json$/);
  await page.reload();await expect(page.locator('.phase-tab')).toHaveCount(4);await expect(page.locator('#map-elements')).toContainText('等闪再出');
  await page.locator('[data-action="clear"]').click();await page.getByRole('button',{name:'清空标记',exact:true}).click();await expect(page.locator('#map-elements > .map-element')).toHaveCount(0);
  await page.locator('[data-action="undo"]').click();await expect(page.locator('#map-elements')).toContainText('等闪再出');
  expect(errors).toEqual([]);
});

test('commander and independent viewer stay synchronized; owner survives reload',async({page,browser})=>{
  await page.goto('/');
  const link=await createRoom(page);
  const viewerContext=await browser.newContext();const viewer=await viewerContext.newPage();const errors=[];viewer.on('pageerror',e=>errors.push(e.message));
  await viewer.goto(link);
  await expect(viewer.locator('#viewer-tag')).toBeVisible();await expect(viewer.locator('#tactic-title')).toBeDisabled();await expect(viewer.locator('#drawing-toolbar')).toBeHidden();
  await page.locator('#tactic-title').fill('实时同步测试');
  await expect(viewer.locator('#tactic-title')).toHaveValue('实时同步测试');
  await page.locator('[data-field="task"][data-index="2"]').fill('宫殿等闪，同步拉出');await page.keyboard.press('Tab');
  await expect(viewer.locator('[data-field="task"][data-index="2"]')).toHaveValue('宫殿等闪，同步拉出');
  const before=await viewer.locator('#map-elements > .map-element').count();
  await page.locator('[data-tool="fire"]').click();await mapClick(page,340,400);
  await expect(viewer.locator('#map-elements > .map-element')).toHaveCount(before+1);
  await page.locator('[data-phase="2"]').click();await expect(viewer.locator('[data-phase="2"]')).toHaveClass(/active/);
  await page.reload();await expect(page.locator('#tactic-title')).toBeEnabled();await expect(page.locator('#tactic-title')).toHaveValue('实时同步测试');
  await page.locator('#team-notes').fill('新的回合计划');
  await expect(viewer.locator('#team-notes')).toHaveValue('新的回合计划');
  const id=new URL(link).searchParams.get('room');
  const response=await viewer.request.put(`/api/rooms/${id}`,{data:{state:{},revision:1}});expect(response.status()).toBe(401);
  await viewer.screenshot({path:'artifacts/viewer.png',fullPage:true});
  expect(errors).toEqual([]);await viewerContext.close();
});

test('mobile layout and reachable preset library, map selection, upload and import',async({browser})=>{
  const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});const page=await context.newPage();
  await page.goto('/');await expect(page.locator('.mobile-library')).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.screenshot({path:'artifacts/mobile.png',fullPage:true});
  await page.locator('.mobile-library').click();await expect(page.locator('.sidebar')).toBeVisible();await page.locator('[data-preset="inferno-b"]').click();await page.getByRole('button',{name:'载入战术',exact:true}).click();
  await expect(page.locator('#map-select')).toHaveValue('inferno');await expect(page.locator('.sidebar')).toBeHidden();
  await expect(page.locator('#map-elements > .map-element')).not.toHaveCount(0);
  await page.locator('[data-action="zoom-in"]').click();await page.locator('[data-tool="pan"]').click();
  const oldViewBox=await page.locator('#tactical-map').getAttribute('viewBox');await mapDrag(page,[600,600],[500,500]);expect(await page.locator('#tactical-map').getAttribute('viewBox')).not.toBe(oldViewBox);
  await page.locator('#map-upload').setInputFiles('public/maps/de_dust2.png');
  await expect(page.locator('#radar-image')).toHaveAttribute('href',/^data:image\/png/);
  const current=await snapshot(page);expect(current.customMap.name).toBe('de_dust2.png');
  current.title='导入专用';current.map='dust2';current.customMap=null;
  await page.locator('#preset-import').setInputFiles({name:'tactic.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify({state:current}))});
  await page.getByRole('button',{name:'导入战术',exact:true}).click();await expect(page.locator('#tactic-title')).toHaveValue('导入专用');
  await context.close();
});

test('bad storage, invalid rooms, round input and focused edits recover safely',async({page})=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>localStorage.setItem('tactic-presets-v1','{}'));
  await page.goto('/');await expect(page.locator('#tactic-title')).toBeVisible();
  await page.locator('#round-number').fill('1.5');await page.keyboard.press('Tab');await expect(page.locator('#round-number')).toHaveValue('2');
  await page.goto('/?room=BAD!!!');await expect(page.locator('#room-banner')).toContainText('无法载入房间');
  await expect(page.locator('#tactic-title')).toBeDisabled();
  await page.goto('/');
  await page.locator('[data-field="task"][data-index="0"]').fill('直接点击地图也不丢失输入');
  // Focus stays inside the task input until SVG pointerdown.
  const inputValue=await page.locator('[data-field="task"][data-index="0"]').inputValue();
  await page.evaluate(()=>{const s=JSON.parse(localStorage.getItem('tactic-draft-v1'));if(!s)throw Error('Draft not autosaved while focused');});
  await mapClick(page,300,400);
  expect((await snapshot(page)).players[0].task).toBe(inputValue);
  expect(errors).toEqual([]);
});
