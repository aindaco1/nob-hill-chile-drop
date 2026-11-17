// Event-specific presentation only. No remote images, fonts, tracking or scripts.
export function escapeHtml(value) {
  return String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}

export function paragraph(text) {
  return `<p style="margin:0 0 20px;font-size:16px;line-height:1.6">${escapeHtml(text)}</p>`;
}

export function action(url, label) {
  if (!['https:', 'http:'].includes(new URL(url).protocol)) throw new Error('Invalid email action URL');
  const href = escapeHtml(url);
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:24px 0"><tr><td bgcolor="#d0ec91" style="border:1px solid #101921;border-radius:3px;text-align:center"><a href="${href}" style="display:inline-block;padding:16px 20px;border-radius:3px;color:#101921;font-family:Arial,sans-serif;font-size:16px;line-height:1.4;font-weight:bold;text-decoration:none">${escapeHtml(label)} &#8594;</a></td></tr></table><p style="margin:0 0 24px;font-size:14px;line-height:1.6;color:#43514d">If the button does not work, copy and paste this address into your browser:<br><span style="overflow-wrap:anywhere;word-break:break-all">${href}</span></p>`;
}

export function detailsTable(rows) {
  return `<table cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:0 0 24px;border-collapse:collapse;font-size:16px;line-height:1.5;overflow-wrap:anywhere">${rows.map(([label, value]) => `<tr><th scope="row" align="left" style="padding:10px 12px 10px 0;border-bottom:1px solid #cad0bc;font-weight:normal">${escapeHtml(label)}</th><td align="right" style="padding:10px 0;border-bottom:1px solid #cad0bc;font-weight:bold">${escapeHtml(value)}</td></tr>`).join('')}</table>`;
}

export function emailDocument({ title, preview, body }) {
  return `<!doctype html>
<html lang="en" dir="ltr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title></head>
<body style="margin:0;padding:0;background-color:#101921;color:#101921;font-family:Arial,Helvetica,sans-serif">
<div lang="en" dir="ltr" aria-hidden="true" style="display:none;max-height:0;overflow:hidden;mso-hide:all">${escapeHtml(preview)}</div>
<table lang="en" dir="ltr" role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#101921"><tr><td align="center" style="padding:28px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#f3f0e5" style="max-width:600px;background-color:#f3f0e5;color:#101921;border-top:6px solid #d0ec91">
<tr><td bgcolor="#192630" style="padding:24px;color:#f9f7ee;border-bottom:3px solid #ff725d"><p style="margin:0 0 5px;font-family:Georgia,serif;font-size:20px;font-style:italic;color:#d0ec91">Nob Hill</p><p style="margin:0;font-family:'Arial Narrow',Arial,sans-serif;font-size:32px;line-height:1.1;font-weight:bold;letter-spacing:1px;color:#f9f7ee">CHILE DROP</p><p style="margin:12px 0 0;font-size:14px;line-height:1.5;color:#f9f7ee">NEW YEAR’S EVE IN ALBUQUERQUE</p></td></tr>
<tr><td style="padding:28px 24px 8px"><h1 style="margin:0 0 24px;font-family:'Arial Narrow',Arial,sans-serif;font-size:28px;line-height:1.2;color:#101921">${escapeHtml(title)}</h1>${body}</td></tr>
<tr><td style="padding:20px 24px;border-top:1px dashed #7c8972;color:#43514d"><p style="margin:0;font-size:14px;line-height:1.6">Nob Hill Chile Drop<br>December 31, 2026 · Hotel Zazz<br>Nob Hill, Albuquerque</p></td></tr>
</table></td></tr></table></body></html>`;
}

export function entryLinkEmail(url, minutes) {
  const duration = minutes === 60 ? '1 hour' : `${minutes} minutes`;
  const introduction = 'Confirm your email to enter your group in the free Nob Hill Chile Drop drawing. Already confirmed? Use this link to view or manage your entry.';
  const expiry = `This one-time link expires ${duration} after you requested it.`;
  const outcome = 'Entry is free and does not guarantee Hot Spot admission. Your whole group stays together if selected. We’ll email you the result after the drawing, whether your group is selected or waitlisted.';
  const privacy = 'Keep this link private. If you did not request it, ignore this email. Nothing will be verified without using the link.';
  const title = 'Confirm your drawing entry';
  return {
    subject: 'Verify your free Chile Drop drawing entry',
    text: `${introduction}\n\n${expiry}\n\nConfirm or view your entry:\n${url}\n\n${outcome}\n\nOne group per email address.\n\n${privacy}\n\nNob Hill Chile Drop`,
    html: emailDocument({ title, preview: `Your private link expires in ${duration}. Entry does not guarantee Hot Spot admission.`,
      body: paragraph(introduction) + paragraph(expiry) + action(url, 'Confirm or view my entry') + paragraph(outcome) + paragraph('One group per email address.') + paragraph(privacy) })
  };
}

export function staffLinkEmail(url, role) {
  const volunteer = role === 'volunteer';
  const title = volunteer ? 'Volunteer check-in' : 'Organizer sign-in';
  const purpose = volunteer ? 'Use your private link to sign in to volunteer check-in.' : 'Use your private link to sign in to the organizer desk.';
  const expiry = 'This one-time link expires 15 minutes after you requested it.';
  const privacy = 'Only use this link on your own device. Do not forward it. If you did not request it, ignore this email.';
  return {
    subject: volunteer ? 'Sign in to Chile Drop volunteer check-in' : 'Sign in to Chile Drop administration',
    text: `${purpose}\n\n${expiry}\n${url}\n\n${privacy}\n\nNob Hill Chile Drop`,
    html: emailDocument({ title, preview: 'Your private sign-in link expires in 15 minutes.',
      body: paragraph(purpose) + paragraph(expiry) + action(url, volunteer ? 'Open volunteer check-in' : 'Open organizer desk') + paragraph(privacy) })
  };
}
