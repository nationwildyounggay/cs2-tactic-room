import { test, expect } from '@playwright/test';

async function point(page,x,y) { return page.locator('#tactical-map').evaluate((svg,p)=>{const q=new DOMPoint(p.x,p.y).matrixTransform(svg.getScreenCTM());return{x:q.x,y:q.y};},{x,y}); }

// Seed only through the documented draft format; no app internals are exposed.
async function seed(page, transform) {
  await page.goto('/');
  await page.locator('#tactic-title').fill('Regression tactic');
  const state=await page.evaluate(()=>JSON.parse(localStorage.getItem('tactic-draft-v1')));
  transform(state);
  await page.evaluate(state=>localStorage.setItem('tactic-draft-v1',JSON.stringify(state)),state);
  await page.reload();
}

test('text and other markers respect the 500-element ceiling',async({page})=>{
  await seed(page,s=>{s.phases[s.phaseIndex].elements=Array.from({length:500},(_,i)=>({id:'cap-'+i,type:'smoke',player:0,color:'#c5ef78',x:100+(i%10),y:100+Math.floor(i/10)}));});
  await expect(page.locator('#map-elements > .map-element')).toHaveCount(500);
  const p=await point(page,500,500);
  await page.locator('[data-tool="text"]').click();await page.mouse.click(p.x,p.y);
  await expect(page.locator('#toast')).toContainText('上限');await expect(page.locator('#edit-text')).toHaveCount(0);
  await page.locator('[data-tool="smoke"]').click();await page.mouse.click(p.x,p.y);
  await expect(page.locator('#map-elements > .map-element')).toHaveCount(500);
  await page.reload();await expect(page.locator('#map-elements > .map-element')).toHaveCount(500);
});

test('secondary pointers do not hijack a drag; deleting mid-drag leaves a valid document',async({page})=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await seed(page,s=>{s.phases[s.phaseIndex].elements=[{id:'drag-token',type:'player',player:0,color:'#c5ef78',x:300,y:300}];});
  // Drive real touch input through Chromium to exercise pointer capture.
  const session=await page.context().newCDPSession(page);
  const p=await point(page,300,300),q=await point(page,600,600),r=await point(page,650,650);
  const touch=(type,points)=>session.send('Input.dispatchTouchEvent',{type,touchPoints:points});
  await touch('touchStart',[{id:1,...p}]);
  await touch('touchStart',[{id:1,...p},{id:2,...q}]);
  await touch('touchMove',[{id:1,...p},{id:2,...r}]);
  await touch('touchEnd',[{id:1,...p}]);
  await touch('touchEnd',[]);
  const unchanged=await page.locator('[data-element="drag-token"]').getAttribute('transform');expect(unchanged).toBe('translate(300 300)');
  await page.mouse.move(p.x,p.y);await page.mouse.down();await page.mouse.move(p.x+20,p.y+15,{steps:3});
  await page.keyboard.press('Delete');await page.mouse.up();
  await expect(page.locator('#map-elements > .map-element')).toHaveCount(0);
  const current=await page.evaluate(()=>JSON.parse(localStorage.getItem('tactic-draft-v1')));
  expect(current.phases[current.phaseIndex].elements).toEqual([]);
  await page.reload();await expect(page.locator('#map-elements > .map-element')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('two commander sessions synchronize without erasing in-progress text silently',async({page,browser})=>{
  await page.goto('/');await page.locator('.heading-actions [data-action="share"]').click();await page.getByRole('button',{name:'创建并获取链接'}).click();
  await expect(page.locator('#invite-link')).toBeVisible();const link=await page.locator('#invite-link').inputValue();await page.getByRole('button',{name:'完成',exact:true}).click();
  const secondContext=await browser.newContext({storageState:await page.context().storageState()});const second=await secondContext.newPage();await second.goto(link);
  await expect(second.locator('#tactic-title')).toBeEnabled();
  await page.locator('#team-notes').fill('主指挥：按时爆弹');
  await expect(second.locator('#team-notes')).toHaveValue('主指挥：按时爆弹');
  await second.locator('#team-notes').fill('副指挥：先等反清道具');
  await expect(page.locator('#team-notes')).toHaveValue('副指挥：先等反清道具');
  await expect(second.locator('#board-save-status')).toContainText('已同步');
  await secondContext.close();
});
