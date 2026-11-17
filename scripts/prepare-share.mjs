import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { parse } from 'yaml';

const root = new URL('../', import.meta.url);
const event = parse(await readFile(new URL('_data/event.yml', root), 'utf8'));
if (!Number.isFinite(Date.parse(event.drop_at))) throw new Error('The event needs a valid drop_at instant.');
const { name, date, drop_at, timezone, venue, location, hero } = event;
const art = await readFile(new URL('assets/art/chile-sign.svg', root), 'utf8');
await mkdir(new URL('api/src/generated/', root), { recursive: true });
const path = new URL('api/src/generated/share-data.json', root);
const content = JSON.stringify({ name, date, drop_at, timezone, venue, location, hero, art }) + '\n';
const previous = await readFile(path, 'utf8').catch(error => { if (error.code === 'ENOENT') return null; throw error; });
// Do not trigger Wrangler's file watcher again when the generated payload is unchanged.
if (previous !== content) await writeFile(path, content);
