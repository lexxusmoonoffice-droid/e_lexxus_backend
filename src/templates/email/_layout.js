/**
 * Shared email layout + helpers.
 * We hand-roll tiny templates in JS rather than pull handlebars —
 * simpler, zero deps, and the payloads here are small.
 */

function escape(s = '') {
  return String(s)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function rupees(n) {
  return `₹${Number(n || 0).toLocaleString('en-IN')}`;
}

function button(label, href) {
  return `
    <p style="margin:24px 0">
      <a href="${href}"
         style="display:inline-block;padding:12px 24px;background:#111;color:#fff;
                text-decoration:none;border-radius:6px;font-weight:600">
        ${escape(label)}
      </a>
    </p>
  `;
}

/**
 * Wrap an inner body with a branded shell.
 *   layout({ appName, title, body })
 */
function layout({ appName, title, body, preheader }) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width">
  <title>${escape(title || appName)}</title>
</head>
<body style="margin:0;padding:0;background:#f7f7f7;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#111">
  ${preheader ? `<div style="display:none;overflow:hidden;max-height:0;opacity:0">${escape(preheader)}</div>` : ''}
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:24px 0">
    <tr><td align="center">
      <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:12px;padding:32px;max-width:560px">
        <tr><td>
          <h1 style="margin:0 0 24px;font-size:20px;font-weight:700;letter-spacing:-0.5px">${escape(appName)}</h1>
          ${body}
          <p style="margin:32px 0 0;font-size:12px;color:#888">
            — The ${escape(appName)} team
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

module.exports = { layout, escape, rupees, button };
