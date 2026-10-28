import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
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
  assert.equal(config.baseurl,'/nob-hill-chile-drop');
});
