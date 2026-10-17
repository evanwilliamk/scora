// Small HTML pages the OAuth callbacks show in the browser before handing
// back to the app. Every dynamic value is escaped: query params and names
// come from outside and must never become markup or script.

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// A JS string literal safe to drop inside a <script> block.
export function scriptString(s: string): string {
  return JSON.stringify(s)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

// Fixed copy for OAuth error codes (RFC 6749 §4.1.2.1). The raw query value
// is never shown: a crafted link could otherwise put any text on our domain.
export function oauthErrorMessage(code: unknown): string {
  switch (code) {
    case 'access_denied':
      return 'Access was not granted.';
    case 'temporarily_unavailable':
    case 'server_error':
      return 'Oura is having trouble right now. Try again in a few minutes.';
    default:
      return 'The connection did not complete.';
  }
}

export interface ResultPage {
  title: string;
  lines?: string[];
  // scora:// link to reopen the app. When set, the page opens it right away
  // and keeps a button for when the browser blocks that.
  deepLink?: string;
  buttonLabel?: string;
}

export function resultPage(p: ResultPage): string {
  const lines = (p.lines ?? []).map((l) => `<p>${escapeHtml(l)}</p>`).join('\n          ');
  const link = p.deepLink;
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${escapeHtml(p.title)}</title>
    <style>
      body { background: #000; color: #fff; font-family: system-ui; margin: 0; padding: 40px; display: flex; align-items: center; justify-content: center; min-height: 100vh; box-sizing: border-box; }
      .container { max-width: 400px; text-align: center; }
      .logo { font-size: 100px; margin-bottom: 20px; }
      h1 { font-size: 36px; margin: 0 0 20px; font-weight: 700; }
      p { color: #999; font-size: 16px; margin: 0 0 16px; }
      a { display: inline-block; margin-top: 14px; padding: 14px 32px; background: #fff; color: #000; text-decoration: none; border-radius: 4px; font-weight: 600; }
    </style>
  </head>
  <body>
    <div class="container">
      <div class="logo">S</div>
      <h1>${escapeHtml(p.title)}</h1>
          ${lines}
      ${link ? `<a href="${escapeHtml(link)}">${escapeHtml(p.buttonLabel ?? 'Open SCORA')}</a>` : ''}
    </div>
    ${link ? `<script>setTimeout(function () { window.location.href = ${scriptString(link)}; }, 100);</script>` : ''}
  </body>
</html>`;
}
