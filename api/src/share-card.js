import event from './generated/share-data.json' with { type: 'json' };
import { shareSvg } from './share-template.js';

export function createShareCard({ renderPng, now }) {
  // Only one second of public image data per isolate; concurrent crawls share a render.
  let cached;
  return async (request, env) => {
    if (!['GET', 'HEAD'].includes(request.method)) return new Response(null, { status: 405, headers: { Allow: 'GET, HEAD', 'Cache-Control': 'no-store' } });
    const time = now(), target = Date.parse(event.drop_at);
    const second = `${time >= target}:${Math.floor((target - time) / 1000)}`;
    const headers = { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=0, must-revalidate', 'X-Content-Type-Options': 'nosniff' };
    if (request.method === 'HEAD') return new Response(null, { headers });
    try {
      if (!cached || cached.second !== second) cached = { second, png: renderPng(shareSvg(event, time)) };
      const png = await cached.png;
      return new Response(png, { headers: { ...headers, 'Content-Length': String(png.byteLength) } });
    } catch {
      cached = null;
      // A crawler still gets the branded, timeless image if rasterization fails.
      return new Response(null, { status: 302, headers: { Location: `${env.PUBLIC_SITE_URL.replace(/\/$/, '')}/assets/art/social-card.png`, 'Cache-Control': 'no-store' } });
    }
  };
}
