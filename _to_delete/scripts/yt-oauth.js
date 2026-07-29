// =====================================================================
// scripts/yt-oauth.js — diagnostic + autorizare YouTube pentru agentul SEO
// (Faza 4a din GHID_AGENT_SEO_ACTIUNI.md). Rulează LOCAL, cu Node 18+:
//
//   node scripts/yt-oauth.js test
//     → verifică un trio YT_CLIENT_ID / YT_CLIENT_SECRET / YT_REFRESH_TOKEN
//       direct la Google și îți spune EXACT care valoare e problema
//       (secret greșit, token mort, client nepotrivit) + canalul găsit.
//
//   node scripts/yt-oauth.js authorize
//     → obține un REFRESH TOKEN NOU fără OAuth Playground: pornește un
//       server pe http://localhost:8765, îți dă un link de deschis în
//       browser, prinde codul la redirect și îl schimbă în token.
//       CERINȚĂ (o singură dată): în Google Cloud Console → Credentials →
//       clientul „Web application" → Authorized redirect URIs → adaugă
//       exact  http://localhost:8765  → Save (poate dura ~1 min să intre
//       în vigoare).
//
// Nu are dependențe și nu scrie nimic pe disc — valorile se cer în
// terminal (Enter păstrează valoarea din variabilele de mediu, dacă există).
// =====================================================================
const readline = require('node:readline');
const http = require('node:http');

const clean = (v) => String(v || '').trim().replace(/^["']|["']$/g, '').trim();
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
let stdinClosed = false;
rl.on('close', () => { stdinClosed = true; });
const ask = (q, def = '') => new Promise((res) => {
  if (stdinClosed) return res(clean(def)); // stdin terminat (ex. pipe) → folosește env
  rl.question(def ? `${q} [Enter = valoarea din env, ${def.slice(0, 12)}…]: ` : `${q}: `, (a) => res(clean(a) || clean(def)));
  rl.once('close', () => res(clean(def))); // dublă rezolvare = inofensivă
});

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const REDIRECT = 'http://localhost:8765';
const SCOPE = 'https://www.googleapis.com/auth/youtube';

function verdictForTokenError(data) {
  const err = data.error || '';
  const desc = data.error_description || '';
  if (/client secret is invalid/i.test(desc) || err === 'invalid_client') {
    return '❌ CLIENT ID + SECRET NU SE POTRIVESC.\n   → În Cloud Console → Credentials, deschide clientul și copiază AMBELE valori din ACELAȘI client\n     (ID-ul se termină în .apps.googleusercontent.com, secretul începe cu GOCSPX-).\n     Dacă ai apăsat vreodată „Reset secret", e valabil DOAR cel afișat acum.';
  }
  if (err === 'invalid_grant') {
    return '❌ ID + SECRET SUNT BUNE, dar REFRESH TOKEN-UL e mort sau e de la ALT client.\n   → Generează unul nou:  node scripts/yt-oauth.js authorize\n     (Cauze tipice: aplicația era în „Testing" → tokenul expiră în 7 zile — apasă „Publish app";\n      accesul retras din myaccount.google.com → Security; token copiat parțial.)';
  }
  if (err === 'unauthorized_client') {
    return '❌ Clientul nu are voie cu acest flux (unauthorized_client).\n   → Clientul trebuie să fie de tip „Web application". Recreează-l dacă e „Desktop app".';
  }
  if (!err && data._raw != null) {
    return `❌ Răspuns neobișnuit de la Google (HTTP ${data._status}) — nu e JSON:\n   ${String(data._raw).slice(0, 200)}\n   (Rețea/proxy care blochează oauth2.googleapis.com? Încearcă de pe altă rețea.)`;
  }
  return `❌ Eroare de la Google: ${err} — ${desc || '(fără detalii)'}`;
}

// Citește răspunsul tolerant: JSON normal sau, dacă nu e JSON (proxy/firewall),
// păstrează textul brut ca să-l putem afișa în verdict.
async function readBody(res) {
  const text = await res.text().catch(() => '');
  try { return JSON.parse(text); } catch { return { _raw: text, _status: res.status }; }
}

async function tokenFromRefresh({ id, secret, refresh }) {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: id, client_secret: secret, refresh_token: refresh, grant_type: 'refresh_token' }),
  });
  return { ok: res.ok, data: await readBody(res) };
}

