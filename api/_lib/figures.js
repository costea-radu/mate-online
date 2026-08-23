// =====================================================================
// api/_lib/figures.js — DSL-ul FIGURILOR GEOMETRICE, într-un singur loc
// (Etapa 3 din AUDIT_AGENTI_AI.md: Structured Outputs pe ai-exam + figuri în chat)
//
// Figura e descrisă de model ca obiect JSON (nu ca imagine) și e desenată
// determinist în browser de src/lib/figureRender.js. Aici stau:
//   · FIGURE_TYPES  — tipurile acceptate (aceleași ca în figureRender/validate);
//   · FIGURE_SPEC   — specificația completă pentru generatorul de teste (ai-exam);
//   · FIGURE_SPEC_CHAT — varianta scurtă pentru Profesorul Virtual ([[FIGURA:{…}]]);
//   · FIGURE_SCHEMA — schema STRICTĂ (toate cheile, nullable) pentru json_schema;
//   · cleanFigure   — scoate cheile null, verifică tipul (după parsare).
// =====================================================================
const { S } = require('./ai');

const FIGURE_TYPES = ['segment', 'unghi', 'triunghi', 'patrat', 'dreptunghi', 'paralelogram', 'romb', 'trapez', 'cerc', 'xOy', 'cub', 'paralelipiped', 'prisma', 'piramida', 'con', 'cilindru', 'sfera', 'trunchi-con', 'trunchi-piramida'];

const FIGURE_FORMATS = `- Formatele pe tipuri (folosește DOAR cheile de mai jos; cheile nefolosite lipsesc sau sunt null):
  · segment: {"type":"segment","labels":["A","B","C","D"]} — punctele de pe dreaptă, în ordine; opțional "pozitii":[0,0.5,0.75,1] (fracții 0..1, câte una pentru fiecare literă).
  · unghi: {"type":"unghi","varf":"O","raze":["A","M","B"]} — semidreptele care pleacă din vârf, în ordinea rotirii (pentru bisectoare pune litera bisectoarei între laturile unghiului).
  · triunghi: {"type":"triunghi","variant":"oarecare|isoscel|echilateral|dreptunghic","labels":["A","B","C"]} — labels[0] = vârful de sus, apoi stânga-jos, dreapta-jos; la "dreptunghic" adaugă "unghi_drept":"B" (litera vârfului cu unghiul drept). Opțional "inaltime":{"din":"A","picior":"D"}.
  · patrat/dreptunghi/paralelogram/romb/trapez: {"type":"...","labels":["A","B","C","D"]} — conturul în ordinea: A=stânga-jos, B=dreapta-jos, C=dreapta-sus, D=stânga-sus. La trapez: "variant":"oarecare|dreptunghic|isoscel" (bazele sunt AB — mare, jos — și DC — mică, sus). Opțional "diagonale":true.
  · Puncte pe laturi (orice poligon): "puncte":[{"label":"M","pe":"BC","la":0.5}] ("la" = fracția de la primul capăt al laturii). Segmente suplimentare între orice puncte etichetate: "segmente":[["A","M"],["B","D"]] (și "segmente_punctate" pentru linii punctate).
  · cerc: {"type":"cerc","centru":"O"} + opțional: "inscris":["A","B","C"] (poligon înscris în cerc), "puncte":[{"label":"D","unghi":250}] (alt punct pe cerc; unghiul în grade, 0=dreapta, sens trigonometric), "raza":"A", "diametru":["A","B"], "coarda":["M","N"], "tangenta":{"la":"A"}, "segmente":[["B","D"]].
  · xOy (grafic de funcție): {"type":"xOy","functie":{"a":2,"b":-4}} pentru f(x)=ax+b + opțional "puncte":[{"label":"A","x":2,"y":0},{"label":"B","x":0,"y":-4}].
  · cub/paralelipiped: {"type":"cub","labels":["A","B","C","D","A'","B'","C'","D'"]} (baza jos, apoi vârfurile de sus) + opțional "segmente":[["A","C'"]] pentru diagonale.
  · prisma: {"type":"prisma","variant":"triunghiulara|patrulatera","labels":["A","B","C","A'","B'","C'"]} (6 sau 8 litere).
  · piramida: {"type":"piramida","variant":"patrulatera|triunghiulara","labels":["V","A","B","C","D"]} — PRIMA literă este vârful. Opțional "inaltime":{"picior":"O"}.
  · con: {"type":"con","labels":["V","A","B"]} + opțional "inaltime":{"picior":"O"}. cilindru: {"type":"cilindru","inaltime":{"picior":"O"}}. sfera: {"type":"sfera","centru":"O","raza":"A"}. trunchi-con: {"type":"trunchi-con","inaltime":{"picior":"O"}}. trunchi-piramida: {"type":"trunchi-piramida","labels":["A","B","C","D","A'","B'","C'","D'"]}.
- Exemple complete:
  {"type":"triunghi","variant":"isoscel","labels":["A","B","C"],"puncte":[{"label":"E","pe":"BC","la":0.65}],"segmente":[["A","E"]]}
  {"type":"cerc","centru":"O","inscris":["A","B","C"],"puncte":[{"label":"D","unghi":268}],"segmente":[["B","D"],["D","C"]]}
  {"type":"trapez","variant":"dreptunghic","labels":["A","B","C","D"],"puncte":[{"label":"M","pe":"DC","la":0.5}],"segmente":[["A","M"],["B","D"]]}`;

