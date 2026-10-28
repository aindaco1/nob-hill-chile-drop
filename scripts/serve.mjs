import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
const root = resolve('_site');
const prefix = '/nob-hill-chile-drop';
const types = { '.html':'text/html; charset=utf-8', '.css':'text/css', '.js':'text/javascript', '.svg':'image/svg+xml', '.png':'image/png', '.woff2':'font/woff2', '.ics':'text/calendar', '.txt':'text/plain', '.xml':'application/xml' };
const server = createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    if (pathname === prefix) {res.writeHead(302,{Location:prefix+'/'});return res.end();}
    if (!pathname.startsWith(prefix + '/')) {res.writeHead(404);return res.end('Not found');}
    let path = resolve(root, '.' + pathname.slice(prefix.length));
    if (!(path === root || path.startsWith(root+sep))) {res.writeHead(403);return res.end();}
    if ((await stat(path)).isDirectory()) path = resolve(path, 'index.html');
    const body = await readFile(path);
    res.writeHead(200, { 'Content-Type':types[extname(path)] || 'application/octet-stream', 'Cache-Control':'no-store' });res.end(body);
  } catch {res.writeHead(404);res.end('Not found');}
});
server.listen(Number(process.env.PORT || 4173), '127.0.0.1', () => console.log('Preview: http://127.0.0.1:4173/nob-hill-chile-drop/'));
process.on('SIGTERM',()=>server.close());
