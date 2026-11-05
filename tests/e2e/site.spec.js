import { test,expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { waitForStableRendering,applyTextScale } from '../../shared/dust-wave-platform/packages/test-core/src/rendering.js';
const entryFormVersion='group-location-2026-11-04';
const location={city:'Albuquerque',stateProvince:'NM',country:'USA'};
async function fillLocation(page){for(const [name,value] of Object.entries(location))await page.locator(`[name=${name}]`).fill(value);}
const api='https://nob-hill-chile-drop-api.jogo.workers.dev';
const headers={'access-control-allow-origin':'http://127.0.0.1:4173','access-control-allow-headers':'Content-Type, Authorization','access-control-allow-methods':'GET, POST, PATCH, DELETE, OPTIONS'};
// Keep the third-party map out of CI; actual tiles/controls are checked visually at release.
test.beforeEach(async({page})=>{
  await page.route('https://www.openstreetmap.org/export/embed.html?*',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><html lang="en"><title>Venue map</title><body><p>Hotel Zazz map preview</p><a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a></body></html>'}));
});
async function mock(page,handler){await page.route(api+'/**',async route=>{if(route.request().method()==='OPTIONS')return route.fulfill({status:204,headers});const path=new URL(route.request().url()).pathname;const body=handler?await handler(path,route.request()):{registrationOpen:true,capacity:2000};return route.fulfill({status:200,headers,contentType:'application/json',body:JSON.stringify(path==='/api/config'?{mediaConsentVersion:'hot-spot-media-2026-11-04',entryFormVersion,maxGroupSize:8,...body}:body)});});}
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
test('drawing invitation reaches the form and the venue map has a usable external fallback',async({page})=>{
  await mock(page);await page.goto('./');
  const invite=page.locator('.hero__actions a');
  await expect(invite).toHaveCount(1);
  await invite.focus();await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/#hot-spot$/);
  await expect(page.locator('[data-entry-form]')).toBeVisible();
  const map=page.locator('.venue-map iframe');
  await map.scrollIntoViewIfNeeded();
  await expect(map).toHaveAttribute('title',/Hotel Zazz/);
  await expect(map).toHaveAttribute('loading','lazy');
  const url=new URL(await map.getAttribute('src'));
  expect(url.origin).toBe('https://www.openstreetmap.org');
  expect(url.searchParams.get('marker')).toMatch(/^[-\d.]+,[-\d.]+$/);
  const fallback=page.getByRole('link',{name:'View larger map'});
  await fallback.focus();await expect(fallback).toBeFocused();
  await expect(fallback).toHaveAttribute('href',/^https:\/\/www\.openstreetmap\.org\//);
  await page.setViewportSize({width:320,height:568});await applyTextScale(page,200);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
test('entry validates and sends one free group, then shows a confirmation instruction',async({page})=>{
  let submitted;await mock(page,(path,request)=>{if(path==='/api/entries'){submitted=request.postDataJSON();return{ok:true};}return{registrationOpen:true};});
  await page.goto('./#hot-spot');await page.getByLabel('Your name',{exact:true}).fill('Sample Guest');await page.getByLabel('Email address',{exact:true}).fill('guest@example.com');await page.getByLabel('People in your group',{exact:true}).selectOption('4');await fillLocation(page);await page.locator('[name=consent]').check();await page.locator('[name=mediaConsent]').check();await page.getByRole('button',{name:'Enter the free drawing'}).click();
  await expect(page.locator('[data-entry-status]')).toContainText('Check your inbox');expect(submitted).toEqual({name:'Sample Guest',email:'guest@example.com',groupSize:4,...location,entryFormVersion,consent:true,mediaConsent:true,mediaConsentVersion:'hot-spot-media-2026-11-04'});expect(await page.evaluate(()=>Object.keys(localStorage))).toEqual([]);await expect(page.locator('[data-entry-form]')).not.toHaveAttribute('aria-busy','true');
});
test('entry and group edits require an explicit recording checkbox and expose the rules',async({page})=>{
  const submissions=[];
  await mock(page,(path,request)=>{
    if(path==='/api/entries') {submissions.push(request.postDataJSON());return {ok:true,entry:{name:'Guest',groupSize:2,status:'entered',canEdit:true,requiredMediaConsentVersion:'hot-spot-media-2026-11-04',requiredEntryFormVersion:entryFormVersion,maxGroupSize:8,...location}};}
    if(path.endsWith('/verify')) return {accessToken:'test-session',entry:{name:'Guest',groupSize:2,status:'entered',canEdit:true,requiredMediaConsentVersion:'hot-spot-media-2026-11-04',requiredEntryFormVersion:entryFormVersion,maxGroupSize:8,...location}};
    return {registrationOpen:true};
  });
  await page.goto('./#hot-spot');
  await page.getByLabel('Your name',{exact:true}).fill('Guest');
  await page.getByLabel('Email address',{exact:true}).fill('guest@example.test');
  await fillLocation(page);await page.locator('[name=consent]').check();
  const consent=page.locator('[name=mediaConsent]');
  await expect(consent).not.toBeChecked();
  await page.getByRole('button',{name:'Enter the free drawing'}).click();
  await expect(consent).toBeFocused();
  expect(submissions).toHaveLength(0);
  await page.keyboard.press('Space');
  await page.getByRole('button',{name:'Enter the free drawing'}).click();
  await expect(page.locator('[data-entry-status]')).toContainText('Check your inbox');
  expect(submissions[0].mediaConsent).toBe(true);
  await page.getByRole('link',{name:'Hot Spot rules',exact:true}).first().click();
  await expect(page.locator('h1')).toHaveText('Hot Spot rules.');
  await expect(page.locator('#recording')).toBeVisible();
  await page.goto('entry/#token=test-only');
  await fillLocation(page);await page.locator('[name=consent]').check();
  await expect(consent).not.toBeChecked();
  await page.getByRole('button',{name:'Save group details'}).click();
  expect(submissions).toHaveLength(1);
  await consent.check();
  await page.getByRole('button',{name:'Save group details'}).click();
  await expect(page.locator('[data-page-status]')).toContainText('saved');
  expect(submissions[1]).toMatchObject({mediaConsent:true,mediaConsentVersion:'hot-spot-media-2026-11-04'});
});

const streamUrl='https://reflect-city-of-albuquerque.cablecast.tv/cablecastapi/live?channel_id=2&use_cdn=true';
async function mockStream(page){await page.route('https://reflect-city-of-albuquerque.cablecast.tv/**',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><html lang="en"><title>Test player</title><body style="background:#000;color:#fff"><p>Channel 26 test player</p><button>Play</button></body></html>'}));}
test('display refresh swaps the fixed embed without reloading it and restores motion safely',async({page})=>{
  let mode='animation';
  await page.clock.install();
  await mock(page,()=>({registrationOpen:true,heroMedia:mode}));
  await mockStream(page);
  await page.goto('./');
  await expect(page.locator('[data-entry-form]')).toBeVisible();
  await expect(page.locator('[data-stream-player] iframe')).toHaveCount(0);
  await page.getByRole('button',{name:'Pause animation',exact:true}).focus();
  mode='channel26';await page.clock.fastForward(60_000);
  const frame=page.locator('[data-stream-player] iframe');
  await expect(frame).toHaveAttribute('src',streamUrl);
  await expect(page.locator('.hero__art')).toBeHidden();
  await expect(page.locator('#hero-title')).toBeFocused();
  const backgroundControl=page.locator('.hero__stream [data-motion-toggle]');
  await expect(backgroundControl).toBeVisible();await backgroundControl.click();
  await expect(backgroundControl).toHaveAccessibleName('Resume background animation');
  await expect.poll(()=>page.locator('.hero .falling-chiles__drop').first().evaluate(el=>el.getAnimations()[0]?.playState)).toBe('paused');
  await frame.evaluate(el=>el.dataset.retained='yes');
  await page.clock.fastForward(60_000);
  await expect(frame).toHaveAttribute('data-retained','yes');
  // A config outage retains the last known display and does not reload the stream.
  await page.unroute(api+'/**');await page.route(api+'/**',route=>route.abort());
  await page.clock.fastForward(60_000);
  await expect(frame).toHaveAttribute('data-retained','yes');
  await page.unroute(api+'/**');await mock(page,()=>({registrationOpen:true,heroMedia:'animation'}));
  await page.emulateMedia({reducedMotion:'reduce'});
  await page.locator('[data-hero-stream] a').focus();
  await page.clock.fastForward(60_000);
  await expect(frame).toHaveCount(0);
  await expect(page.locator('.hero__art')).toBeVisible();
  await expect(page.locator('#hero-title')).toBeFocused();
  await expect(page.locator('[data-motion-toggle]:visible')).toHaveCount(0);
});
test('stream and rules reflow on small phones and with enlarged text',async({page})=>{
  await mock(page,()=>({registrationOpen:true,heroMedia:'channel26'}));await mockStream(page);
  for(const [width,height] of [[1440,900],[375,667],[320,568]]) {
    await page.setViewportSize({width,height});await page.goto('./');await waitForStableRendering(page);
    await expect(page.locator('[data-stream-player] iframe')).toBeVisible();
    const player=await page.locator('[data-stream-player]').boundingBox();
    expect(player.width).toBeGreaterThanOrEqual(width<760?width-50:300);
    expect(player.y+player.height).toBeLessThanOrEqual(height);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await applyTextScale(page,200);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await page.goto('hot-spot-rules/');await waitForStableRendering(page);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await applyTextScale(page,200);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  }
  const results=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa','wcag22aa']).analyze();expect(results.violations).toEqual([]);
});
test('admin can save or restore homepage display after drawing lock, with honest error feedback',async({page})=>{
  const snapshot={entries:[],total:0,counts:{totalOrders:0,verifiedOrders:0,verifiedPeople:0},settings:{registrationOpen:false,capacity:2000,locked:true,heroMedia:'animation'},preview:null,drawing:null,outbox:{}};
  const writes=[];
  await mock(page,(path,request)=>{
    if(path.endsWith('/verify'))return {accessToken:'admin-session'};
    if(path==='/api/admin/display'){writes.push(request.postDataJSON());expect(request.headers().authorization).toBe('Bearer admin-session');snapshot.settings.heroMedia=request.postDataJSON().heroMedia;return {settings:snapshot.settings};}
    return snapshot;
  });
  await page.goto('admin/#token=test-only');
  await expect(page.getByRole('button',{name:'Save registration settings'})).toBeDisabled();
  await page.getByLabel('Show on the homepage').selectOption('channel26');
  await page.getByRole('button',{name:'Save homepage display'}).click();
  await expect(page.locator('[data-display-status]')).toContainText('now shows Channel 26');
  await page.reload();await expect(page.getByLabel('Show on the homepage')).toHaveValue('channel26');
  await page.getByLabel('Show on the homepage').selectOption('animation');
  await page.getByRole('button',{name:'Save homepage display'}).click();
  await expect(page.locator('[data-display-status]')).toContainText('now shows the chile animation');
  expect(writes).toEqual([{heroMedia:'channel26'},{heroMedia:'animation'}]);
  await page.unroute(api+'/**');await page.route(api+'/**',route=>route.abort());
  await page.getByLabel('Show on the homepage').selectOption('channel26');
  await page.getByRole('button',{name:'Save homepage display'}).click();
  await expect(page.locator('[data-display-status]')).toHaveAttribute('data-kind','error');
  await expect(page.getByRole('button',{name:'Save homepage display'})).toBeEnabled();
});
test('closed entry and network failure never show a false confirmation',async({page})=>{
  await mock(page,()=>({registrationOpen:false}));await page.goto('./');await expect(page.locator('[data-registration-status]')).toContainText('closed');await expect(page.locator('[data-entry-form]')).toBeHidden();
  await page.unroute(api+'/**');await page.route(api+'/**',route=>route.abort());await page.reload();await expect(page.locator('[data-registration-status]')).toContainText('could not reach');await expect(page.locator('[data-entry-form]')).toBeHidden();
});
test('new forms wait for a Worker that supports the required fields and consent',async({page})=>{
  await mock(page,path=>path.endsWith('/verify')?{accessToken:'test-session',entry:{name:'Guest',groupSize:1,status:'entered',canEdit:true}}:{registrationOpen:true,entryFormVersion:null});
  await page.goto('./');
  await expect(page.locator('[data-entry-form]')).toBeHidden();
  await expect(page.locator('[data-registration-status]')).toContainText('entry form is updated');
  await expect(page.locator('.hero__art')).toBeVisible();
  await page.goto('entry/#token=test-only');
  await expect(page.locator('[data-edit-entry]')).toBeHidden();
  await expect(page.locator('[data-entry-result]')).toContainText('Group editing is temporarily unavailable');
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
  await mock(page);await page.goto('./');await waitForStableRendering(page);const results=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa','wcag22aa']).analyze();expect(results.violations).toEqual([]);await applyTextScale(page,200);for(const width of [375,320]){await page.setViewportSize({width,height:667});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);expect(await page.locator('[data-entry-form] .field').evaluateAll(fields=>fields.every(field=>field.scrollWidth<=field.clientWidth+1))).toBe(true);}
});
test('countdown stops at zero after Mountain Time midnight',async({page})=>{
  await mock(page);await page.clock.install({time:new Date('2027-01-01T07:00:01Z')});await page.goto('./');await expect(page.locator('#countdown-title')).toHaveText('Happy New Year, Albuquerque!');await expect(page.locator('[data-time=days]')).toHaveText('00');await expect(page.locator('[data-time=seconds]')).toHaveText('00');
});
test('event, calendar and FAQ remain useful without JavaScript',async({browser})=>{
  const context=await browser.newContext({javaScriptEnabled:false,viewport:{width:375,height:812}});const page=await context.newPage();await page.goto('http://127.0.0.1:4173/nob-hill-chile-drop/');await expect(page.locator('h1')).toBeVisible();await expect(page.locator('#mobile-nav')).toBeVisible();await page.locator('summary').filter({hasText:'When does the chile drop?'}).click();await expect(page.locator('details[open]')).toContainText('January 1, 2027');await context.close();
});
test('verification clears link token and loads only the scoped group',async({page})=>{
  await mock(page,path=>path.endsWith('/verify')?{accessToken:'entry-session',entry:{name:'Sample Guest',email:'guest@example.com',groupSize:3,status:'entered',canEdit:true,requiredMediaConsentVersion:'hot-spot-media-2026-11-04',requiredEntryFormVersion:entryFormVersion,maxGroupSize:8,...location}}:{});await page.goto('entry/#token=sample-verification');await expect(page.locator('[data-entry-result]')).toContainText('Your email is confirmed');expect(new URL(page.url()).hash).toBe('');await expect(page.getByLabel('People in your group')).toHaveValue('3');await page.getByRole('button',{name:'Sign out of this entry'}).click();await expect(page.locator('[data-entry-link]')).toBeVisible();
});
test('admin protects drawing transitions and safely renders untrusted guest names',async({page})=>{
  const snapshot={entries:[{id:'one',name:'<img src=x onerror=alert(1)>',email:'test@example.com',groupSize:2,status:'entered'}],total:1,counts:{totalOrders:1,verifiedOrders:1,verifiedPeople:2},settings:{registrationOpen:true,capacity:2000,locked:false},preview:null,drawing:null,outbox:{sent:1}};
  await mock(page,(path)=>path.endsWith('/verify')?{accessToken:'admin-session'}:snapshot);await page.goto('admin/#token=admin-link');await expect(page.locator('[data-admin-dashboard]')).toBeVisible();await expect(page.getByRole('button',{name:'Prepare drawing'})).toBeDisabled();await expect(page.getByRole('button',{name:'Commit reviewed result'})).toBeDisabled();await expect(page.locator('[data-entries] img')).toHaveCount(0);await expect(page.locator('[data-entries]')).toContainText('<img src=x');expect(new URL(page.url()).hash).toBe('');await expect(page.locator('meta[name=robots]')).toHaveAttribute('content','noindex,follow');
});


test('location fields default country, block incomplete locations and offer only groups of one through eight, and round-trip owner edits',async({page})=>{
  const submissions=[];
  let entry={name:'Guest',groupSize:8,status:'entered',canEdit:true,requiredMediaConsentVersion:'hot-spot-media-2026-11-04',requiredEntryFormVersion:entryFormVersion,maxGroupSize:8,...location};
  await mock(page,(path,request)=>{
    if(path.endsWith('/verify'))return {accessToken:'entry-session',entry};
    if(path==='/api/entries'){const body=request.postDataJSON();submissions.push(body);entry={...entry,...body};return {ok:true,entry};}
    return {registrationOpen:true};
  });
  await page.goto('./#hot-spot');
  await page.getByLabel('Your name',{exact:true}).fill('Guest');
  await page.getByLabel('Email address',{exact:true}).fill('guest@example.test');
  await expect(page.getByLabel('Country',{exact:true})).toHaveValue('USA');
  await page.locator('[name=consent]').check();await page.locator('[name=mediaConsent]').check();
  const submit=page.getByRole('button',{name:'Enter the free drawing'});
  for(const field of ['city','stateProvince','country']){
    await fillLocation(page);await page.locator(`[name=${field}]`).fill('');await submit.click();
    await expect(page.locator(`[name=${field}]`)).toBeFocused();expect(submissions).toHaveLength(0);
  }
  await fillLocation(page);
  await expect(page.locator('[name=groupSize] option')).toHaveText(['1','2','3','4','5','6','7','8']);
  await page.locator('[name=groupSize]').selectOption('8');await submit.click();
  await expect(page.locator('[data-entry-status]')).toContainText('Check your inbox');
  expect(submissions[0]).toMatchObject({...location,groupSize:8,entryFormVersion});
  await expect(page.getByLabel('Country',{exact:true})).toHaveValue('USA');
  await page.goto('entry/#token=test-only');
  await expect(page.locator('[name=groupSize] option')).toHaveText(['1','2','3','4','5','6','7','8']);
  for(const [field,value] of Object.entries(location))await expect(page.locator(`[name=${field}]`)).toHaveValue(value);
  await page.locator('[name=city]').fill('Montréal');await page.locator('[name=stateProvince]').fill('Québec');await page.locator('[name=country]').fill('Canada');
  await page.locator('[name=consent]').check();await page.locator('[name=mediaConsent]').check();
  await page.getByRole('button',{name:'Save group details'}).click();
  await expect(page.locator('[data-page-status]')).toContainText('saved');
  expect(submissions[1]).toMatchObject({city:'Montréal',stateProvince:'Québec',country:'Canada',entryFormVersion});
  await expect(page.locator('[name=city]')).toHaveValue('Montréal');
});


test('photographic chiles fall vertically and share pause state across the page',async({page})=>{
  await mock(page);await page.goto('./');
  const hero=page.locator('.hero [data-falling-chiles]');
  const drop=hero.locator('.falling-chiles__drop').first();
  const footer=page.locator('.site-footer [data-falling-chiles]');
  const footerDrop=footer.locator('.falling-chiles__drop').first();
  await expect.poll(()=>drop.evaluate(el=>el.getAnimations()[0]?.playState)).toBe('running');
  await expect.poll(()=>footerDrop.evaluate(el=>el.getAnimations()[0]?.playState)).toBe('paused');
  const start=await drop.boundingBox();
  await expect.poll(async()=>{const next=await drop.boundingBox();expect(Math.abs(next.x-start.x)).toBeLessThan(.1);return next.y-start.y;}).toBeGreaterThan(3);
  await page.getByRole('button',{name:'Pause animation',exact:true}).click();
  const time=await drop.evaluate(el=>el.getAnimations()[0].currentTime);
  await footer.scrollIntoViewIfNeeded();
  await expect.poll(()=>footerDrop.evaluate(el=>el.getAnimations()[0]?.playState)).toBe('paused');
  await expect(page.getByRole('button',{name:'Resume animations',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Resume animations',exact:true}).focus();await page.keyboard.press('Enter');
  await expect.poll(()=>footerDrop.evaluate(el=>el.getAnimations()[0]?.playState)).toBe('running');
  expect(await drop.evaluate(el=>el.getAnimations()[0].currentTime)).toBe(time);
  await hero.scrollIntoViewIfNeeded();
  await expect.poll(()=>drop.evaluate(el=>el.getAnimations()[0]?.playState)).toBe('running');
  await expect.poll(()=>footerDrop.evaluate(el=>el.getAnimations()[0]?.playState)).toBe('paused');
  // Exercise the hidden-document lifecycle without opening external pages or sending requests.
  await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'));});
  await expect.poll(()=>drop.evaluate(el=>el.getAnimations()[0]?.playState)).toBe('paused');
  await page.evaluate(()=>{delete document.hidden;document.dispatchEvent(new Event('visibilitychange'));});
  await expect.poll(()=>drop.evaluate(el=>el.getAnimations()[0]?.playState)).toBe('running');
});

test('backgrounds are still with reduced motion, absent in forced colors and confined to the homepage',async({page})=>{
  await mock(page);await page.emulateMedia({reducedMotion:'reduce'});await page.goto('./');
  await expect(page.locator('[data-falling-chiles]')).toHaveCount(4);
  await expect(page.locator('[data-motion-toggle]:visible')).toHaveCount(0);
  expect(await page.locator('.falling-chiles__drop').evaluateAll(nodes=>nodes.every(node=>node.getAnimations().length===0))).toBe(true);
  const layer=await page.locator('.hero [data-falling-chiles]').boundingBox();
  const drop=await page.locator('.hero .falling-chiles__drop').first().boundingBox();
  expect(drop.y).toBeGreaterThan(layer.y);expect(drop.y).toBeLessThan(layer.y+layer.height);
  await page.emulateMedia({forcedColors:'active'});
  await expect(page.locator('[data-falling-chiles]:visible')).toHaveCount(0);
  await page.goto('entry/');await expect(page.locator('[data-falling-chiles]')).toHaveCount(0);
});


test('compact drawing field pairs wrap on narrow cards and enlarged text with keyboard order intact',async({page})=>{
  await mock(page);
  const form=page.locator('[data-entry-form]');
  for(const [width,paired] of [[1440,true],[1024,true],[768,false],[640,true],[375,false],[320,false]]){
    await page.setViewportSize({width,height:900});await page.goto('./');await waitForStableRendering(page);await expect(form).toBeVisible();
    for(const [a,b] of [['email','groupSize'],['city','stateProvince']]){
      const first=await form.locator(`[name=${a}]`).boundingBox(),second=await form.locator(`[name=${b}]`).boundingBox();
      if(paired){expect(Math.abs(first.y-second.y)).toBeLessThan(1);expect(second.x).toBeGreaterThan(first.x+first.width);}
      else expect(second.y).toBeGreaterThan(first.y+first.height);
      expect(first.height).toBeGreaterThanOrEqual(48);expect(second.height).toBeGreaterThanOrEqual(48);
    }
    await applyTextScale(page,200);
    for(const [a,b] of [['email','groupSize'],['city','stateProvince']]){
      const first=await form.locator(`[name=${a}]`).boundingBox(),second=await form.locator(`[name=${b}]`).boundingBox();expect(second.y).toBeGreaterThan(first.y+first.height);
    }
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  }
  await form.locator('[name=email]').focus();
  for(const name of ['groupSize','city','stateProvince','country']){await page.keyboard.press('Tab');await expect(form.locator(`[name=${name}]`)).toBeFocused();}
});
