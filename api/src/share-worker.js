import wasm from '@resvg/resvg-wasm/index_bg.wasm';
import heading from '@fontsource/barlow-condensed/files/barlow-condensed-latin-700-normal.woff2';
import body from '@fontsource/dm-sans/files/dm-sans-latin-400-normal.woff2';
import { createShareRenderer } from './share-renderer.js';

export const renderSharePng = createShareRenderer(wasm, [new Uint8Array(heading), new Uint8Array(body)]);
