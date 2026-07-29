// =====================================================================
// api/social-image.js — GENERATORUL DE CARDURI BRANDED (Faza 3c din
// GHID_AGENT_SEO_ACTIUNI.md). Rezolvă cerința de media a Instagramului:
// randează carduri JPEG 1080×1080 în culorile ExamenMate, direct din
// parametrii URL-ului — fără Canva, fără fișiere de întreținut.
//
//   GET /api/social-image?template=formula&title=...&subtitle=...&badge=...&sig=...
//
// Șabloane: formula | exercitiu | greseala | countdown | anunt.
// Agentul NU cheamă endpointul direct: unealta schedule_social primește
// `image: {template, title, subtitle, badge}`, iar serverul construiește
// URL-ul SEMNAT (HMAC în api/_lib/social.js) — endpointul e public (Meta
// descarcă imaginea de aici la publicare), dar nimeni nu poate genera
// carduri cu alt text fără semnătură.
//
// Lanțul de randare: satori (layout + fonturi → SVG cu glife-contururi)
// → sharp (SVG → JPEG). Fonturile brandului stau în api/_lib/fonts/
// (DM Sans + Fraunces, cu diacritice; DejaVu Sans pentru simbolurile
// matematice π √ Δ ≈ — de aceea textul cardurilor folosește Unicode,
// NU LaTeX). Necesită `npm install` (satori + sharp din package.json);
// fără ele răspunde 501 cu mesaj clar, restul agentului funcționând normal.
// =====================================================================
const fs = require('fs');
const path = require('path');
const social = require('./_lib/social');

// ─── Brandul (oglinda variabilelor din src/styles/global.css) ────────────────
const NAVY = '#0f2b44', NAVY_DARK = '#091e30', NAVY_LIGHT = '#183d5e';
const GOLD = '#e8b931', GOLD_LIGHT = '#f5d76e';
const WHITE = '#ffffff', MUTED = '#b8c4d4';

const TEMPLATES = {
  formula:   { label: 'FORMULA ZILEI' },
  exercitiu: { label: 'EXERCIȚIUL ZILEI', footer: 'Răspunsul — în comentarii' },
  greseala:  { label: 'GREȘEALA FRECVENTĂ' },
  countdown: { label: 'NUMĂRĂTOAREA INVERSĂ' },
  anunt:     { label: 'NOU PE EXAMENMATE' },
};

// element „react-like" pentru satori, fără React
const h = (type, style, ...children) => ({
  type,
  props: { style, children: children.length === 1 ? children[0] : children },
});

// mărimea titlului scade cu lungimea textului (să încapă frumos)
function titleSize(text, base = 88, min = 44) {
  const len = String(text || '').length;
  if (len <= 18) return base;
  if (len <= 34) return 72;
  if (len <= 60) return 58;
  if (len <= 90) return 50;
  return min;
}

