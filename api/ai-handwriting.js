// =====================================================================
// api/ai-handwriting.js — „Spațiul de lucru": scrisul de mână → text frumos
//
// Elevul scrie cu degetul / creionul pe ecran. Clientul taie foaia în RÂNDURI,
// rasterizează rândurile stabile (fără atingere de ~1,2 s) și le trimite aici,
// împachetate într-o singură imagine. Modelul le citește și întoarce LaTeX —
// un rând, o formulă — pe care clientul îl randează cu KaTeX peste cerneală.
//
// Body: { count, imageBase64, hint? }
//   count       — câte rânduri sunt în imagine (1 … 8)
//   imageBase64 — data URL (PNG) cu rândurile stivuite, etichetate 1., 2., …
//   hint        — context scurt (enunțul exercițiului) ca modelul să aleagă
//                 notația potrivită (x vs ×, Δ vs D, etc.). Opțional.
//
// Răspuns: { lines: [{ i, latex }] }
//
// Imaginea NU se salvează — e procesată și uitată (efemer, privat), la fel ca
// foto-rezolvarea din api/ai-vision.js.
//
// Costuri: o cerere = un „flush" (de obicei un rând). Vezi GHID_LIMITE_AI.md.
// Modelul se poate schimba din env: AI_HANDWRITING_MODEL (implicit modelul de
// vedere). Cota zilnică proprie: AI_QUOTA_SCRIS_ZI (implicit 300 de cereri).
// =====================================================================
const ai = require('./_lib/ai');

const HW_MODEL = process.env.AI_HANDWRITING_MODEL || null; // null → modelul de vedere
const HW_QUOTA_DAY = Math.max(0, parseInt(process.env.AI_QUOTA_SCRIS_ZI || '300', 10));
const MAX_LINES = 8;

const SYSTEM = `Ești un motor de recunoaștere a scrisului de mână matematic, pentru elevi români.

Primești o imagine cu unul sau mai multe RÂNDURI scrise de mână, separate prin linii orizontale și numerotate în stânga (1., 2., …).

Reguli:
- Transcrie FIECARE rând exact așa cum e scris. NU rezolva, NU corecta greșelile de calcul, NU completa ce lipsește.
- Scrie matematica în LaTeX: \\frac{a}{b}, \\sqrt{x}, \\sqrt[3]{x}, \\int_{a}^{b}, \\sum_{i=1}^{n}, \\lim_{x \\to 0}, x^{2}, a_{n}, \\pi, \\alpha, \\Delta, \\angle, \\cdot, \\pm, \\leq, \\geq, \\neq, \\approx, \\in, \\mathbb{R}, \\Rightarrow, \\Leftrightarrow, 90^{\\circ}.
- Cuvintele românești din rând se scriu ca text simplu, în afara formulelor (ex: "deci", "rezultă că", "Notăm").
- Un rând care conține și text și formule se scrie amestecat: textul simplu, formulele între $...$.
- Un rând gol sau indescifrabil → latex: "" (șir gol). Nu inventa.
- Dacă un simbol e ambiguu, alege varianta matematic plauzibilă în contextul rândurilor vecine.
- Nu pune ghilimele, explicații sau comentarii în jurul transcrierii.

Răspunzi DOAR cu JSON, exact în forma:
{"lines":[{"i":1,"latex":"..."},{"i":2,"latex":"..."}]}
cu exact câte un obiect pentru fiecare rând numerotat din imagine, în ordine.`;

function parseLines(raw, count) {
  const out = [];
  let obj = null;
  try {
    obj = ai.parseJsonLoose ? ai.parseJsonLoose(raw) : JSON.parse(raw);
  } catch { obj = null; }
  if (!obj) {
    // modelul a răspuns text simplu (o singură formulă) — îl luăm ca rândul 1
    const t = String(raw || '').trim().replace(/^```[a-z]*\n?|```$/g, '').trim();
    if (t && count === 1) return [{ i: 1, latex: t }];
    return [];
  }
  const arr = Array.isArray(obj) ? obj : (Array.isArray(obj.lines) ? obj.lines : []);
  for (let k = 0; k < arr.length; k++) {
    const it = arr[k] || {};
    const i = Number.isFinite(+it.i) ? Math.trunc(+it.i) : k + 1;
    if (i < 1 || i > count) continue;
    let latex = String(it.latex == null ? '' : it.latex).trim();
    // rândul întreg împachetat într-o singură pereche $…$ (sau \(…\)) → scoatem
    // delimitatorii, îi pune clientul. Un rând AMESTECAT (text + mai multe
    // formule) rămâne neatins — altfel s-ar rupe la prima și ultima formulă.
    const whole = latex.match(/^\$\$?([^$]*)\$\$?$/) || latex.match(/^\\\(([\s\S]*)\\\)$/);
    if (whole) latex = whole[1].trim();
    if (latex.length > 600) latex = latex.slice(0, 600);
    out.push({ i, latex });
  }
  return out;
}