// Specificația pentru generatorul de teste (ai-exam) — cheia "figure" a itemului
const FIGURE_SPEC = `FIGURI GEOMETRICE — cheia "figure" a itemului:
- OBLIGATORIU la TOȚI itemii Subiectului al II-lea (II.1–II.6) și la problemele III.3, III.4, III.5, III.6.
- La Subiectul I și la problemele III.1 și III.2 (algebră) cheia "figure" este null.
- Figura trebuie să corespundă EXACT enunțului: aceleași litere, același tip de configurație.
- "type" poate fi: ${FIGURE_TYPES.join(', ')}.
${FIGURE_FORMATS}`;

// Varianta pentru CHAT (Profesorul Virtual): figura vine ca marcaj în text,
// clientul o desenează sub răspuns.
const FIGURE_SPEC_CHAT = `FIGURI ÎN RĂSPUNS: când explici o problemă de GEOMETRIE (plană sau în spațiu) sau un GRAFIC de funcție liniară, poți desena figura adăugând, pe un rând separat, ORIUNDE în răspuns (de regulă imediat după ce prezinți datele problemei), marcajul:
[[FIGURA:{"type":"triunghi","variant":"dreptunghic","labels":["A","B","C"],"unghi_drept":"A"}]]
Reguli: un singur obiect JSON valid pe marcaj, pe O SINGURĂ linie; literele EXACT cele din enunț; cel mult 2 figuri per răspuns; fără figură la probleme pur algebrice. "type" poate fi: ${FIGURE_TYPES.join(', ')}.
${FIGURE_FORMATS}`;

