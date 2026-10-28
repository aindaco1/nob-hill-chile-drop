import { test,expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { waitForStableRendering,applyTextScale } from '../../shared/dust-wave-platform/packages/test-core/src/rendering.js';
const api='https://nob-hill-chile-drop-api.jogo.workers.dev';
const headers={'access-control-allow-origin':'http://127.0.0.1:4173','access-control-allow-headers':'Content-Type, Authorization','access-control-allow-methods':'GET, POST, PATCH, DELETE, OPTIONS'};
async function mock(page,handler){await page.route(api+'/**',async route=>{if(route.request().method()==='OPTIONS')return route.fulfill({status:204,headers});const path=new URL(route.request().url()).pathname;const body=handler?await handler(path,route.request()):{registrationOpen:true,capacity:2000};return route.fulfill({status:200,headers,contentType:'application/json',body:JSON.stringify(body)});});}
test('responsive pages, landmarks and asset paths work at the GitHub project subpath',async({page,request})=>{
  await mock(page);const errors=[];page.on('pageerror',e=>errors.push(e.message));
  for(const width of [320,375,768,1024,1440]){await page.setViewportSize({width,height:900});await page.goto('./');await waitForStableRendering(page);await expect(page.locator('h1')).toHaveCount(1);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await expect(page.getByRole('button',{name:'Enter the free drawing'})).toBeVisible();}
  const paths=await page.locator('a[href],img[src],script[src],link[rel=stylesheet]').evaluateAll(nodes=>nodes.map(n=>n.href||n.src).filter(url=>url?.startsWith(location.origin)).map(url=>new URL(url).pathname));
  for(const path of new Set(paths)){const response=await request.get(path);expect(response.status(),path).toBe(200);}
  expect(errors).toEqual([]);
});
test('countdown sits below the header and the hero fits the first desktop and phone viewport',async({page})=>{
  await mock(page);
  for(const [width,height] of [[1440,900],[1366,768],[1280,720],[1024,768],[768,1024],[390,844],[375,667],[320,568]]){
    await page.setViewportSize({width,height});await page.goto('./');await waitForStableRendering(page);
    const header=await page.locator('.site-header').boundingBox();
    const countdown=await page.locator('.countdown-strip').boundingBox();
    const hero=await page.locator('.hero').boundingBox();
    expect(Math.abs(countdown.y-header.y-header.height)).toBeLessThan(1);
    expect(Math.abs(hero.y-countdown.y-countdown.height)).toBeLessThan(1);
    expect(hero.y+hero.height,`${width} × ${height}: entire hero above the fold`).toBeLessThanOrEqual(height+1);
    await expect(page.locator('.hero__actions .button')).toBeInViewport({ratio:1});
    await expect(page.locator('.hero__details')).toContainText('Hot Spot opens at 10pm MT');
  }
});
test('entry validates and sends one free group, then shows a confirmation instruction',async({page})=>{
  let submitted;await mock(page,(path,request)=>{if(path==='/api/entries'){submitted=request.postDataJSON();return{ok:true};}return{registrationOpen:true};});
  await page.goto('./#hot-spot');await page.getByLabel('Your name',{exact:true}).fill('Sample Guest');await page.getByLabel('Email address',{exact:true}).fill('guest@example.com');await page.getByLabel('People in your group',{exact:true}).fill('4');await page.getByRole('checkbox').check();await page.getByRole('button',{name:'Enter the free drawing'}).click();
  await expect(page.locator('[data-entry-status]')).toContainText('Check your inbox');expect(submitted).toEqual({name:'Sample Guest',email:'guest@example.com',groupSize:4,consent:true});expect(await page.evaluate(()=>Object.keys(localStorage))).toEqual([]);await expect(page.locator('[data-entry-form]')).not.toHaveAttribute('aria-busy','true');
});
test('closed entry and network failure never show a false confirmation',async({page})=>{
  await mock(page,()=>({registrationOpen:false}));await page.goto('./');await expect(page.locator('[data-registration-status]')).toContainText('closed');await expect(page.locator('[data-entry-form]')).toBeHidden();
  await page.unroute(api+'/**');await page.route(api+'/**',route=>route.abort());await page.reload();await expect(page.locator('[data-registration-status]')).toContainText('could not reach');await expect(page.locator('[data-entry-form]')).toBeHidden();
});
test('mobile navigation, keyboard FAQ and reduced motion remain usable',async({page})=>{
  await mock(page);await page.setViewportSize({width:375,height:812});await page.emulateMedia({reducedMotion:'reduce'});await page.goto('./');await page.getByRole('button',{name:'Open menu'}).click();await expect(page.locator('#mobile-nav')).toBeVisible();await page.keyboard.press('Escape');await expect(page.getByRole('button',{name:'Open menu'})).toBeFocused();await expect(page.locator('#mobile-nav')).toBeHidden();
  const question=page.locator('summary').filter({hasText:'How does the free drawing work?'});await question.focus();await page.keyboard.press('Enter');await expect(question.locator('..')).toHaveAttribute('open','');
});
test('chile loops automatically, can be paused, and respects reduced motion',async({page})=>{
  await mock(page);await page.goto('./');
  const chile=page.locator('.hero__sign .chile-drop');
  await expect.poll(()=>chile.evaluate(el=>el.getAnimations()[0]?.playState)).toBe('running');
  // Observe an actual repeat, rather than only checking the CSS iteration count.
  await chile.evaluate(el=>new Promise(resolve=>el.addEventListener('animationiteration',()=>resolve(true),{once:true})));
  await page.getByRole('button',{name:'Pause animation',exact:true}).click();
  await expect.poll(()=>chile.evaluate(el=>el.getAnimations()[0]?.playState)).toBe('paused');
  const pausedAt=await chile.evaluate(el=>el.getAnimations()[0].currentTime);
  await page.locator('footer').scrollIntoViewIfNeeded();await chile.scrollIntoViewIfNeeded();
  expect(await chile.evaluate(el=>el.getAnimations()[0].currentTime)).toBe(pausedAt);
  await page.getByRole('button',{name:'Resume animation',exact:true}).click();
  await expect.poll(()=>chile.evaluate(el=>el.getAnimations()[0]?.playState)).toBe('running');
  await page.locator('footer').scrollIntoViewIfNeeded();
  await expect.poll(()=>chile.evaluate(el=>el.getAnimations()[0]?.playState)).toBe('paused');
  await chile.scrollIntoViewIfNeeded();
  await page.emulateMedia({reducedMotion:'reduce'});
  await expect.poll(()=>chile.evaluate(el=>el.getAnimations().length)).toBe(0);
  await expect(page.getByRole('button',{name:'Pause animation',exact:true})).toBeHidden();
});
test('WCAG 2.2 AA checks and 200% text reflow pass',async({page})=>{
  await mock(page);await page.goto('./');await waitForStableRendering(page);const results=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa','wcag22aa']).analyze();expect(results.violations).toEqual([]);await page.setViewportSize({width:375,height:812});await applyTextScale(page,200);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
test('countdown stops at zero after Mountain Time midnight',async({page})=>{
  await mock(page);await page.clock.install({time:new Date('2027-01-01T07:00:01Z')});await page.goto('./');await expect(page.locator('#countdown-title')).toHaveText('Happy New Year, Albuquerque!');await expect(page.locator('[data-time=days]')).toHaveText('00');await expect(page.locator('[data-time=seconds]')).toHaveText('00');
});
test('event, calendar and FAQ remain useful without JavaScript',async({browser})=>{
  const context=await browser.newContext({javaScriptEnabled:false,viewport:{width:375,height:812}});const page=await context.newPage();await page.goto('http://127.0.0.1:4173/nob-hill-chile-drop/');await expect(page.locator('h1')).toBeVisible();await expect(page.locator('#mobile-nav')).toBeVisible();await page.locator('summary').filter({hasText:'When does the chile drop?'}).click();await expect(page.locator('details[open]')).toContainText('January 1, 2027');await context.close();
});
test('verification clears link token and loads only the scoped group',async({page})=>{
  await mock(page,path=>path.endsWith('/verify')?{accessToken:'entry-session',entry:{name:'Sample Guest',email:'guest@example.com',groupSize:3,status:'entered',canEdit:true}}:{});await page.goto('entry/#token=sample-verification');await expect(page.locator('[data-entry-result]')).toContainText('Your email is confirmed');expect(new URL(page.url()).hash).toBe('');await expect(page.getByLabel('People in your group')).toHaveValue('3');await page.getByRole('button',{name:'Sign out of this entry'}).click();await expect(page.locator('[data-entry-link]')).toBeVisible();
});
test('admin protects drawing transitions and safely renders untrusted guest names',async({page})=>{
  const snapshot={entries:[{id:'one',name:'<img src=x onerror=alert(1)>',email:'test@example.com',groupSize:2,status:'entered'}],total:1,counts:{totalOrders:1,verifiedOrders:1,verifiedPeople:2},settings:{registrationOpen:true,capacity:2000,locked:false},preview:null,drawing:null,outbox:{sent:1}};
  await mock(page,(path)=>path.endsWith('/verify')?{accessToken:'admin-session'}:snapshot);await page.goto('admin/#token=admin-link');await expect(page.locator('[data-admin-dashboard]')).toBeVisible();await expect(page.getByRole('button',{name:'Prepare drawing'})).toBeDisabled();await expect(page.getByRole('button',{name:'Commit reviewed result'})).toBeDisabled();await expect(page.locator('[data-entries] img')).toHaveCount(0);await expect(page.locator('[data-entries]')).toContainText('<img src=x');expect(new URL(page.url()).hash).toBe('');await expect(page.locator('meta[name=robots]')).toHaveAttribute('content','noindex,follow');
});
