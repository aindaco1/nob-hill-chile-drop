import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { parse } from 'yaml';
import { assertConsumerPin } from '../shared/dust-wave-platform/packages/test-core/src/consumer-pin.js';
const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
test('event midnight is January 1 in Mountain Time, with no invented footage or payment CTA',()=>{
  const e=parse(read('_data/event.yml'));
  assert.equal(new Date(e.drop_at).toISOString(),'2027-01-01T07:00:00.000Z');
  assert.equal(e.venue,'Hotel Zazz');
  assert.equal(e.film.youtube_id,'');
  assert.match(e.hero.primary_label,/free drawing/);
  assert.doesNotMatch(read('index.html'),/stripe|payment|checkout|\$1\.50/i);
});
test('shared packages stay on the documented immutable gitlink',()=>{
  const pin=JSON.parse(read('platform.json'));
  assertConsumerPin({root:process.cwd(),expectedCommit:pin.commit,packages:pin.packages});
});
test('private service, configuration, docs and dependencies are excluded from Pages output',()=>{
  const config=parse(read('_config.yml'));
  for(const path of ['api','shared','node_modules','docs','tests','scripts','platform.json']) assert.ok(config.exclude.includes(path));
});
test('share build uses the canonical event and art without retriggering its own file watcher',()=>{
  execFileSync(process.execPath,['scripts/prepare-share.mjs']);
  const path='api/src/generated/share-data.json';
  const before=statSync(path).mtimeMs;
  const data=JSON.parse(read(path));
  assert.equal(data.drop_at,parse(read('_data/event.yml')).drop_at);
  assert.equal(data.art,read('assets/art/chile-sign.svg'));
  execFileSync(process.execPath,['scripts/prepare-share.mjs']);
  assert.equal(statSync(path).mtimeMs,before);
});
