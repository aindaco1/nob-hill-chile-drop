import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { parse } from 'yaml';

await mkdir('assets/fonts', { recursive: true });
const fonts = [['barlow-condensed', '700'], ['dm-sans', '400'], ['dm-sans', '600']];
for (const [family, weight] of fonts) {
  const file = `${family}-latin-${weight}-normal.woff2`;
  await copyFile(`node_modules/@fontsource/${family}/files/${file}`, `assets/fonts/${file}`);
}
for (const family of ['barlow-condensed', 'dm-sans']) {
  await copyFile(`node_modules/@fontsource/${family}/LICENSE`, `assets/fonts/OFL-${family}.txt`);
}
await copyFile('shared/dust-wave-platform/packages/site-shell/src/header-nav-browser.js', 'assets/js/header-nav.js');
await copyFile('shared/dust-wave-platform/packages/admin-shell/src/api-client.js', 'assets/js/api-client.js');
const event = parse(await readFile('_data/event.yml', 'utf8'));
const timestamp = date => date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
const start = new Date(event.drop_at);
const escape = s => s.replaceAll('\\', '\\\\').replaceAll('\n', '\\n').replaceAll(',', '\\,').replaceAll(';', '\\;');
// The calendar marks only the drop, not an invented arrival time.
const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Nob Hill Chile Drop//Event//EN', 'CALSCALE:GREGORIAN', 'BEGIN:VEVENT', 'UID:nob-hill-chile-drop-2027@dustwave.xyz', 'DTSTAMP:20261028T000000Z', `DTSTART:${timestamp(start)}`, `DTEND:${timestamp(new Date(start.getTime() + 60000))}`, `SUMMARY:${escape(event.name + ' — midnight drop')}`, `LOCATION:${escape(event.venue + ', ' + event.location)}`, 'DESCRIPTION:The chile drops at midnight Mountain Time. Check the website for arrival times and admission details.', 'URL:https://aindaco1.github.io/nob-hill-chile-drop/', 'END:VEVENT', 'END:VCALENDAR'];
await writeFile('event.ics', lines.map(line => line.match(/.{1,70}/gu).join('\r\n ')).join('\r\n') + '\r\n');
