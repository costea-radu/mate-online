// =====================================================================
// test/spatiu-de-lucru.test.js — „✍️ Spațiu de lucru" (27 octombrie 2026)
//   · foaia e ALBĂ și FĂRĂ LINII peste tot (și în fereastră, ca în chat);
//   · foaia continuă în dreapta (și în jos) cât vrea elevul, ca pe tabla
//     interactivă: ✋ / două degete / rotiță / ◀ ▶ / „➕ Pagină nouă";
//   · „✨ Transformă în text" a fost SCOS: scrisul rămâne scris de mână, iar
//     „🎓 Cere corectarea" trimite imaginea foii corectorului (Premium);
//   · fereastra Profesorului Virtual se lățește pe calculator, trăgând de margine.
// Teste pe sursă (componentele React nu rulează în Node); logica pură a foii
// (dalele, traseele) e testată în test/corector-scris.test.js.
// =====================================================================
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const src = read('src/components/SpatiuDeLucru.jsx');
const foaie = read('src/lib/foaie.js');
const between = (s, a, b) => s.slice(s.indexOf(a), s.indexOf(b, s.indexOf(a)));
// codul fără comentarii (comentariile povestesc și ce a fost scos)
const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

test('„✨ Transformă în text" nu mai există: nicio recunoaștere a rândurilor, niciun text peste cerneală', () => {
  assert.doesNotMatch(code, /Transformă|transformaTot|recognizeOnce|aiClient\.handwriting|LinieRandata|normalizeLatex/);
  assert.doesNotMatch(code, /import \{ aiClient \}/, 'foaia nu mai cheamă AI-ul singură');
  assert.doesNotMatch(read('src/lib/aiClient.js'), /handwriting: \(/, 'clientul vechi de transcriere a plecat');
  // nici butoanele care foloseau textul transformat
  assert.doesNotMatch(code, /📋 Copiază|insertLabel|onInsert/);
});

test('foaia e ALBĂ și FĂRĂ LINII — și în fereastră, și în zona de conversație', () => {
  assert.match(src, /export const SHEET_BG = '#ffffff';/);
  assert.doesNotMatch(src, /repeating-linear-gradient\(to bottom/, 'fără liniile de caiet');
  assert.doesNotMatch(src, /#f0c9c9/, 'fără marginea roșie');
  assert.doesNotMatch(src, /ZONE_BG|#fdfdf8/);
  assert.match(src, /background: SHEET_BG/);
});

test('foaia continuă în dreapta și în jos: mereu cu un ecran gol în față, mărimea pusă direct pe SVG', () => {
  const ext = between(src, 'const ensureExtent = useCallback', 'const updatePos');
  assert.match(src, /const AHEAD = 1;/);
  assert.match(ext, /sc\.scrollLeft \+ vw \* \(1 \+ AHEAD\)/, 'lățimea crește odată cu poziția elevului');
  assert.match(ext, /sc\.scrollTop \+ vh \* \(1 \+ AHEAD\)/);
  assert.match(ext, /bb \? bb\.x1 \+ vw : 0/, 'și față de tot ce s-a scris');
  assert.match(ext, /svg\.setAttribute\('width'/);
  // React nu are voie să strângă foaia la o redesenare
  const svgTag = src.slice(src.indexOf('<svg'), src.indexOf('<g ref={gRef}'));
  assert.doesNotMatch(svgTag, /\bwidth=\{/);
  assert.doesNotMatch(svgTag, /\bheight=\{/);
  // derularea e cea nativă: zona derulabilă + onScroll
  assert.match(src, /overflow: 'auto'/);
  assert.match(src, /onScroll=\{onScroll\}/);
});

test('se trage ca pe tabla interactivă: ✋ (nativ pe telefon), două degete în orice unealtă, mouse, ◀ ▶, „➕ Pagină nouă", ⟲', () => {
  assert.match(src, /touchAction: tool === 'pan' \? 'pan-x pan-y' : 'none'/);
  const down = between(src, 'function onDown(e)', 'function onMove(e)');
  assert.match(down, /touchesRef\.current\.size === 2/, 'al doilea deget pornește derularea');
  assert.match(down, /abandonStroke\(\)/, 'trasul abia început cu primul deget se anulează');
  assert.match(down, /e\.button === 1 \|\| \(toolRef\.current === 'pan' && e\.pointerType !== 'touch'\)/, 'mouse: ✋ sau rotița apăsată');
  assert.match(down, /penSeenRef\.current && e\.pointerType === 'touch'/, 'palma sprijinită nu scrie');
  const move = between(src, 'function onMove(e)', 'function onUp(e)');
  assert.match(move, /sc\.scrollLeft = pan\.sl - \(mx - pan\.mx\)/);
  assert.match(move, /getCoalescedEvents/, 'trasee netede cu creionul');
  assert.match(src, /function newPage\(\)/);
  assert.match(src, /➕ Pagină nouă/);
  assert.match(src, /function pageNext\(\)/);
  assert.match(src, /function pagePrev\(\)/);
  assert.match(src, /goTo\(0, 0\)/);
  assert.match(src, /\{pos\.page\}\/\{pos\.pages\}/, 'indicatorul de pagină');
});

test('„🎓 Cere corectarea" trimite SCRISUL (imaginea foii), nu text; fără Premium explică și nu trimite nimic', () => {
  const act = between(src, 'async function act(kind)', 'useEffect(() => {');
  assert.match(act, /if \(kind === 'corect' && corectLocked\) \{ setLockInfo\(true\); return; \}/);
  assert.match(act, /exportSheet\(strokesRef\.current\)/);
  assert.match(act, /onCorect\(pack\)/);
  assert.match(act, /onAttach\(pack\)/);
  assert.match(src, /Corectarea face parte din abonamentul Premium/);
  assert.match(src, /<Link to="\/preturi"/);
  // imaginea: dale la mărimea reală a scrisului + miniatura de ≤ 16 KB pentru conversație
  assert.match(foaie, /export function exportSheet/);
  assert.match(foaie, /thumb\.length <= 16000/);
  assert.match(foaie, /TILE_W = 2000/);
});

test('ciorna rămâne (sdl2:<cheie>), cu poziția pe foaie; ciornele vechi (cu linii transformate) se citesc', () => {
  assert.match(src, /const LSK = storageKey \? `sdl2:\$\{storageKey\}` : null;/);
  assert.match(src, /JSON\.stringify\(\{ v: 3, strokes, view: viewRef\.current \}\)/);
  assert.match(src, /ciornele vechi \(cu `line` \/ `meta`/);
  assert.match(src, /window\.addEventListener\('pagehide', flush\)/);
  // „↩ Înapoi" anulează și radiera și „Șterge tot"
  const undo = between(src, 'function undo()', 'function clearAll()');
  assert.match(undo, /h\.t === 'erase' \|\| h\.t === 'clear'/);
});

test('cine deschide caietul: corectarea și atașarea ca imagine, fără vechile props de text', () => {
  const chat = read('src/components/AITutor.jsx');
  const iv = read('src/pages/InteractiveViewer.jsx');
  for (const f of [chat, iv, read('src/pages/LiveRoom.jsx'), read('src/pages/PregatireExamen.jsx')]) {
    const tags = f.split('<SpatiuDeLucru').slice(1).map((x) => x.slice(0, x.indexOf('/>')));
    for (const t of tags) assert.doesNotMatch(t, /onInsert=|insertLabel=|\bhint=/);
  }
  assert.match(chat, /async function correctHandwriting\(pack/);
  assert.match(chat, /aiClient\.corectareScris\(/);
  assert.match(chat, /function attachToQuestion\(pack\)/);
  assert.match(chat, /function attachToForm\(pack\)/);
  assert.match(chat, /images: \[sendPhoto\.dataUrl, \.\.\.\(sendPhoto\.extra \|\| \[\]\)\]\.slice\(0, 3\)/, 'foaia pleacă la profesor ca imagini');
  assert.match(chat, /corectLocked=\{!!profile && !isPremium\}/);
  // exercițiile interactive: corectarea apare în Profesorul Virtual (o singură dată pe id)
  assert.match(iv, /setAutoCorrect\(\{ id: Date\.now\(\), pack/);
  assert.match(iv, /autoCorrect=\{autoCorrect\}/);
  assert.match(chat, /consumedAutoPrompts\.has\(key\)/);
});

test('pe calculator, fereastra Profesorului Virtual se lățește trăgând de margine (PDF, exerciții, widget)', () => {
  const hook = read('src/lib/latimePanou.js');
  assert.match(hook, /export function useLatimePanou/);
  assert.match(hook, /edge === 'left' \? d\.w - dx : d\.w \+ dx/);
  assert.match(hook, /localStorage\.setItem\(storageKey/);
  const pdf = read('src/pages/PDFViewer.jsx');
  assert.match(pdf, /useLatimePanou\(\{\s*storageKey: 'pv:latime'/);
  assert.match(pdf, /\{!narrow && <ManerLatime lat=\{lat\} \/>\}/);
  assert.match(pdf, /: \{ width: lat\.width, borderLeft: '3px solid var\(--gold\)' \}/);
  // pe telefon rămâne tragerea în sus/jos de bara albastră
  assert.match(pdf, /height: `\$\{panelPct\}%`/);
  const iv = read('src/pages/InteractiveViewer.jsx');
  assert.match(iv, /useLatimePanou\(\{ storageKey: 'pv:latime'/);
  assert.match(iv, /\{!isMobile && <ManerLatime lat=\{lat\} \/>\}/);
  const chat = read('src/components/AITutor.jsx');
  assert.match(chat, /useLatimePanou\(\{ storageKey: 'pv:widget'/);
  assert.match(chat, /const popupW = desk \? lat\.width : Math\.min\(400, window\.innerWidth - 32\);/);
  assert.match(chat, /\{desk && <ManerLatime lat=\{lat\} top=\{44\} offset=\{0\} \/>\}/);
});