// Cotă zilnică proprie (fereastra zilei, ora României), separată de „foto".
// Nu intră în FEATURE_QUOTAS ca să nu apară ca o „funcție" în Contul meu:
// recunoașterea e o unealtă de scris, nu o acțiune pe care o cumperi.
async function enforceWritingQuota(supa, userId) {
  if (!HW_QUOTA_DAY) return;
  try {
    const { count, error } = await supa.from('ai_usage').select('*', { count: 'exact', head: true })
      .eq('user_id', userId).eq('endpoint', 'ai-handwriting').gte('created_at', ai.dayStartBucharest());
    if (error) return; // nu blocăm scrisul pentru o eroare de numărătoare
    if ((count || 0) >= HW_QUOTA_DAY) {
      const e = new Error(`Ai transformat în text ${HW_QUOTA_DAY} de rânduri azi. Poți scrie mai departe în spațiul de lucru — transformarea automată revine la miezul nopții.`);
      e.status = 429; e.code = 'QUOTA_SCRIS'; throw e;
    }
  } catch (e) { if (e.code === 'QUOTA_SCRIS') throw e; }
}

module.exports = async function handler(req, res) {
  ai.applyCors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  const supa = ai.admin();
  try {
    const userId = await ai.authUser(req, supa);
    const profile = await ai.requireUser(supa, userId);
    const { imageBase64, hint } = req.body || {};
    const count = Math.max(1, Math.min(MAX_LINES, Math.trunc(+(req.body || {}).count || 1)));

    // NU blocăm în timpul testului pe grupă: aici doar se transcrie ce a scris
    // elevul cu mâna lui. Ajutorul (chatul) rămâne blocat de testlock, ca până acum.
    const lim = await ai.enforceRateLimit(supa, userId, profile);
    await enforceWritingQuota(supa, userId);
    await ai.enforceFreeQuota(supa, profile);

    if (!imageBase64) return res.status(400).json({ error: 'imageBase64 obligatoriu' });
    const dataUrl = imageBase64.startsWith('data:') ? imageBase64 : `data:image/png;base64,${imageBase64}`;

    const approxBytes = (dataUrl.length * 3) / 4;
    if (approxBytes > 2_500_000) {
      return res.status(413).json({ error: 'Rândul e prea mare. Scrie mai mărunt sau transformă pe rând.' });
    }

    const ctx = String(hint || '').trim().slice(0, 700);
    const text = (count === 1
      ? 'Transcrie rândul scris de mână din imagine, în LaTeX.'
      : `Transcrie cele ${count} rânduri scrise de mână din imagine, în ordine, în LaTeX.`)
      + (ctx ? `\n\nContext (exercițiul la care lucrează elevul, ca să alegi notația potrivită):\n${ctx}` : '');

    const { text: raw, usage } = await ai.chatVision({
      system: SYSTEM,
      text,
      imageDataUrl: dataUrl,
      model: HW_MODEL ? ai.pickModel(HW_MODEL, lim) : undefined,
      maxTokens: 120 + count * 120,
      temperature: 0,
    });

    await ai.logUsage(supa, userId, 'ai-handwriting', usage);

    const lines = parseLines(raw, count);
    // completăm rândurile pe care modelul le-a sărit, ca să nu rămână „în curs"
    const byIdx = new Map(lines.map((l) => [l.i, l.latex]));
    const full = [];
    for (let i = 1; i <= count; i++) full.push({ i, latex: byIdx.has(i) ? byIdx.get(i) : '' });

    return res.status(200).json({ lines: full });
  } catch (err) {
    if (!err.status) console.error('ai-handwriting error:', err);
    return res.status(err.status || 500).json({ error: err.message || 'Eroare server', code: err.code || null });
  }
};