async function showChannel(accessToken) {
  const res = await fetch('https://www.googleapis.com/youtube/v3/channels?part=snippet,statistics&mine=true', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    console.log(`⚠️  Tokenul e valid, dar apelul YouTube a eșuat: ${data?.error?.message || res.status}`);
    console.log('   → Verifică în Cloud Console → APIs & Services → Library că „YouTube Data API v3" e ENABLED în același proiect.');
    return;
  }
  const ch = (data.items || [])[0];
  if (!ch) {
    console.log('⚠️  Autentificarea merge, dar contul autorizat NU are canal YouTube.');
    console.log('   → Refă autorizarea logat cu CONTUL CANALULUI (și alege canalul, nu contul personal, dacă Google întreabă).');
    return;
  }
  console.log(`✅ TOTUL FUNCȚIONEAZĂ. Canal: „${ch.snippet.title}" — ${ch.statistics.videoCount} clipuri, ${ch.statistics.subscriberCount} abonați.`);
  console.log('   Pune exact aceste 3 valori în Vercel (fără spații) și fă REDEPLOY.');
}

async function modeTest() {
  console.log('— Verific valorile direct la Google (nimic nu se salvează) —\n');
  const id = await ask('YT_CLIENT_ID', process.env.YT_CLIENT_ID);
  const secret = await ask('YT_CLIENT_SECRET', process.env.YT_CLIENT_SECRET);
  const refresh = await ask('YT_REFRESH_TOKEN', process.env.YT_REFRESH_TOKEN);
  rl.close();
  if (!id.endsWith('.apps.googleusercontent.com')) console.log('⚠️  ID-ul nu se termină în .apps.googleusercontent.com — pare incomplet.');
  if (!secret.startsWith('GOCSPX-')) console.log('⚠️  Secretul nu începe cu GOCSPX- — pare greșit/vechi.');
  if (!refresh.startsWith('1//')) console.log('⚠️  Refresh token-ul nu începe cu 1// — pare să NU fie un refresh token (codul de autorizare începe cu 4/ și NU e totuna).');
  const r = await tokenFromRefresh({ id, secret, refresh });
  if (!r.ok || !r.data.access_token) { console.log('\n' + verdictForTokenError(r.data)); process.exit(1); }
  console.log('\n✅ Schimbul refresh → access token a reușit.');
  await showChannel(r.data.access_token);
}

async function modeAuthorize() {
  console.log('— Autorizare nouă, fără OAuth Playground —');
  console.log(`  Cerință: clientul „Web application" are la Authorized redirect URIs și  ${REDIRECT}\n`);
  const id = await ask('YT_CLIENT_ID', process.env.YT_CLIENT_ID);
  const secret = await ask('YT_CLIENT_SECRET', process.env.YT_CLIENT_SECRET);
  rl.close();

  const authUrl = 'https://accounts.google.com/o/oauth2/v2/auth?' + new URLSearchParams({
    client_id: id, redirect_uri: REDIRECT, response_type: 'code',
    scope: SCOPE, access_type: 'offline', prompt: 'consent',
  });

  const server = http.createServer(async (req, res) => {
    const u = new URL(req.url, REDIRECT);
    if (u.pathname !== '/') { res.writeHead(404).end(); return; }
    const code = u.searchParams.get('code');
    const errParam = u.searchParams.get('error');
    const page = (msg) => { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(`<body style="font-family:sans-serif;padding:40px"><h2>${msg}</h2><p>Poți închide tabul — restul e în terminal.</p></body>`); };
    if (errParam) { page('❌ Autorizare refuzată: ' + errParam); console.log('\n❌ Google a răspuns cu:', errParam); server.close(); process.exit(1); }
    if (!code) { page('Aștept codul…'); return; }
    page('✅ Cod primit');
    const res2 = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: id, client_secret: secret, code, grant_type: 'authorization_code', redirect_uri: REDIRECT }),
    });
    const data = await readBody(res2);
    server.close();
    if (!res2.ok || !data.refresh_token) {
      console.log('\n' + verdictForTokenError(data));
      if (data.access_token && !data.refresh_token) console.log('   (Am primit access token dar NU refresh token — reia cu prompt=consent; scriptul îl cere deja, deci retrimite linkul și aprobă din nou.)');
      process.exit(1);
    }
    console.log('\n✅ REFRESH TOKEN NOU (pune-l în Vercel ca YT_REFRESH_TOKEN, apoi Redeploy):\n');
    console.log('   ' + data.refresh_token + '\n');
    await showChannel(data.access_token);
    process.exit(0);
  });

  server.listen(8765, () => {
    console.log('\n1) Deschide în browser (logat cu contul CANALULUI):\n');
    console.log('   ' + authUrl + '\n');
    console.log('2) Avansat → Accesează ExamenMate SEO → Continuare. Redirectul vine aici automat.\n   Aștept pe ' + REDIRECT + ' …');
  });
  server.on('error', (e) => { console.log('❌ Nu pot porni serverul local pe 8765:', e.message); process.exit(1); });
}

const mode = clean(process.argv[2]).toLowerCase();
if (mode === 'test') modeTest();
else if (mode === 'authorize') modeAuthorize();
else { console.log('Folosire:\n  node scripts/yt-oauth.js test        — verifică valorile existente\n  node scripts/yt-oauth.js authorize   — generează un refresh token nou'); process.exit(1); }
