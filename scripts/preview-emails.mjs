// Local synthetic previews only: the fixture uses in-memory SQLite and stub mail.
import { mkdir, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { fixture } from '../api/test/helpers.js';
import { decodePayload, queueWeeklyReport } from '../api/src/mail.js';
import { resultEmail } from '../api/src/tickets.js';

export async function buildEmailPreviews() {
  const f = fixture();
  f.env.PUBLIC_SITE_URL = 'https://chiledrop.example.test';
  try {
    const id = f.seedEntry(5, false, 'Sample Guest');
    f.seedEntry(4, true, 'Another Sample Guest');
    const email = f.DB.prepare('SELECT email FROM entries WHERE id=?').bind(id).first().email;
    await f.request('/api/entries/link', { method: 'POST', body: { email } });
    await f.request('/api/admin/login', { method: 'POST', body: { email: f.env.ADMIN_EMAILS } });
    await f.request('/api/door/login', { method: 'POST', body: { email: f.env.ADMIN_EMAILS } });
    await queueWeeklyReport(f.env, f.now());
    const previews = [];
    for (const job of f.DB.prepare('SELECT * FROM outbox').all().results) {
      previews.push({ name: job.kind, message: await decodePayload(f.env, job.payload, job.id) });
    }
    for (const status of ['selected', 'waitlisted']) {
      previews.push({ name: status, message: await resultEmail(f.env, {
        id, name: 'Sample Guest', email, group_size: 5, status, preview_id: crypto.randomUUID(), selected_cutoff_at: null
      }) });
    }
    return previews.map(({ name, message }) => {
      let html = message.html;
      // Mail clients render CID attachments; standalone previews need a data URL.
      for (const attachment of message.attachments || []) {
        html = html.replace(`cid:${attachment.content_id}`, `data:${attachment.content_type};base64,${attachment.content}`);
      }
      return { name, message, html };
    });
  } finally { f.close(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const directory = 'work/email-previews';
  await mkdir(directory, { recursive: true });
  const previews = await buildEmailPreviews();
  for (const { name, html, message } of previews) {
    await writeFile(`${directory}/${name}.html`, html);
    await writeFile(`${directory}/${name}.txt`, message.text);
  }
  await writeFile(`${directory}/index.html`, `<!doctype html><html lang="en"><meta charset="utf-8"><title>Chile Drop email previews</title><h1>Chile Drop email previews</h1><p>Synthetic sample data. No emails sent. Action links use a reserved example.test domain and do not connect to the live service.</p><ul>${previews.map(({ name }) => `<li><a href="${name}.html">${name.replaceAll('_', ' ')}</a> · <a href="${name}.txt">plain text</a></li>`).join('')}</ul></html>`);
  console.log(`Wrote ${previews.length} synthetic previews to ${directory}/index.html`);
}
