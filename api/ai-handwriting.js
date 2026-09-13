// =====================================================================
// api/ai-handwriting.js — „Spațiul de lucru": scrisul de mână → text frumos
//
// Elevul scrie cu degetul / creionul pe ecran. Clientul grupează traseele în
// LINII (după geometria scrisului, nu după o grilă fixă — vezi SpatiuDeLucru),
// rasterizează liniile stabile (fără atingere de ~1,3 s) și le trimite aici,
// împachetate într-o singură imagine. Modelul le citește și întoarce LaTeX —
// o linie, o formulă — pe care clientul îl randează cu KaTeX peste cerneală.
//
// Body: { count, imageBase64, hint?, prev? }
//   count       — câte linii sunt în imagine (1 … 8)
//   imageBase64 — data URL (PNG) cu liniile stivuite, etichetate 1., 2., …
//   hint        — context scurt (enunțul exercițiului) ca modelul să aleagă
//                 notația potrivită (x vs ×, Δ vs D, etc.). Opțional.
//   prev        — ultimele linii deja recunoscute, DEASUPRA lotului: firul
//                 calculului îl ajută să aleagă între „0" și „6", „," și „.".
//
// Răspuns: { lines: [{ i, latex }] }
//
// Imaginea NU se salvează — e procesată și uitată (efemer, privat), la fel ca
// foto-rezolvarea din api/ai-vision.js.
//
// Costuri: o cerere = un „flush" (de obicei o linie). Vezi GHID_LIMITE_AI.md.
// Modelul se poate schimba din env: AI_HANDWRITING_MODEL (implicit modelul de
// vedere). Cota zilnică proprie: AI_QUOTA_SCRIS_ZI (implicit 300 de cereri).
// =====================================================================
const ai = require('./_lib/ai');

const HW_MODEL = process.env.AI_HANDWRITING_MODEL || null; // null → modelul de vedere
const HW_QUOTA_DAY = Math.max(0, parseInt(process.env.AI_QUOTA_SCRIS_ZI || '300', 10));
const MAX_LINES = 8;

const SYSTEM = `Ești un motor de recunoaștere a scrisului de mână matematic, pentru elevi români.

Primești o imagine cu una sau mai multe LINII scrise de mână, separate prin bare orizontale și numerotate în stânga (1., 2., …). Fiecare linie e un rând dintr-o rezolvare de matematică — de obicei un calcul, nu o propoziție.

Reguli:
- Transcrie FIECARE linie exact așa cum e scrisă. NU rezolva, NU corecta greșelile de calcul, NU completa ce lipsește, NU adăuga pași.
- O linie se poate termina cu „=" fără rezultat — e normal, elevul continuă pe linia următoare. Las-o așa.

VIRGULA ZECIMALĂ (important, e scris românesc):
- Numerele zecimale se scriu cu VIRGULĂ, simplu: 1,2 · 3,6 · 0,4 · 12,75.
- NU scrie 1.2, NU scrie 1{,}2, NU scrie \,. Doar virgula obișnuită, lipită de cifre.
- O virgulă între cifre e ÎNTOTDEAUNA separator zecimal, niciodată enumerare.

LATEX:
- Folosește: \frac{a}{b}, \sqrt{x}, \sqrt[3]{x}, \int_{a}^{b}, \sum_{i=1}^{n}, \lim_{x \to 0}, x^{2}, a_{n}, \pi, \alpha, \Delta, \angle, \cdot, \pm, \leq, \geq, \neq, \approx, \in, \mathbb{R}, \Rightarrow, \Leftrightarrow, 90^{\circ}.
- Înmulțirea scrisă cu punct la mijloc → \cdot ; cu x → \cdot dacă e clar înmulțire, altfel litera x.
- Minusul e „-" obișnuit. NU folosi \quad, \qquad, \; sau alte spațieri: spațiu simplu, acolo unde chiar e nevoie.
- Cuvintele românești din linie se scriu ca text simplu, iar formulele din jurul lor între $...$ (ex: „Notăm $x=2$, deci"). O linie NUMAI cu matematică se scrie fără $.
- Un semn pe care nu îl poți citi cu încredere: pune doar ce ești sigur, nu inventa. O linie goală, o pată sau o mâzgălitură → latex: "".
- Nu pune ghilimele, explicații sau comentarii în jurul transcrierii.

Răspunzi DOAR cu JSON, exact în forma:
{"lines":[{"i":1,"latex":"..."},{"i":2,"latex":"..."}]}
cu exact câte un obiect pentru fiecare linie numerotată din imagine, în ordine.`;

function parseLines(raw, count) {
  const out = [];
  let obj = null;
  try {
    obj = ai.parseJsonLoose ? ai.parseJsonLoose(raw) : JSON.parse(raw);
  } catch { obj = null; }
  if (!obj) {
    // modelul a răspuns text simplu (o singură formulă) — îl luăm ca linia 1
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
    // linia întreagă împachetată într-o singură pereche $…$ (sau \(…\)) → scoatem
    // delimitatorii, îi pune clientul. O linie AMESTECATĂ (text + mai multe
    // formule) rămâne neatins — altfel s-ar rupe la prima și ultima formulă.
    const whole = latex.match(/^\$\$?([^$]*)\$\$?$/) || latex.match(/^\\\(([\s\S]*)\\\)$/);
    if (whole) latex = whole[1].trim();
    // plasă de siguranță peste prompt: virgula zecimală și spațierile tipografice
    latex = latex
      .replace(/\{\s*,\s*\}/g, ',')
      .replace(/\{\s*\.\s*\}/g, '.')
      .replace(/\\(?:quad|qquad|;|:|!|,)(?![a-zA-Z])/g, ' ')
      .replace(/\u2212/g, '-')
      .replace(/[ \t]{2,}/g, ' ')
      .trim();
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
      const e = new Error(`Ai transformat în text ${HW_QUOTA_DAY} de linii azi. Poți scrie mai departe în spațiul de lucru — transformarea automată revine la miezul nopții.`);
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
    const { imageBase64, hint, prev } = req.body || {};
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
      return res.status(413).json({ error: 'Linia e prea mare. Scrie mai mărunt sau transformă pe rând.' });
    }

    const ctx = String(hint || '').trim().slice(0, 700);
    const before = String(prev || '').trim().slice(0, 400);
    const text = (count === 1
      ? 'Transcrie linia scrisă de mână din imagine, în LaTeX.'
      : `Transcrie cele ${count} linii scrise de mână din imagine, în ordine, în LaTeX.`)
      + (ctx ? `\n\nExercițiul la care lucrează elevul (ca să alegi notația potrivită):\n${ctx}` : '')
      + (before ? `\n\nCe a scris elevul pe liniile DE DEASUPRA (continuarea aceluiași calcul):\n${before}` : '');

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
