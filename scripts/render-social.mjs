import { readFile } from 'node:fs/promises';
import { chromium } from '@playwright/test';
import YAML from 'yaml';

const event = YAML.parse(await readFile('_data/event.yml', 'utf8'));
const font = (await readFile('assets/fonts/barlow-condensed-latin-700-normal.woff2')).toString('base64');
const art = (await readFile('assets/art/chile-sign.svg')).toString('base64');
const escape = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;');
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
  await page.setContent(`<!doctype html><html lang="en"><style>
    @font-face{font-family:Barlow;src:url(data:font/woff2;base64,${font})}
    *{box-sizing:border-box}body{margin:0;background:#101921;color:#f3f0e5;font-family:Arial,sans-serif}
    main{height:630px;padding:52px 64px;position:relative;overflow:hidden}
    .name{font-size:19px;letter-spacing:3px;text-transform:uppercase;color:#d0ec91;margin:0 0 30px}
    h1{font:700 122px/.9 Barlow;margin:0;text-transform:uppercase;letter-spacing:-2px;position:relative;z-index:1}
    h1 span{color:#ff725d}img{position:absolute;width:580px;right:-14px;top:5px;transform:rotate(8deg)}
    .details{position:absolute;bottom:50px;left:64px;right:64px;border-top:1px solid #34434b;padding-top:23px;display:flex;justify-content:space-between;align-items:center;font-size:18px;line-height:1.6}
    .badge{background:#d0ec91;color:#101921;padding:14px 20px;font-size:16px;font-weight:bold}
    </style><main><p class="name">${escape(event.hero.eyebrow)}</p><h1>${escape(event.hero.line_one)}<br><span>${escape(event.hero.line_two)}</span></h1><img src="data:image/svg+xml;base64,${art}" alt=""><div class="details"><div>${escape(event.date)} · Midnight Mountain Time<br>${escape(event.venue)} · Albuquerque, New Mexico</div><span class="badge">FREE HOT SPOT DRAWING ↗</span></div></main></html>`);
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: 'assets/art/social-card.png' });
} finally { await browser.close(); }