// ── Schema STRICTĂ (json_schema, strict:true): toate cheile prezente, nullable ──
const LABELS = S.nullable(S.arr(S.str(), 'etichetele punctelor, în ordine'));
const PAIRS = S.nullable(S.arr(S.arr(S.str()), 'segmente între puncte etichetate: [["A","M"],["B","D"]]'));
const FIGURE_SCHEMA = S.obj({
  type: S.enum(FIGURE_TYPES, 'tipul figurii'),
  labels: LABELS,
  variant: S.nullable(S.str('varianta: triunghi oarecare|isoscel|echilateral|dreptunghic; trapez oarecare|dreptunghic|isoscel; prisma/piramida triunghiulara|patrulatera')),
  unghi_drept: S.nullable(S.str('triunghi dreptunghic: litera vârfului cu unghiul drept')),
  pozitii: S.nullable(S.arr(S.num(), 'segment: fracții 0..1, câte una pentru fiecare literă')),
  varf: S.nullable(S.str('unghi: vârful')),
  raze: S.nullable(S.arr(S.str(), 'unghi: semidreptele, în ordinea rotirii')),
  inaltime: S.nullable(S.obj({ din: S.nullable(S.str('vârful din care coboară înălțimea')), picior: S.nullable(S.str('piciorul înălțimii')) }, 'înălțimea (triunghi, piramidă, con, cilindru, trunchi)')),
  diagonale: S.nullable(S.bool('patrulater: desenează diagonalele')),
  puncte: S.nullable(S.arr(S.obj({
    label: S.str('eticheta punctului'),
    pe: S.nullable(S.str('latura pe care stă punctul, ex. "BC" (poligoane)')),
    la: S.nullable(S.num('fracția 0..1 de la primul capăt al laturii')),
    unghi: S.nullable(S.num('cerc: unghiul în grade al punctului pe cerc')),
    x: S.nullable(S.num('xOy: abscisa')),
    y: S.nullable(S.num('xOy: ordonata')),
  }), 'puncte suplimentare')),
  segmente: PAIRS,
  segmente_punctate: PAIRS,
  centru: S.nullable(S.str('cerc/sferă: centrul')),
  inscris: S.nullable(S.arr(S.str(), 'cerc: poligonul înscris')),
  raza: S.nullable(S.str('cerc/sferă: eticheta punctului de pe cerc/sferă spre care se desenează raza')),
  diametru: S.nullable(S.arr(S.str(), 'cerc: cele două capete ale diametrului')),
  coarda: S.nullable(S.arr(S.str(), 'cerc: cele două capete ale coardei')),
  tangenta: S.nullable(S.obj({ la: S.str('punctul de tangență') }, 'cerc: tangenta')),
  functie: S.nullable(S.obj({ a: S.num('panta'), b: S.num('termenul liber') }, 'xOy: f(x)=ax+b')),
}, 'figura geometrică (DSL)');

// După parsare: scoatem cheile null (forma de dinainte de Etapa 3), verificăm
// tipul și formele de bază. Întoarce obiectul curățat sau null.
function cleanFigure(fig) {
  if (!fig || typeof fig !== 'object' || Array.isArray(fig)) return null;
  const out = {};
  for (const k of Object.keys(fig)) {
    const v = fig[k];
    if (v === null || v === undefined) continue;
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      const inner = {};
      for (const kk of Object.keys(v)) if (v[kk] !== null && v[kk] !== undefined) inner[kk] = v[kk];
      if (Object.keys(inner).length) out[k] = inner;
      else if (k === 'inaltime') out[k] = true; // {"inaltime":{}} → înălțimea, fără etichete
      continue;
    }
    if (Array.isArray(v)) {
      const arr = v.map((x) => (x && typeof x === 'object' && !Array.isArray(x)
        ? Object.fromEntries(Object.entries(x).filter(([, vv]) => vv !== null && vv !== undefined))
        : x)).filter((x) => x !== null && x !== undefined);
      if (arr.length) out[k] = arr;
      continue;
    }
    out[k] = v;
  }
  const type = String(out.type || '').trim();
  const known = FIGURE_TYPES.find((t) => t.toLowerCase() === type.toLowerCase());
  if (!known) return null;
  out.type = known;
  return out;
}

// Marcajele [[FIGURA:{...}]] dintr-un răspuns → { text (fără marcaje), figures[] }
function extractFigures(text) {
  const figures = [];
  const out = String(text || '').replace(/\[\[FIGURA:\s*(\{[\s\S]*?\})\s*\]\]/g, (m, json) => {
    try { const f = cleanFigure(JSON.parse(json)); if (f) figures.push(f); } catch { /* marcaj invalid → se scoate */ }
    return '';
  });
  return { text: out, figures: figures.slice(0, 2) };
}

module.exports = { FIGURE_TYPES, FIGURE_SPEC, FIGURE_SPEC_CHAT, FIGURE_SCHEMA, cleanFigure, extractFigures };
