import { countdown } from '../../assets/js/countdown.js';

const escape = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&apos;');

// Shared by the live handler and the committed, timeless fallback image.
export function shareSvg(event, now = null) {
  const clock = now === null ? null : countdown(Date.parse(event.drop_at), now);
  const asOf = clock ? new Intl.DateTimeFormat('en-US', { timeZone: event.timezone, month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', second: '2-digit', timeZoneName: 'short' }).format(now) : '';
  const art = event.art.replace('<svg ', '<svg x="700" y="8" width="490" height="536" ');
  let panel;
  if (clock?.ended) {
    panel = '<text x="86" y="402" font-size="50">HAPPY NEW YEAR,</text><text x="86" y="458" font-size="50">ALBUQUERQUE!</text>';
  } else if (clock) {
    panel = '<text x="86" y="363" font-family="DM Sans 9pt" font-size="16" letter-spacing="2">UNTIL THE MIDNIGHT DROP</text>' + ['days', 'hours', 'minutes', 'seconds'].map((unit, index) => `<text x="${86 + index * 145}" y="437" font-size="78">${String(clock[unit]).padStart(2, '0')}</text><text x="${86 + index * 145}" y="462" font-family="DM Sans 9pt" font-size="16">${unit.toUpperCase()}</text>`).join('');
  } else {
    panel = '<text x="86" y="399" font-size="54">MIDNIGHT MOUNTAIN TIME</text><text x="86" y="447" font-family="DM Sans 9pt" font-size="24">ONE VERY ALBUQUERQUE NEW YEAR.</text>';
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
    <rect width="1200" height="630" fill="#101921"/>${art}
    <g fill="#f3f0e5" font-family="Barlow Condensed" font-weight="700">
      <text x="64" y="68" fill="#d0ec91" font-family="DM Sans 9pt" font-weight="400" font-size="20" letter-spacing="3">${escape(event.hero.eyebrow.toUpperCase())}</text>
      <text x="60" y="183" font-size="122">${escape(event.hero.line_one.toUpperCase())}</text>
      <text x="60" y="294" font-size="122" fill="#ff725d">${escape(event.hero.line_two.toUpperCase())}</text>
      <rect x="64" y="334" width="605" height="146" fill="#1c2d36"/><rect x="64" y="334" width="5" height="146" fill="#d0ec91"/>
      <g fill="#d0ec91">${panel}</g>
      <path d="M64 510H1136" stroke="#52636a"/>
      <g font-family="DM Sans 9pt" font-weight="400" font-size="20">
        <text x="64" y="548">${escape(event.date)} · Midnight Mountain Time</text>
        <text x="64" y="580">${escape(event.venue)} · ${escape(event.location)}</text>
      </g>
      <rect x="812" y="530" width="324" height="54" fill="#d0ec91"/>
      <text x="974" y="565" text-anchor="middle" fill="#101921" font-size="27">FREE HOT SPOT DRAWING</text>
      <text x="64" y="610" font-family="DM Sans 9pt" font-weight="400" font-size="14" fill="#b5c0c4">${clock ? `As of ${escape(asOf)}` : escape(event.name)}</text>
    </g>
  </svg>`;
}