// Construiește arborele cardului (pur — testat în test/social.test.js).
function buildCard({ template = 'anunt', title = '', subtitle = '', badge = '' }) {
  const t = TEMPLATES[template] || TEMPLATES.anunt;
  const isCountdown = template === 'countdown';

  const logo = h('div', { display: 'flex', alignItems: 'baseline' },
    h('span', { fontFamily: 'Fraunces', fontSize: 44, fontWeight: 800, color: WHITE }, 'Examen'),
    h('span', { fontFamily: 'Fraunces', fontSize: 44, fontWeight: 800, color: GOLD }, 'Mate'),
  );

  const header = h('div', { display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' },
    logo,
    badge
      ? h('div', {
          display: 'flex', fontFamily: 'DM Sans', fontSize: 28, fontWeight: 700, color: GOLD_LIGHT,
          border: `2px solid ${GOLD}`, borderRadius: 999, padding: '10px 26px',
        }, badge)
      : h('div', { display: 'flex' }),
  );

  const label = h('div', { display: 'flex' },
    h('div', {
      display: 'flex', fontFamily: 'DM Sans', fontSize: 30, fontWeight: 700, letterSpacing: 6,
      color: NAVY_DARK, background: GOLD, borderRadius: 12, padding: '14px 30px',
    }, t.label));

  const middle = isCountdown
    ? h('div', { display: 'flex', flexDirection: 'column', alignItems: 'center', width: '100%' },
        h('div', { display: 'flex', fontFamily: 'Fraunces', fontSize: 300, fontWeight: 800, color: GOLD, lineHeight: 1 }, String(title)),
        h('div', { display: 'flex', fontFamily: 'DM Sans', fontSize: 46, fontWeight: 700, color: WHITE, textAlign: 'center', marginTop: 10 }, String(subtitle)),
      )
    : h('div', { display: 'flex', flexDirection: 'column', width: '100%' },
        h('div', {
          display: 'flex', fontFamily: 'Fraunces', fontSize: titleSize(title), fontWeight: 800,
          color: WHITE, lineHeight: 1.15, textWrap: 'balance',
        }, String(title)),
        subtitle
          ? h('div', { display: 'flex', fontFamily: 'DM Sans', fontSize: 38, color: MUTED, lineHeight: 1.4, marginTop: 34 }, String(subtitle))
          : h('div', { display: 'flex' }),
      );

  const footer = h('div', { display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' },
    h('div', { display: 'flex', alignItems: 'center' },
      h('div', { display: 'flex', width: 54, height: 6, background: GOLD, borderRadius: 3, marginRight: 18 }),
      h('span', { fontFamily: 'DM Sans', fontSize: 30, fontWeight: 700, color: WHITE }, 'examenmate.com'),
    ),
    h('span', { fontFamily: 'DM Sans', fontSize: 26, color: MUTED }, t.footer || 'Matematică pentru Evaluarea Națională și BAC'),
  );

  // simboluri matematice discrete în fundal (opacitate 5%)
  const deco = (txt, top, left, size, rot) => h('div', {
    display: 'flex', position: 'absolute', top, left, fontFamily: 'DM Sans', fontWeight: 700,
    fontSize: size, color: WHITE, opacity: 0.05, transform: `rotate(${rot}deg)`,
  }, txt);

  return h('div', {
    display: 'flex', flexDirection: 'column', justifyContent: 'space-between',
    width: 1080, height: 1080, padding: 70, position: 'relative',
    background: `linear-gradient(140deg, ${NAVY_DARK} 0%, ${NAVY} 55%, ${NAVY_LIGHT} 100%)`,
  },
    deco('π', 660, 900, 220, -12), deco('√x', 180, 760, 170, 8),
    deco('∑', 700, 60, 200, 10), deco('÷', 340, 100, 150, -8),
    header, label, middle, footer,
  );
}

// ─── Fonturile brandului (încărcate o dată per instanță) ─────────────────────
function fontDir() {
  const local = path.join(__dirname, '_lib', 'fonts');
  if (fs.existsSync(local)) return local;
  return path.join(process.cwd(), 'api', '_lib', 'fonts'); // fallback (bundling)
}

let _fonts = null;
function loadFonts() {
  if (_fonts) return _fonts;
  const dir = fontDir();
  const read = (f) => fs.readFileSync(path.join(dir, f));
  // Fallback-ul per-glifă al satori parcurge lista ÎN ORDINE, deci:
  //   1. „Fraunces Ext" (subsetul latin-ext: ă ș ț…) stă PRIMUL — diacriticele
  //      din titlurile Fraunces cad pe serif-ul potrivit, nu pe DM Sans;
  //   2. DejaVu stă ultimul — plasa de siguranță pentru simboluri (Δ ∑ ∞ …).
  // Fraunces e în două subseturi woff (fontsource): TTF-ul complet instanțiat
  // din fontul variabil se randa greșit prin satori (plus → minus).
  _fonts = [
    { name: 'Fraunces Ext', data: read('Fraunces-ExtraBold-latin-ext.woff'), weight: 800, style: 'normal' },
    { name: 'DM Sans',      data: read('DMSans-Regular.ttf'),                weight: 400, style: 'normal' },
    { name: 'DM Sans',      data: read('DMSans-Bold.ttf'),                   weight: 700, style: 'normal' },
    { name: 'Fraunces',     data: read('Fraunces-ExtraBold-latin.woff'),     weight: 800, style: 'normal' },
    { name: 'DejaVu',       data: read('DejaVuSans-Bold.ttf'),               weight: 700, style: 'normal' },
  ];
  return _fonts;
}

let _satori = null;
async function getSatori() {
  if (!_satori) _satori = (await import('satori')).default; // satori e ESM
  return _satori;
}

// Randarea completă: card → SVG → JPEG (folosită și de testul de fum).
async function renderCard(params) {
  const satori = await getSatori();
  const sharp = require('sharp');
  const svg = await satori(buildCard(params), { width: 1080, height: 1080, fonts: loadFonts() });
  return sharp(Buffer.from(svg)).jpeg({ quality: 88, mozjpeg: true }).toBuffer();
}

// ─── Handlerul HTTP ──────────────────────────────────────────────────────────
module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }
  const q = req.query || {};
  const one = (v) => (Array.isArray(v) ? v[0] : v) || '';
  const params = {
    template: String(one(q.template) || 'anunt').toLowerCase(),
    title: String(one(q.title)).slice(0, 160),
    subtitle: String(one(q.subtitle)).slice(0, 240),
    badge: String(one(q.badge)).slice(0, 40),
  };
  if (!TEMPLATES[params.template]) {
    return res.status(400).json({ error: `Șablon necunoscut. Permise: ${Object.keys(TEMPLATES).join(', ')}.` });
  }
  if (!params.title.trim()) return res.status(400).json({ error: 'Parametrul title e obligatoriu.' });
  if (!social.verifyImageSig({ ...params, sig: String(one(q.sig)) })) {
    return res.status(401).json({ error: 'Semnătură invalidă — folosește URL-urile generate de agent (schedule_social).' });
  }

  try {
    const jpeg = await renderCard(params);
    res.setHeader('Content-Type', 'image/jpeg');
    // conținut determinat 100% de parametri → cache agresiv pe CDN
    res.setHeader('Cache-Control', 'public, max-age=86400, s-maxage=31536000, immutable');
    return res.status(200).send(jpeg);
  } catch (err) {
    if (err && (err.code === 'ERR_MODULE_NOT_FOUND' || err.code === 'MODULE_NOT_FOUND')) {
      console.error('social-image: dependențe lipsă:', err.message);
      return res.status(501).json({ error: 'Generatorul de imagini are nevoie de pachetele satori și sharp — rulează `npm install` și fă deploy (sunt deja în package.json).' });
    }
    console.error('social-image error:', err);
    return res.status(500).json({ error: `Randarea a eșuat: ${err.message}` });
  }
};

// exportate pentru teste (test/social.test.js)
module.exports.buildCard = buildCard;
module.exports.titleSize = titleSize;
module.exports.renderCard = renderCard;
module.exports.TEMPLATES = TEMPLATES;
