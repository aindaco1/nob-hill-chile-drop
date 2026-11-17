import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { countdown } from '../../assets/js/countdown.js';
import { createWorker } from '../src/worker.js';
import { shareSvg } from '../src/share-template.js';
import { createShareRenderer } from '../src/share-renderer.js';
import event from '../src/generated/share-data.json' with { type: 'json' };

const target = Date.parse(event.drop_at);
const imageRequest = (options = {}, query = '') => new Request(`https://api.example.test/share/countdown.png${query}`, options);
const env = { PUBLIC_SITE_URL: 'https://chiledrop.com', get DB() { throw new Error('Share image must not access D1'); } };

test('website and image share a clamped countdown with exact midnight and subsecond behavior', () => {
  assert.deepEqual(countdown(target, target - (2 * 86400 + 3 * 3600 + 4 * 60 + 5) * 1000), { ended:false,days:2,hours:3,minutes:4,seconds:5 });
  assert.deepEqual(countdown(target,target-500), { ended:false,days:0,hours:0,minutes:0,seconds:0 });
  assert.deepEqual(countdown(target,target), { ended:true,days:0,hours:0,minutes:0,seconds:0 });
  assert.deepEqual(countdown(target,target+50000), { ended:true,days:0,hours:0,minutes:0,seconds:0 });
  assert.equal(countdown(NaN,target),null);
  assert.equal(new Date(target).toISOString(),'2027-01-01T07:00:00.000Z');
});

test('crawler GET and HEAD need no Origin, auth, database or outbound fetch; other methods are denied', async () => {
  let renders = 0;
  const worker=createWorker({now:()=>target-61000,renderSharePng:async svg=>{renders++;assert.match(svg,/>01<\/text>/);assert.match(svg,/SECONDS/);return new Uint8Array([1,2,3]);},fetchTarget:()=>{throw new Error('No outbound request');}});
  const head=await worker.fetch(imageRequest({method:'HEAD'}),env);
  assert.equal(head.status,200);assert.equal(head.headers.get('content-type'),'image/png');assert.equal(await head.text(),'');assert.equal(renders,0);
  const response=await worker.fetch(imageRequest({},'?now=1900&text=%3Cscript%3E'),env);
  assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'public, max-age=0, must-revalidate');
  assert.deepEqual(new Uint8Array(await response.arrayBuffer()),new Uint8Array([1,2,3]));
  const invalid=await worker.fetch(imageRequest({method:'POST'}),env);
  assert.equal(invalid.status,405);assert.equal(invalid.headers.get('allow'),'GET, HEAD');assert.equal(renders,1);
  const privateRoute=await worker.fetch(new Request('https://api.example.test/api/admin/access'),env);
  assert.equal(privateRoute.status,403);
});

test('same-second crawls share one render, the next second refreshes, and midnight changes immediately', async () => {
  let now=target-1500,renders=0;
  const worker=createWorker({now:()=>now,renderSharePng:async svg=>{renders++;return new TextEncoder().encode(svg);}});
  await Promise.all([worker.fetch(imageRequest(),env),worker.fetch(imageRequest(),env)]);assert.equal(renders,1);
  now=target-500;const before=await worker.fetch(imageRequest(),env);assert.equal(renders,2);assert.doesNotMatch(await before.text(),/HAPPY NEW YEAR/);
  now=target;const after=await worker.fetch(imageRequest(),env);assert.equal(renders,3);assert.match(await after.text(),/HAPPY NEW YEAR/);
});

test('render failure redirects without caching to the timeless fallback and retries next request',async()=>{
  let fails=true;
  const worker=createWorker({now:()=>target-1000,renderSharePng:async()=>{if(fails)throw new Error('render failed');return new Uint8Array([1]);}});
  const response=await worker.fetch(imageRequest(),env);assert.equal(response.status,302);assert.equal(response.headers.get('location'),'https://chiledrop.com/assets/art/social-card.png');assert.equal(response.headers.get('cache-control'),'no-store');
  fails=false;assert.equal((await worker.fetch(imageRequest(),env)).status,200);
});

test('template escapes content and a timeless fallback never carries stale countdown numbers',()=>{
  const svg=shareSvg({...event,venue:'A <script> & "venue"'});
  assert.match(svg,/A &lt;script&gt; &amp; &quot;venue&quot;/);assert.doesNotMatch(svg,/UNTIL THE MIDNIGHT DROP|As of/);
  assert.match(shareSvg(event,target-1000),/Dec 31, 2026.*11:59:59 PM MST/);
  assert.match(shareSvg(event,target+1000),/HAPPY NEW YEAR/);
});

test('real WASM renderer emits changing 1200×630 PNGs with bundled brand fonts and artwork',async()=>{
  const root=new URL('../../',import.meta.url);
  const files=['@resvg/resvg-wasm/index_bg.wasm','@fontsource/barlow-condensed/files/barlow-condensed-latin-700-normal.woff2','@fontsource/dm-sans/files/dm-sans-latin-400-normal.woff2'];
  const [wasm,...fonts]=await Promise.all(files.map(file=>readFile(new URL(`node_modules/${file}`,root))));
  const render=createShareRenderer(wasm,fonts);
  const first=await render(shareSvg(event,Date.parse('2026-11-17T23:00:05Z')));
  const second=await render(shareSvg(event,Date.parse('2026-11-17T23:00:06Z')));
  assert.deepEqual([...first.slice(0,8)],[137,80,78,71,13,10,26,10]);
  const header=new DataView(first.buffer,first.byteOffset,first.byteLength);
  assert.equal(header.getUint32(16),1200);assert.equal(header.getUint32(20),630);assert.notDeepEqual(first,second);
  assert.ok(first.byteLength<1_000_000);
  await mkdir(new URL('work/share-countdown/',root),{recursive:true});
  await writeFile(new URL('work/share-countdown/countdown.png',root),first);
  await writeFile(new URL('work/share-countdown/new-year.png',root),await render(shareSvg(event,target)));
});
