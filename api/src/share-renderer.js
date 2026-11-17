import { initWasm, Resvg } from '@resvg/resvg-wasm';

let initialized;
export function createShareRenderer(wasm, fonts) {
  return async svg => {
    initialized ||= initWasm(wasm).catch(error => { initialized = null; throw error; });
    await initialized;
    const renderer = new Resvg(svg, { font: { fontBuffers: fonts, defaultFontFamily: 'DM Sans 9pt' } });
    try {
      const image = renderer.render();
      try { return image.asPng(); } finally { image.free(); }
    } finally { renderer.free(); }
  };
}
