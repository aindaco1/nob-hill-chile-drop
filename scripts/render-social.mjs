import { readFile, writeFile } from 'node:fs/promises';
import './prepare-share.mjs';
import { shareSvg } from '../api/src/share-template.js';
import { createShareRenderer } from '../api/src/share-renderer.js';

const root = new URL('../', import.meta.url);
const event = JSON.parse(await readFile(new URL('api/src/generated/share-data.json', root), 'utf8'));
const files = ['@resvg/resvg-wasm/index_bg.wasm', '@fontsource/barlow-condensed/files/barlow-condensed-latin-700-normal.woff2', '@fontsource/dm-sans/files/dm-sans-latin-400-normal.woff2'];
const [wasm, ...fonts] = await Promise.all(files.map(file => readFile(new URL(`node_modules/${file}`, root))));
const render = createShareRenderer(wasm, fonts);
// With no time argument this is deliberately timeless, safe for fallback and old links.
await writeFile(new URL('assets/art/social-card.png', root), await render(shareSvg(event)));
