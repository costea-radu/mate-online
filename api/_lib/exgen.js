// =====================================================================
// api/_lib/exgen.js — GENERAREA AUTOMATĂ de exerciții pe rubrici + POSTAREA
// pe site, partajate de:
//   • api/ai-exercise-agent.js (acțiunea „auto" din admin — butonul ⚙️)
//   • api/agent-tasks.js       (task-urile programate: CRUD + „Rulează acum")
//   • api/agent-cron.js        (cronul orar care execută task-urile scadente)
//
// Conține:
//   runAuto({supa, category, subcategory, profile, ctype, instructions,
//            resultKind, dataMode, aiModel})
//       → { html? | exercise?, provider, combinedFrom, template?, usage }
//       (logica mutată NEMODIFICAT din ai-exercise-agent.js, plus alegerea
//        modelului AI per rulare — aiModel, validat în claude.resolveModel)
//   normalize(ex)            — validarea/curățarea JSON-ului de exercițiu
//   renderExerciseHtml(ex)   — HTML interactiv autonom (copie CJS a
//                              src/lib/exerciseRender.js → renderExercise;
//                              ține-le SINCRON dacă schimbi designul)
//   postContent({...})       — încarcă HTML-ul în Storage + rând în `content`
//   runTask({supa, task, triggerKind}) — execută UN task programat cap-coadă:
//       generare → postare automată SAU rezultat „pending_review" → istoricul
//       rulărilor (agent_task_runs) → email către admin (dacă task.notify)
//   postRun({supa, runId})   — postează pe site rezultatul unei rulări
//                              „pending_review" (aprobat manual de admin)
// =====================================================================
const fs = require('fs');
const path = require('path');
const claude = require('./claude');
// echivalența răspunsurilor în BROWSER (HTML-ul generat): „1/2” = „0,5”, „x=3” = „3”…
// sursa unică: api/_lib/mathcheck.js → BROWSER_ANS_EQ (oglindită în src/lib/ansEq.js)
const { BROWSER_ANS_EQ: ANS_EQ_JS } = require('./mathcheck');
const { modeLine } = require('./pdftext');
const { S } = require('./ai'); // helperul schemelor stricte (Structured Outputs)

function httpErr(status, message) {
  const e = new Error(message);
  e.status = status;
  return e;
}

// Regula de REDACTARE a matematicii — inclusă în toate prompturile de
// generare: fără ea, modelul punea uneori PROPOZIȚII întregi în $...$
// (cuvinte italice lipite: „Știindcăm(∠B)") sau grade „70^∘" cu caret vizibil.
const MATH_RULE = '\n- REDACTAREA MATEMATICII: între $...$ pui DOAR expresii și simboluri matematice — NICIODATĂ propoziții sau cuvinte românești (cuvintele rămân în afara delimitatorilor, altfel apar italice și lipite); gradele se scriu $70^\\circ$ (nu „70^∘” în text); după punctul de la finalul unei propoziții pui mereu spațiu.';

// ─── FIGURILE GEOMETRICE: permise DOAR la Evaluare Națională ─────────────────
// Cererea adminului: modelul mai înlocuia enunțul unui item cu figură, iar
// figura (restaurată programatic din șablon) nu se mai potrivea cu noul enunț
// (ex. un cub cu apă lângă o problemă cu triunghi dreptunghic). La clase și
// BAC generăm de acum FĂRĂ figuri (enunțuri complete, self-contained); la
// Evaluare Națională păstrăm comportamentul de până acum (figurile șablonului,
// restaurate întocmai, cu itemii lor).
const figuresAllowed = (category) => String(category || '') === 'evaluare-nationala';

const NO_FIG_RULE = '\n- FĂRĂ FIGURI: NU pune figuri geometrice în test — ELIMINĂ COMPLET blocurile de figură din itemi (SVG-urile, <canvas>, imaginile și containerele lor, ex. <div class="fig">…</div>); problemele de geometrie se formulează SELF-CONTAINED, cu TOATE datele în enunț, fără nicio referire la vreo figură/desen („din figura alăturată” e interzis). Figurile geometrice sunt permise doar la testele de Evaluare Națională, iar acest test NU este de Evaluare Națională.';

// Regulă anti-„secțiuni goale”: modelul mai omitea Subiectul III (itemii cu
// rezolvări complexe) sau lăsa array-urile de itemi goale.
const COMPLETE_RULE_HTML = '\n- TEST COMPLET, FĂRĂ SECȚIUNI GOALE: generezi TOȚI itemii și TOATE secțiunile/subiectele prezente în șablon/sursă — INCLUSIV Subiectul III, dacă există (exercițiile lui au rezolvări mai complexe: grilă SAU completare de răspuns/pași — le incluzi cu enunț, răspunsuri și rezolvări complete). Toate datele itemilor din JavaScript (array-urile de exerciții/pași) se scriu COMPLETE — niciodată liste goale.';
const COMPLETE_RULE_JSON = '\nOBLIGATORIU: acoperi TOATE subiectele/secțiunile testului-sursă (Subiectul I, II ȘI III, dacă există). Itemii de la Subiectul III (rezolvări complexe) NU se omit: devin fie grilă (cu "options"), fie itemi cu răspuns liber/completare (fără "options", "answer" ca text).';

// Curăță figurile rămase într-un HTML generat pentru rubrici non-EN: SVG-urile
// mari (figurile; pictogramele mici, sub ~300 de caractere, scapă), canvas-urile
// statice și containerele de figură golite.
function stripFigures(html) {
  let h = String(html || '');
  h = h.replace(/<div class="fig">\s*(?:<svg[\s\S]*?<\/svg>\s*)+<\/div>/gi, '');
  h = h.replace(/<svg[\s\S]*?<\/svg>/gi, (m) => (m.length > 300 ? '' : m));
  h = h.replace(/<canvas[^>]*>[\s\S]*?<\/canvas>/gi, '');
  h = h.replace(/<div class="fig">\s*<\/div>/gi, '');
  return h;
}

// ─── GARDA DE COMPLETITUDINE a HTML-urilor generate ──────────────────────────
// Se mai publicau teste TRUNCHIATE (răspuns tăiat la max_tokens) sau cu
// carcasa întreagă dar FĂRĂ exerciții (array-ul de itemi gol) — pe site
// apăreau doar antetul și „0 pași”. De acum: (1) răspunsurile tăiate se
// CONTINUĂ automat (chatClaudeLong); (2) documentul trebuie să fie complet
// (…</html> — cutHtml); (3) trebuie să conțină itemi interactivi;
// (4) secțiunile sursei (Subiectul II/III) trebuie să apară și în rezultat.
// Altfel: eroare clară pe rulare — nu se publică nimic stricat.
//
// „Semnalele de itemi” acoperă TOATE familiile de șabloane de pe site, nu
// doar formatul standard (data-correct/data-opt/„answer”):
//  • formatul standard + exercițiile JSON (chei între ghilimele);
//  • VARIANTELE DE EXAMEN încărcate (ex. bac_2014_v1.html — șablonul
//    PROBS/ST/GRADED): datele itemilor stau într-un array JS cu chei FĂRĂ
//    ghilimele — PROBS = [{…, steps:[{t:'num', a:…}, {t:'mc', o:[…], ci:…},
//    {t:'tf', ok:…}]}] — iar câmpurile de răspuns se creează din JavaScript
//    (createElement('input')). Până acum garda nu recunoștea NIMIC din ele
//    (0 semnale în șablon ȘI în rezultat) și respingea teste generate corect:
//    „testul generat NU conține exerciții (0 semnale de itemi, față de 0)”;
//  • alte șabloane: inputuri fără type, textarea, array-uri de răspunsuri.
// Codul comun (CSS/JS, reinserat identic din șablon) dă cel mult câteva
// potriviri constante; numărul e dominat de DATELE itemilor, deci carcasa
// goală (PROBS = [], array-uri goale) rămâne sub prag.
const ITEM_SIGNAL_RES = [
  // atribute de date pe elemente (formatul standard & altele)
  /data-(?:correct|opt|answer|ans|key|sol|right|ok|points)\s*=/gi,
  /type=["']radio["']/gi, /class=["']opt[\s"']/gi,
  // chei de răspuns/punctaj în JSON sau JS — cu ghilimele… (valorile GOALE din
  // codul de stare — `ans: []`, `answer: null` — nu se numără)
  /["'](?:ok|answer|raspuns|correct|corect|ans|ci|sol|solutie|points|puncte)["']\s*:(?!\s*(?:\[\s*\]|\{\s*\}|null|undefined|''|""))/gi,
  // …sau fără (obiecte JS: `ok:'c'`, `ci: 1`, `ans: 4`); „::” exclude CSS-ul
  /[{,;\s](?:ok|answer|raspuns|correct|corect|ans|ci|sol|solutie|points|puncte)\s*:(?!:)(?!\s*(?:\[\s*\]|\{\s*\}|null|undefined|''|""))/gi,
  // enunțul itemului/pasului (statement/enunț/lead/prompt/cerință)
  /[{,;\s]["']?(?:statement|enunt|lead|prompt|question|intrebare|cerinta)["']?\s*:(?!\s*(?:null|undefined|''|""))/gi,
  // variantele unui item (o:[…], options:[…], choices:[…]) — negoale
  /[{,;\s]["']?(?:o|opts|options|optiuni|variante|choices)["']?\s*:\s*\[\s*(?!\])/gi,
  // tipul pasului/itemului: t:'num' | type:"mc" | kind:'tf' …
  /\b(?:t|type|kind|tip)["']?\s*:\s*["'](?:num|number|numeric|mc|choice|grila|grid|single|multi|multiple|tf|bool|boolean|truefalse|calc|open|text|fill|input|select|expr|frac|fraction|set|interval|order|match|matching|pair)["']/gi,
  // array-uri NEGOALE de itemi/pași/răspunsuri: PROBS = [{…, steps: [{…
  /\b(?:steps|pasi|items|itemi|questions|intrebari|exercitii|exercises|probs|probleme|problems|subiecte|answers|raspunsuri|solutions|solutii|tests?|teste|ex|exs|data|db|qs?)["']?\s*[:=]\s*\[\s*(?!\])/gi,
  // câmpuri de răspuns: input text/number, input fără type (= text), textarea,
  // inputuri create din JavaScript, zone editabile
  /<input\b[^>]*type=["']?(?:text|number)/gi,
  /<input\b(?![^>]*\btype\s*=)/gi,
  /<textarea\b/gi,
  /createElement\(\s*["']input["']/gi,
  /contenteditable/gi,
];
function itemSignals(html) {
  const s = String(html || '');
  let n = 0;
  for (const re of ITEM_SIGNAL_RES) n += (s.match(re) || []).length;
  return n;
}

// „Subiectul II/III există în text?” — tolerant la diacritice și formulări:
// „SUBIECTUL III”, „Subiectul al III-lea”, „Subiectele I, II și III”.
// (separatorul acceptă și enumerări de cifre romane: „ i, ii si ”)
const hasSection = (text, roman) => {
  const t = deDia(text);
  const re = roman === 'iii'
    ? /subiect[a-z]*[\s,.&:;()ivxs-]{0,30}?(al[\s.-]{1,3})?iii(?![a-z0-9])/
    : /subiect[a-z]*[\s,.&:;()ivxs-]{0,30}?(al[\s.-]{1,3})?ii(?!i)(?![a-z0-9])/;
  return re.test(t);
};
function missingSections(baseline, out) {
  const missing = [];
  if (hasSection(baseline, 'ii') && !hasSection(out, 'ii')) missing.push('Subiectul II');
  if (hasSection(baseline, 'iii') && !hasSection(out, 'iii')) missing.push('Subiectul III');
  return missing;
}

function assertCompleteHtml({ html, baseline = '', what = 'generarea' }) {
  if (!html || html.length < 600) {
    throw httpErr(502, `${what}: nu am obținut un document HTML complet (răspunsul s-a întrerupt). Mai încearcă.`);
  }
  const got = itemSignals(html);
  const ref = itemSignals(baseline);
  const need = ref >= 12 ? Math.max(4, Math.floor(ref / 6)) : (ref > 0 ? 2 : 1);
  if (got < need) {
    // ref = 0 → garda nu recunoaște NICIUN tipar de item nici în șablon/sursă:
    // formatul fișierului-model e necunoscut gardei (nu neapărat test gol) —
    // spunem explicit, ca adminul să nu reîncerce la nesfârșit aceeași rulare.
    const hint = ref === 0
      ? ' Atenție: nici în șablon/sursă nu recunosc vreun tipar de itemi — formatul fișierului-model e necunoscut gardei de completitudine; verifică fișierul-model sau semnalează formatul.'
      : '';
    throw httpErr(502, `${what}: testul generat NU conține exerciții (${got} semnale de itemi, față de ${ref} în șablon/sursă) — nu îl public. Mai încearcă.${hint}`);
  }
  const miss = missingSections(baseline, html);
  if (miss.length) {
    throw httpErr(502, `${what}: din testul generat lipsesc secțiuni întregi (${miss.join(', ')}) — nu îl public. Mai încearcă.`);
  }
}

// Taie documentul HTML din răspunsul modelului (```fence + <!doctype…</html>).
// Întoarce null dacă documentul e INCOMPLET (fără </html>) — până acum un
// răspuns trunchiat trecea drept „valid” și ajungea publicat pe site.
function cutHtml(raw) {
  let h = String(raw || '');
  const fence = h.match(/```(?:html)?\s*([\s\S]*?)```/i);
  if (fence) h = fence[1];
  const e = h.lastIndexOf('</html>');
  if (e === -1) return null;
  // dacă în text apar mai multe începuturi de document (ex. modelul a luat-o
  // de la capăt la continuare), păstrăm ULTIMUL document complet
  const starts = (re) => {
    let s = -1;
    let m;
    while ((m = re.exec(h)) !== null) { if (m.index >= e) break; s = m.index; }
    return s;
  };
  const s = starts(/<!doctype html/gi);
  const s2 = s !== -1 ? s : starts(/<html[\s>]/gi);
  if (s2 === -1 || e <= s2) return null;
  return h.slice(s2, e + 7).trim();
}

// Apel Claude pentru RĂSPUNSURI LUNGI: când răspunsul se taie la max_tokens
// — SAU se oprește cu documentul neterminat (`until` neîndeplinit, ex. fără
// `</html>`) — îl CONTINUĂ automat (partea deja generată devine mesaj de
// asistent — „prefill” — iar modelul continuă exact de unde a rămas), până la
// 4 reluări. Dacă modelul a răspuns cu PROZĂ în loc de document (fără niciun
// <!doctype/<html>), i se RE-CERE o dată, strict, doar documentul.
// Așa nu se mai pierde finalul testelor mari (ex. tocmai Subiectul III).
// Plase de siguranță suplimentare:
//  • „prompt is too long” (unele PDF-uri — culegeri dense — sar de limita de
//    tokeni ca documente native): PDF-urile devin TEXT extras (pdfText) și
//    cererea se reia o dată;
//  • erori TRANZITORII (429 / suprasarcină): reîncercare după 15s — înainte,
//    o singură eroare de rate-limit în mijlocul continuărilor lăsa documentul
//    neterminat și rularea pe eroare;
//  • anti-buclă: dacă textul crește peste ~800k de caractere fără să se
//    închidă documentul, ne oprim (model degenerat), cu diagnostic.
// ─── ECONOMIE DE TOKENI la clonarea șabloanelor ──────────────────────────────
// Clonarea unui șablon de ~100KB cerea ~35k tokeni de IEȘIRE (~4 minute de
// generare) — nu încăpea în limita funcției Vercel (300s) când mai era nevoie
// și de continuări. Acum blocurile <style>/<script> pe care modelul le-ar
// copia neschimbate NU se mai regenerează: șablonul trimis e adnotat cu
// <!--TPL:N-->, modelul pune marcaje GOALE <style/script data-tpl="N">, iar
// serverul reinserează blocurile originale (tplRestore). Blocul cu datele
// itemilor se rescrie mereu complet.
const TPL_RULE = '\n- ECONOMIE DE TOKENI — OBLIGATORIU: blocurile <style>…</style> și <script>…</script> pe care le-ai copia NESCHIMBATE din șablon NU le rescrii: pui în locul lor DOAR marcajul GOL <style data-tpl="N"></style>, respectiv <script data-tpl="N"></script> (N = numărul din comentariul <!--TPL:N--> care precede blocul în șablon), iar serverul reinserează automat blocul original. Blocurile pe care le MODIFICI le scrii complet — în special blocul cu DATELE itemilor/exercițiilor se rescrie MEREU complet, cu noul conținut (niciodată ca marcaj).';

function tplAnnotate(tpl) {
  const blocks = [];
  const annotated = String(tpl || '').replace(/<style\b[\s\S]*?<\/style>|<script\b[\s\S]*?<\/script>/gi, (m) => {
    const idx = blocks.length;
    blocks.push(m);
    return `<!--TPL:${idx}-->${m}`;
  });
  return { annotated, blocks };
}

function tplRestore(html, blocks) {
  if (!blocks || !blocks.length) return String(html || '');
  let out = String(html || '');
  out = out.replace(/<(style|script)\b[^>]*\bdata-tpl\s*=\s*["']?(\d+)["']?[^>]*>\s*<\/\1>/gi, (m, tag, num) => {
    const b = blocks[Number(num)];
    return b !== undefined ? b : m;
  });
  return out.replace(/<!--TPL:\d+-->/g, '');
}

const LOOKS_HTML_RE = /<!doctype html|<html[\s>]/i;
const TOO_LONG_RE = /prompt is too long|request.{0,30}too large|exceed.{0,40}(context|maximum)/i;
const TRANSIENT_RE = /overloaded|rate.?limit|too many requests|internal server|timed?.?out/i;

// Înlocuiește blocurile PDF native cu TEXT extras (primele pagini) — folosit
// când API-ul respinge cererea ca fiind prea mare. Întoarce null dacă nu
// există blocuri PDF (nu are ce ușura).
async function blocksWithPdfText(blocks) {
  const { pdfText } = require('./pdftext');
  const out = [];
  let changed = false;
  for (const b of (Array.isArray(blocks) ? blocks : [])) {
    if (b && b.type === 'document' && b.source?.data) {
      changed = true;
      let t = '';
      try { t = await pdfText(Buffer.from(String(b.source.data), 'base64'), 50000); } catch { /* gol */ }
      out.push({ type: 'text', text: t
        ? `(conținutul PDF-ului, extras ca TEXT — primele pagini; PDF-ul întreg era prea mare pentru context):\n${t}`
        : '(PDF-ul nu a putut fi citit ca text — era prea mare pentru context ca document nativ)' });
    } else {
      out.push(b);
    }
  }
  return changed ? out : null;
}

// Modelele care au respins DEJA prefill-ul de asistent (ex. „This model does
// not support assistant message prefill”) — următoarele continuări încep
// direct cu metoda prin mesaj de utilizator, fără încă un apel irosit.
const NO_PREFILL = new Set();

async function chatClaudeLong({ system, blocks, maxTokens = 24000, model = null, until = null, schema = null }) {
  const t0 = Date.now();
  // Sub limita funcției Vercel: mai bine o eroare CLARĂ înregistrată decât
  // FUNCTION_INVOCATION_TIMEOUT cu rularea pierdută. Limita e maxDuration=800
  // din vercel.json (plan Pro, Fluid) → deadline ~710s; ține-le SINCRON (dacă
  // schimbi maxDuration, setează env FUNCTION_MAX_SECONDS la aceeași valoare).
  const DEADLINE_MS = Math.max(120, (Number(process.env.FUNCTION_MAX_SECONDS) || 800) - 90) * 1000;
  const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
  // `schema` (Etapa 3): Structured Outputs pe PRIMUL apel (JSON garantat valid);
  // continuările prin prefill rămân text brut (nu se combină cu output_config).
  const call = (messages, first = false) => claude.chatClaude({ system, messages, maxTokens, model, ...(schema && first ? { schema } : {}) });
  let baseMessages = [{ role: 'user', content: blocks }];
  const usage = { prompt_tokens: 0, completion_tokens: 0, model: null };
  let r;
  let pdfSwapped = false;
  let transientLeft = 1;
  for (;;) {
    try { r = await call(baseMessages, true); break; }
    catch (e) {
      const msg = String(e.message || '');
      if (!pdfSwapped && TOO_LONG_RE.test(msg)) {
        const lighter = await blocksWithPdfText(blocks);
        if (lighter) {
          console.warn('exgen: cerere prea mare (%s) — PDF-urile devin text extras și reîncerc', msg.slice(0, 120));
          pdfSwapped = true;
          baseMessages = [{ role: 'user', content: lighter }];
          continue;
        }
      }
      if (transientLeft > 0 && (e.status === 429 || TRANSIENT_RE.test(msg))) {
        transientLeft--;
        await sleep(15000);
        continue;
      }
      throw e;
    }
  }
  const addUsage = () => {
    usage.prompt_tokens += r.usage?.prompt_tokens || 0;
    usage.completion_tokens += r.usage?.completion_tokens || 0;
    // păstrează modelul real folosit (pt. costul corect în ai.logUsage)
    usage.model = usage.model || r.usage?.model || r.provider || model || null;
  };
  addUsage();
  let text = String(r.text || '');

  // O RUNDĂ de continuare. Întâi prin PREFILL de asistent (continuare perfectă,
  // caracter cu caracter). Dacă API-ul RESPINGE prefill-ul (ex. configurațiile
  // cu thinking activ interzic mesajul final de asistent — cazul
  // „[stop=max_tokens, continuări=0]”), trecem definitiv pe continuarea prin
  // MESAJ DE UTILIZATOR: modelul primește partea deja generată și scrie doar
  // restul, iar lipirea se face pe suprapunerea de la coadă.
  let userMode = NO_PREFILL.has(claude.resolveModel(model));
  let retriesLeft = 2; // reîncercări la erori tranzitorii, pe toată durata continuărilor
  async function continueOnce() {
    const prefill = text.replace(/\s+$/, '');
    if (!prefill) return false;
    for (;;) {
      try {
        if (!userMode) {
          r = await call([...baseMessages, { role: 'assistant', content: prefill }]);
          addUsage();
          text = prefill + String(r.text || '');
          return true;
        }
        const tail = prefill.slice(-400);
        const partial = prefill.length > 150000 ? `…${prefill.slice(-150000)}` : prefill;
        r = await call([...baseMessages, {
          role: 'user',
          content: `Răspunsul tău anterior s-a ÎNTRERUPT înainte de final. Iată partea deja generată:\n${partial}\n\nCONTINUĂ EXACT de unde s-a întrerupt: fără nicio introducere, fără \u0060\u0060\u0060, fără să reiei documentul de la început — scrie DOAR conținutul care urmează imediat după finalul de mai sus, până închizi documentul cu </html>.`,
        }]);
        addUsage();
        let add = String(r.text || '');
        add = add.replace(/^\s*```(?:html)?\s*/i, '').replace(/\s*```\s*$/, '');
        const ti = add.indexOf(tail);
        if (ti !== -1) {
          add = add.slice(ti + tail.length);
        } else {
          for (let k = 400; k >= 40; k--) {
            const suf = prefill.slice(-k);
            if (suf && add.startsWith(suf)) { add = add.slice(k); break; }
          }
        }
        // dacă modelul a luat-o oricum de la capăt cu TOT documentul, păstrăm varianta lui
        text = (LOOKS_HTML_RE.test(add) && add.length > prefill.length / 2) ? add : prefill + add;
        return true;
      } catch (e) {
        const msg = String(e.message || '');
        if (retriesLeft > 0 && (e.status === 429 || TRANSIENT_RE.test(msg))) {
          retriesLeft--;
          await sleep(15000);
          continue; // reîncearcă ACELAȘI segment
        }
        if (!userMode) {
          userMode = true;
          NO_PREFILL.add(claude.resolveModel(model));
          console.warn('exgen: continuarea cu prefill a fost respinsă (%s) — trec pe continuarea prin mesaj de utilizator', msg.slice(0, 140));
          continue;
        }
        console.warn('exgen: continuarea răspunsului lung a eșuat (%s) — folosesc ce am', e.message);
        return false;
      }
    }
  }

  // continuăm cât timp: (a) răspunsul s-a tăiat la max_tokens, sau (b) modelul
  // s-a oprit dar documentul început e NETERMINAT (`until` fals pe un text care
  // arată a document). `r.stopReason` există doar pe API-ul Claude real —
  // providerul fallback nu-l are, deci acolo nu încercăm continuarea.
  const needsMore = () => (r.stopReason === 'max_tokens'
    || (!!r.stopReason && typeof until === 'function' && !until(text) && LOOKS_HTML_RE.test(text)))
    && text.length < 800000;
  let rounds = 0;
  while (needsMore() && rounds < 4) {
    if (Date.now() - t0 > DEADLINE_MS) {
      console.warn('exgen: fără timp pentru încă o continuare (%ss scurse) — mă opresc cu ce am', Math.round((Date.now() - t0) / 1000));
      break;
    }
    if (!(await continueOnce())) break;
    rounds++;
  }
  // Modelul a răspuns cu explicații/proză în loc de document → o singură
  // re-cerere STRICTĂ (conversația + refuzul lui + reamintirea formatului).
  let strictRetry = false;
  if (!!r.stopReason && typeof until === 'function' && !until(text) && !LOOKS_HTML_RE.test(text)) {
    strictRetry = true;
    try {
      const r2 = await claude.chatClaude({
        system,
        messages: [
          ...baseMessages,
          { role: 'assistant', content: text.replace(/\s+$/, '') || '(răspuns gol)' },
          { role: 'user', content: 'Răspunsul tău NU conține documentul cerut. Fără nicio explicație, scuză sau întrebare: răspunde ACUM EXCLUSIV cu documentul HTML complet, de la <!doctype html> până la </html>, respectând toate regulile din instrucțiuni.' },
        ],
        maxTokens, model,
      });
      r = r2;
      addUsage();
      if (LOOKS_HTML_RE.test(String(r2.text || ''))) text = String(r2.text || '');
      // …iar dacă și răspunsul strict s-a tăiat la limită, îl continuăm și pe el
      let extra = 0;
      while (r.stopReason === 'max_tokens' && extra < 2 && Date.now() - t0 < DEADLINE_MS) {
        if (!(await continueOnce())) break;
        extra++;
        rounds++;
      }
    } catch (e) {
      console.warn('exgen: re-cererea strictă a eșuat (%s) — folosesc ce am', e.message);
    }
  }
  return { text, usage, provider: r.provider, stopReason: r.stopReason, continuations: rounds, strictRetry, viaUserMode: userMode, textLength: text.length };
}

// ─── Validarea exercițiului JSON (mutat din ai-exercise-agent.js) ───────────
function normalize(ex) {
  if (!ex || typeof ex !== 'object') return null;
  const kind = ex.kind === 'etape' ? 'etape' : 'grila';
  const out = {
    title: String(ex.title || 'Exercițiu generat'), kind,
    statement: String(ex.statement || ''),
    output: ex.output === 'pdf' ? 'pdf' : 'interactive',
  };
  if (kind === 'grila') {
    const qs = Array.isArray(ex.questions) ? ex.questions : [];
    out.questions = qs.slice(0, 20).map((q) => {
      const opts = Array.isArray(q.options) && q.options.length ? q.options.slice(0, 6).map(String) : undefined;
      let answer;
      if (opts) {
        const idx = Number(q.answer);
        // răspuns cu variante: DOAR un index întreg valid [0, opts.length). Un
        // index 1-based ("4" la 4 opțiuni) sau o literă ("B"→NaN) ar face
        // întrebarea imposibil de răspuns corect → o eliminăm (ca normalizeQuestions).
        if (!Number.isInteger(idx) || idx < 0 || idx >= opts.length) return null;
        answer = idx;
      } else {
        answer = String(q.answer ?? '');
      }
      return {
        statement: String(q.statement || ''),
        options: opts,
        answer,
        hint: String(q.hint || ''),
        explanation: String(q.explanation || ''),
        points: Math.max(1, Number(q.points) || 10),
      };
    }).filter((q) => q && q.statement);
    if (!out.questions.length) return null;
  } else {
    const st = Array.isArray(ex.steps) ? ex.steps : [];
    out.steps = st.slice(0, 20).map((s) => ({
      prompt: String(s.prompt || s.text || ''),
      answer: String(s.answer ?? ''),
      hint: String(s.hint || ''),
      explanation: String(s.explanation || ''),
      points: Math.max(1, Number(s.points) || 10),
    })).filter((s) => s.prompt);
    out.final_answer = String(ex.final_answer || '');
    if (!out.steps.length || !out.statement) return null;
  }
  return out;
}

// ─── Schema STRICTĂ a exercițiului JSON (Structured Outputs, Etapa 3) ────────
// Aceeași formă pentru agentul de exerciții (admin) și pentru task-urile
// programate. `answer` era polimorf (index la grilă / text la răspuns liber) —
// în modul strict devin două chei: answer_index (grilă) / answer_text (liber).
const EXERCISE_SCHEMA = S.obj({
  title: S.str('titlul exercițiului'),
  kind: S.enum(['grila', 'etape'], 'grila = itemi (cu sau fără variante); etape = o problemă rezolvată pe pași'),
  output: S.nullable(S.enum(['interactive', 'pdf'], 'formatul de salvare cerut de admin (implicit interactive)')),
  statement: S.str('contextul general / enunțul problemei (poate fi gol la grilă)'),
  questions: S.nullable(S.arr(S.obj({
    statement: S.str('enunțul itemului (LaTeX între $...$)'),
    options: S.nullable(S.arr(S.str(), 'exact 4 variante la grilă; null la răspuns liber')),
    answer_index: S.nullable(S.int('indexul variantei corecte (0–3) la grilă; null la răspuns liber')),
    answer_text: S.nullable(S.str('răspunsul final (număr/expresie) la răspuns liber; null la grilă')),
    hint: S.str('indiciu fără răspuns'),
    explanation: S.str('rezolvarea completă'),
    points: S.num('baremul itemului'),
  }), 'itemii (kind=grila); null la kind=etape')),
  steps: S.nullable(S.arr(S.obj({
    prompt: S.str('ce se cere la această etapă'),
    answer: S.str('răspuns scurt (număr/expresie)'),
    hint: S.str('indiciu fără răspuns'),
    explanation: S.str('rezolvarea etapei (barem)'),
    points: S.num('baremul etapei'),
  }), 'etapele (kind=etape); null la kind=grila')),
  final_answer: S.nullable(S.str('răspunsul final (kind=etape)')),
});
// Răspunsul modelului (cu sau fără schemă) → forma clasică → normalize()
function parseExercise(r) {
  let raw = r && r.data && typeof r.data === 'object' ? r.data : null;
  if (!raw) { try { raw = JSON.parse(String(r?.text || '')); } catch { raw = claude.extractJson(r?.text); } }
  if (!raw || typeof raw !== 'object') return null;
  const ex = { ...raw };
  if (Array.isArray(ex.questions)) {
    ex.questions = ex.questions.filter(Boolean).map((q) => {
      const { answer_index, answer_text, ...rest } = q;
      const opts = Array.isArray(q.options) && q.options.length ? q.options : null;
      // grilă fără answer_index (modelul a completat answer_text) → NaN, ca
      // normalize() să ELIMINE itemul; altfel Number(null)=0 însemna „varianta a)"
      const answer = q.answer !== undefined ? q.answer : (opts ? (answer_index ?? NaN) : (answer_text ?? ''));
      return { ...rest, ...(opts ? { options: opts } : {}), answer };
    });
  }
  for (const k of Object.keys(ex)) if (ex[k] === null) delete ex[k];
  return normalize(ex);
}

// ─── Descărcarea unui fișier-sursă din Storage (tolerantă la cale) ──────────
// `file_url` e URL-ul PUBLIC al fișierului, deci calea din el e procent-codificată
// („Fișă 8.pdf" → „Fi%C8%99%C4%83%208.pdf"), în timp ce CHEIA reală din bucket e cea
// DECODIFICATĂ. Trimisă așa cum e la storage.download(), calea codificată dă 404 la
// materialele cu diacritice/spații în numele fișierului — iar în modul „pe rând"
// task-ul se bloca pe același fișier la fiecare rulare („Nu am putut descărca
// fișierul-sursă …"). Încercăm, în ordine: calea decodificată, calea brută din URL,
// aceleași două în bucket-ul pereche (content-files ↔ content-files-free — mutările
// gratuit↔premium lasă uneori file_url în urmă) și, la final, chiar URL-ul public.
// Întoarce { buf } sau { buf: null, reason } cu MOTIVUL real de la Storage, ca să
// apară în istoricul task-ului în loc de un mesaj generic.
const SIBLING_BUCKET = { 'content-files': 'content-files-free', 'content-files-free': 'content-files' };

function storageAttempts(fileUrl) {
  const url = new URL(fileUrl);
  const parts = url.pathname.split('/');
  const oi = parts.findIndex((x) => x === 'object');
  if (oi === -1) throw new Error('URL fără „/object/" — nu pare un fișier din Storage.');
  const bucket = parts[oi + 2];
  const rawPath = parts.slice(oi + 3).join('/').split('?')[0];
  if (!bucket || !rawPath) throw new Error('Nu s-a putut extrage calea din URL.');
  let decoded = rawPath;
  try { decoded = decodeURIComponent(rawPath); } catch { /* rămâne cum e */ }
  const paths = decoded === rawPath ? [rawPath] : [decoded, rawPath];
  const attempts = [];
  for (const b of [bucket, SIBLING_BUCKET[bucket]].filter(Boolean)) {
    for (const p of paths) attempts.push({ bucket: b, path: p });
  }
  return { attempts, isPublic: parts[oi + 1] === 'public' };
}

async function downloadStorage(supa, fileUrl) {
  const url = String(fileUrl || '').trim();
  if (!url) return { buf: null, reason: 'materialul nu are fișier atașat' };
  let plan;
  try { plan = storageAttempts(url); }
  catch (e) { return { buf: null, reason: String((e && e.message) || e) }; }
  let reason = 'fișierul nu mai există în Storage';
  for (const a of plan.attempts) {
    try {
      const { data: blob, error } = await supa.storage.from(a.bucket).download(a.path);
      if (blob) return { buf: Buffer.from(await blob.arrayBuffer()), bucket: a.bucket, path: a.path };
      if (error) reason = String(error.message || error);
    } catch (e) { reason = String((e && e.message) || e); }
  }
  // ultima șansă: chiar URL-ul public (cheie „exotică" pe care API-ul o refuză)
  if (plan.isPublic && /^https?:\/\//i.test(url)) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(15000) });
      if (r.ok) return { buf: Buffer.from(await r.arrayBuffer()), bucket: null, path: null };
      reason = `${reason} (URL public: HTTP ${r.status})`;
    } catch (e) { reason = `${reason} (URL public: ${String((e && e.message) || e)})`; }
  }
  return { buf: null, reason };
}

// ─── Context suplimentar din ALTE rubrici (ex. baremele testelor) ────────────
// extraRubrics = [{category, subcategory, profile, ctype}, …] (max 3).
// Din fiecare rubrică ia max 2 materiale la întâmplare: PDF → blocuri native
// Claude (≤ ~3 MB în total), interactiv/HTML → extras text. Ele NU sunt
// teste-sursă de combinat — sunt REFERINȚĂ (stilul baremului, punctare etc.).
async function fetchExtraContext(supa, extraRubrics) {
  const docBlocks = [];
  const texts = [];
  const names = [];
  let pdfBytes = 0;
  for (const r of (Array.isArray(extraRubrics) ? extraRubrics : []).slice(0, 3)) {
    if (!r || !r.category) continue;
    try {
      let q = supa.from('content')
        .select('id, title, file_url, interactive_data, content_type')
        .eq('content_type', r.ctype === 'pdf' ? 'pdf' : 'interactive')
        .eq('category', r.category);
      if (r.subcategory && String(r.subcategory).includes('+')) q = q.in('subcategory', String(r.subcategory).split('+'));
      else if (r.subcategory) q = q.eq('subcategory', r.subcategory);
      if (r.profile) q = q.eq('profile', r.profile);
      const { data: rows } = await q.limit(20);
      const shuffled = [...(rows || [])].sort(() => Math.random() - 0.5);
      let taken = 0;
      for (const row of shuffled) {
        if (taken >= 2) break;
        try {
          if (row.content_type === 'pdf') {
            const { buf } = await downloadStorage(supa, row.file_url);
            if (!buf) continue;
            if (buf.length > 2 * 1024 * 1024 || pdfBytes + buf.length > 3 * 1024 * 1024) continue;
            pdfBytes += buf.length;
            docBlocks.push({ type: 'text', text: `MATERIAL DE CONTEXT SUPLIMENTAR (referință, NU test-sursă): ${row.title}` });
            docBlocks.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: buf.toString('base64') } });
          } else if (row.interactive_data?.exercise) {
            texts.push({ title: row.title, text: JSON.stringify(row.interactive_data.exercise).slice(0, 4000) });
          } else {
            const { buf } = await downloadStorage(supa, row.file_url);
            if (!buf) continue;
            const raw = buf.toString('utf8');
            const t = raw.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
            if (t.length < 100) continue;
            texts.push({ title: row.title, text: t.slice(0, 4000) });
          }
          names.push(row.title);
          taken++;
        } catch { /* material ignorat */ }
      }
    } catch { /* rubrică ignorată */ }
  }
  const textBlock = texts.length
    ? `\n\n=== MATERIALE DE CONTEXT SUPLIMENTAR (referință — NU teste de combinat) ===\n${texts.map((x) => `— ${x.title}:\n${x.text}`).join('\n\n')}\n=== SFÂRȘIT CONTEXT SUPLIMENTAR ===`
    : '';
  return { docBlocks, textBlock, names };
}

// Propoziția adăugată în system prompt când există context suplimentar
const extraLine = (names) => (names.length
  ? `\nPrimești și MATERIALE DE CONTEXT SUPLIMENTAR (${names.length}, ex. bareme oficiale): NU le combina ca teste-sursă — folosește-le ca referință pentru stilul baremului/punctării, formulările cerințelor și rigoarea rezolvărilor.`
  : '');

// ─── MODUL DE GENERARE — detectat din „Instrucțiuni pentru agent" ────────────
// • sequential („pe rând"): fiecare rulare ia URMĂTORUL fișier neprelucrat din
//   rubrică și îl transformă singur într-un exercițiu/test interactiv nou —
//   fraze de tip „ia pe rând fișierele rubricii", „câte un fișier", „unul câte
//   unul", „fiecare fișier în parte".
// • pair (corespondență test↔barem): rubrica principală = modelele, o rubrică
//   suplimentară = baremele; agentul primește pentru fiecare test-sursă
//   BAREMUL CORESPONDENT, potrivit după titlu (numere + cuvinte comune) —
//   activat de cuvântul „barem"/„corespondent" în instrucțiuni SAU automat
//   când o rubrică din context are „barem" în nume.
// Fără fraze speciale → combinarea clasică (comportamentul de până acum).
const deDia = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

function detectMode(instructions, extraRubrics = []) {
  const t = ' ' + deDia(instructions).replace(/[^a-z0-9]+/g, ' ') + ' ';
  const sequential =
    / pe rand /.test(t) || / rand pe rand /.test(t) ||
    / unul cate unul /.test(t) || / una cate una /.test(t) ||
    / cate un (fisier|material|test|model|subiect) /.test(t) ||
    / cate unul /.test(t) ||
    / fiecare (fisier|material|test|subiect) /.test(t) ||
    / luand pe rand /.test(t) || / ia pe rand /.test(t) || / luate pe rand /.test(t);
  const extraHasBarem = (Array.isArray(extraRubrics) ? extraRubrics : [])
    .some((r) => /barem/.test(deDia(`${r?.category || ''} ${r?.subcategory || ''}`)));
  const pair = (Array.isArray(extraRubrics) && extraRubrics.length > 0)
    && (/barem|corespondent/.test(t) || extraHasBarem);
  return { sequential, pair };
}

// ─── Potrivirea test ↔ barem după TITLU (numerele cântăresc cel mai mult) ────
const TITLE_STOP = new Set(['barem', 'bareme', 'baremul', 'baremele', 'rezolvare', 'rezolvari', 'rezolvarea', 'corectare', 'evaluare', 'si', 'de', 'la', 'cu', 'din', 'pentru', 'al', 'a', 'lui']);

function titleMatchScore(srcTitle, candTitle) {
  const tok = (s) => deDia(s).replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter((w) => w && !TITLE_STOP.has(w));
  const at = tok(srcTitle);
  const bt = tok(candTitle);
  if (!at.length || !bt.length) return 0;
  const aNums = at.filter((w) => /^\d+$/.test(w));
  const bNums = bt.filter((w) => /^\d+$/.test(w));
  // ambele au numere dar niciunul comun → aproape sigur alt test (Testul 3 ≠ Testul 7)
  if (aNums.length && bNums.length && !aNums.some((n) => bNums.includes(n))) return 0;
  const bset = new Set(bt);
  const common = at.filter((w) => bset.has(w)).length;
  let score = common / Math.max(at.length, bt.length);
  if (aNums.length && bNums.length && aNums.some((n) => bNums.includes(n))) score += 0.4;
  return score;
}

// Pentru fiecare titlu-sursă, caută în rubricile suplimentare materialul
// CORESPONDENT (ex. baremul aceluiași test) și îl atașează: PDF nativ (≤ ~2,5MB
// fiecare, ≤ ~5MB în total) sau extras text. Returnează și `pairs` (cine cu cine).
async function fetchPairedContext(supa, extraRubrics, srcTitles) {
  const candidates = [];
  for (const r of (Array.isArray(extraRubrics) ? extraRubrics : []).slice(0, 3)) {
    if (!r || !r.category) continue;
    try {
      let q = supa.from('content')
        .select('id, title, file_url, interactive_data, content_type')
        .eq('content_type', r.ctype === 'pdf' ? 'pdf' : 'interactive')
        .eq('category', r.category);
      if (r.subcategory && String(r.subcategory).includes('+')) q = q.in('subcategory', String(r.subcategory).split('+'));
      else if (r.subcategory) q = q.eq('subcategory', r.subcategory);
      if (r.profile) q = q.eq('profile', r.profile);
      const { data: rows } = await q.limit(200);
      candidates.push(...(rows || []));
    } catch { /* rubrică ignorată */ }
  }
  const docBlocks = [];
  const texts = [];
  const pairs = [];
  const used = new Set();
  let pdfBytes = 0;
  for (const st of srcTitles.slice(0, 3)) {
    let best = null;
    let bestScore = 0;
    for (const c of candidates) {
      if (used.has(c.id)) continue;
      const s = titleMatchScore(st, c.title);
      if (s > bestScore) { bestScore = s; best = c; }
    }
    if (!best || bestScore < 0.35) continue;
    used.add(best.id);
    try {
      if (best.content_type === 'pdf') {
        const { buf } = await downloadStorage(supa, best.file_url);
        if (!buf) continue;
        if (buf.length > 2.5 * 1024 * 1024 || pdfBytes + buf.length > 5 * 1024 * 1024) continue;
        pdfBytes += buf.length;
        docBlocks.push({ type: 'text', text: `BAREMUL/REZOLVAREA CORESPONDENTĂ pentru „${st}”: ${best.title}` });
        docBlocks.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: buf.toString('base64') } });
      } else if (best.interactive_data?.exercise) {
        texts.push({ title: `${best.title} (corespondent pentru „${st}”)`, text: JSON.stringify(best.interactive_data.exercise).slice(0, 5000) });
      } else {
        const { buf } = await downloadStorage(supa, best.file_url);
        if (!buf) continue;
        const raw = buf.toString('utf8');
        const txt = raw.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
        if (txt.length < 100) continue;
        texts.push({ title: `${best.title} (corespondent pentru „${st}”)`, text: txt.slice(0, 5000) });
      }
      pairs.push(`${st} ↔ ${best.title}`);
    } catch { /* material ignorat */ }
  }
  const textBlock = texts.length
    ? `\n\n=== BAREME/REZOLVĂRI CORESPONDENTE (potrivite după titlu) ===\n${texts.map((x) => `— ${x.title}:\n${x.text}`).join('\n\n')}\n=== SFÂRȘIT BAREME CORESPONDENTE ===`
    : '';
  const line = pairs.length
    ? `\nAi și BAREMELE/REZOLVĂRILE CORESPONDENTE ale unor teste-sursă, potrivite după titlu (${pairs.join('; ')}): folosește-le pentru RĂSPUNSURILE corecte, REZOLVĂRILE din "explanation" și proporțiile baremului ("points") — au prioritate față de propriile tale calcule când diferă.`
    : '';
  return { docBlocks, textBlock, names: pairs, line, pairs };
}

// =====================================================================
// BANCA DE ITEMI — combinarea reală a testelor unei rubrici
// =====================================================================
// De ce există: combinarea trimitea modelului 5 teste ÎNTREGI (text tăiat la
// 6000 de caractere) plus un PLAN de doar 8 poziții, în care itemii-sursă erau
// ceruți mereu dintre primii 5 ai testului. La un test de Evaluare Națională cu
// 3 subiecte × 6 itemi asta însemna:
//   • din 32 de teste ale rubricii ajungeau la model doar 5, iar din fiecare
//     doar începutul (Subiectul III al surselor era tăiat de limita de text);
//   • planul acoperea 8 din 18 poziții — pentru restul modelul urma regula
//     „același număr de itemi și aceeași structură ca șablonul" și COPIA itemii
//     șablonului;
//   • la Evaluare Națională regula figurilor („itemii cu figură rămân cei ai
//     șablonului") îngheța în plus TOT Subiectul II (geometrie).
// Efectul vizibil: se schimbau doar cele ~6 exerciții ale Subiectului I (
// array-ul EX1 din șablon), restul testului ieșea identic de la o rulare la alta.
//
// Acum serverul SPARGE fiecare test al rubricii în ITEMI, grupați pe subiecte,
// trage la sorți exact câți itemi cere șablonul din FIECARE subiect, din teste
// DIFERITE, și trimite modelului DOAR acei itemi. Figura fiecărui item
// călătorește cu el (marcaj <!--FIG:k-->, reinserat pe server după generare),
// deci enunțul și desenul rămân consistente chiar dacă itemul vine din alt test.

// Amestecare uniformă (Fisher–Yates). `sort(() => Math.random() - 0.5)` NU e o
// permutare uniformă — elementele rămân aproape de pozițiile inițiale, deci
// rulările succesive porneau de la aproape aceleași teste-sursă.
function shuffle(arr) {
  const a = [...(arr || [])];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const romanSec = (d) => (d === '1' ? 'I' : d === '2' ? 'II' : d === '3' ? 'III' : String(d).toUpperCase());

// Titlurile de secțiune („Subiectul I/II/III") cu poziția lor în document.
// Se caută întâi marcajele EXPLICITE de secțiune (formatul standard:
// <div class="sec-title">Subiectul II …), ca să nu numărăm și mențiunile din
// antetul paginii („Subiectul I &amp; Subiectul II · 12 exerciții”), care ar
// atribui greșit primele card-uri.
function sectionMarks(html) {
  const s = String(html || '');
  const out = [];
  let m;
  const re1 = /<(?:div|h[1-6]|p|section)[^>]*class=["'][^"']*\b(?:sec-title|sect-title|sec|section|subiect|subject)\b[^"']*["'][^>]*>\s*(?:<[^>]+>\s*)*subiectul\s*(?:al\s*)?(i{1,3}|[123])/gi;
  while ((m = re1.exec(s))) out.push({ sec: romanSec(m[1]), at: m.index });
  if (out.length) return out;
  const re2 = /<h[1-6][^>]*>[\s\S]{0,80}?subiectul\s*(?:al\s*)?(i{1,3}|[123])/gi;
  while ((m = re2.exec(s))) out.push({ sec: romanSec(m[1]), at: m.index });
  return out;
}

// Blocurile <div class="card"> … </div> ECHILIBRATE (itemii formatului
// standard). Clasa se verifică pe listă de token-uri, nu cu regex — altfel
// „card-hdr” ar trece drept „card”.
function extractCards(html) {
  const s = String(html || '');
  const out = [];
  const open = /<div\b([^>]*)>/gi;
  let m;
  while ((m = open.exec(s))) {
    const cls = (m[1].match(/class\s*=\s*["']([^"']*)["']/i) || [, ''])[1];
    if (!String(cls).split(/\s+/).includes('card')) continue;
    const start = m.index;
    const tag = /<div\b[^>]*>|<\/div\s*>/gi;
    tag.lastIndex = start;
    let depth = 0;
    let end = -1;
    let t;
    while ((t = tag.exec(s))) {
      if (t[0][1] === '/') { depth--; if (depth <= 0) { end = t.index + t[0].length; break; } } else depth++;
      if (t.index - start > 60000) break; // plasă de siguranță
    }
    if (end === -1) break;
    out.push({ html: s.slice(start, end), at: start });
    open.lastIndex = end;
  }
  return out;
}

// Sfârșitul unui array/obiect JS, cu ghilimelele respectate: array-urile de
// itemi conțin HTML în template literals (tabele), deci au acolade și
// apostrofuri înăuntru.
function scanBalanced(s, from, open, close) {
  let depth = 0;
  let q = null;
  for (let i = from; i < s.length; i++) {
    const c = s[i];
    if (q) {
      if (c === '\\') { i++; continue; }
      if (c === q) q = null;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') { q = c; continue; }
    if (c === open) depth++;
    else if (c === close) { depth--; if (depth === 0) return i; }
  }
  return -1;
}

// Array-urile de itemi din <script> (ex. `var EX1 = [{q:…, ok:…}, …]`):
// întoarce numele array-ului și textul fiecărui obiect-item.
function extractArrayItems(html) {
  const s = String(html || '');
  const out = [];
  const re = /\b(?:var|let|const)\s+([A-Za-z_$][\w$]*)\s*=\s*\[/g;
  let m;
  while ((m = re.exec(s))) {
    const open = s.indexOf('[', m.index);
    if (open === -1) continue;
    const end = scanBalanced(s, open, '[', ']');
    if (end === -1) continue;
    const body = s.slice(open + 1, end);
    const objs = [];
    let i = 0;
    while (i < body.length) {
      const b = body.indexOf('{', i);
      if (b === -1) break;
      const e = scanBalanced(body, b, '{', '}');
      if (e === -1) break;
      objs.push(body.slice(b, e + 1));
      i = e + 1;
    }
    // e chiar un array de ITEMI? (obiectele au enunț ȘI cheie de răspuns)
    const items = objs.filter((o) => /[{,\s]["']?(?:q|enunt|statement|prompt|lead|intrebare)["']?\s*:/.test(o)
      && /[{,\s]["']?(?:ok|ans|answer|ci|correct|corect|raspuns|a)["']?\s*:/.test(o));
    if (items.length < 2) continue;
    out.push({ name: m[1], at: m.index, items });
    re.lastIndex = end;
  }
  return out;
}

// Scoate desenele (SVG / <canvas>) dintr-un fragment de item și le înlocuiește
// cu marcaje <!--FIG:k-->; `figs` colectează originalele, ca serverul să le
// reinsereze după generare.
// Se scot TOATE desenele din item (chiar și cele mici — restaurarea e oricum
// identică la octet), dar `hasFig` — eticheta „ARE FIGURĂ” din plan și filtrul
// rubricilor fără figuri — se aprinde doar la o figură adevărată (peste ~300 de
// caractere); o pictogramă decorativă din enunț nu trebuie să blocheze itemul.
function pullFigures(fragment, figs) {
  let hasFig = false;
  const idx = [];
  const text = String(fragment || '').replace(/<svg[\s\S]*?<\/svg>|<canvas\b[\s\S]*?<\/canvas>/gi, (m) => {
    const k = figs.length;
    figs.push({ svg: m, statement: '' });
    idx.push(k);
    if (m.length > 300 || /^<canvas/i.test(m)) hasFig = true;
    return `<!--FIG:${k}-->`;
  });
  // enunțul ORIGINAL al itemului se ține lângă figură: la reinserare, literele
  // punctelor din desen se aliniază la literele din enunțul NOU (vezi figRestore)
  if (idx.length) {
    const st = itemStatements(text)[0] || '';
    idx.forEach((k) => { figs[k].statement = st; });
  }
  return { text, hasFig };
}

// ─── ETICHETELE PUNCTELOR ────────────────────────────────────────────────────
// „Punct” = literă mare care NU face parte dintr-un cuvânt: nu e urmată de o
// literă mică (deci „Fie”, „Lungimea” nu intră) și nu e precedată de una. O
// literă mare poate fi precedată de altă literă mare, ca să prindem „ABCD”
// întreg, nu doar „A”. Ordinea = ordinea primei apariții în enunț.
const RO_LOW = 'a-zăâîșțáéíóúàèçöü';
const RO_UP = 'A-ZĂÂÎȘȚ';
const POINT_RE = new RegExp(`(?<![${RO_LOW}])([${RO_UP}])(?![${RO_LOW}])`, 'g');
function pointLabels(text) {
  const s = String(text || '').replace(/<[^>]+>/g, ' ');
  const out = [];
  let m;
  POINT_RE.lastIndex = 0;
  while ((m = POINT_RE.exec(s))) if (!out.includes(m[1])) out.push(m[1]);
  return out;
}

// Etichetele-text chiar din desen (literele scrise pe figură)
function svgLabels(svg) {
  const out = new Set();
  const re = /<text\b[^>]*>([\s\S]*?)<\/text\s*>/gi;
  let m;
  while ((m = re.exec(String(svg || '')))) {
    const t = m[1].replace(/<[^>]+>/g, '').trim();
    if (/^[A-ZĂÂÎȘȚ]['’]?[0-9]?$/.test(t)) out.add(t);
  }
  return out;
}

// ─── NUMERELE SCRISE PE DESEN ────────────────────────────────────────────────
// Lungimile, unghiurile și celelalte valori trecute pe figură („3 cm", „60°").
// Se citesc DOAR din <text>: coordonatele (x1, cy, viewBox…) nu se ating
// niciodată, altfel desenul s-ar deforma.
function numberTokens(text) {
  const s = String(text || '').replace(/<[^>]+>/g, ' ');
  const out = [];
  const re = /\d+(?:[.,]\d+)?/g;
  let m;
  while ((m = re.exec(s))) out.push(m[0]);
  return out;
}

function svgNumbers(svg) {
  const out = new Set();
  const re = /<text\b[^>]*>([\s\S]*?)<\/text\s*>/gi;
  let m;
  while ((m = re.exec(String(svg || '')))) numberTokens(m[1]).forEach((n) => out.add(n));
  return out;
}

// Corespondența numerelor, dedusă din schimbarea enunțului: numerele enunțului
// ORIGINAL, în ordinea apariției, se pun în corespondență cu cele ale enunțului
// NOU („BC=3cm" → „NP=5cm" dă 3→5). Se rețin doar cele care apar CHIAR pe desen.
// Dacă modelul a schimbat CÂTE numere sunt în enunț, nu ghicim — desenul rămâne
// cu valorile lui.
function numberMapFromStatements(oldSt, newSt, svg) {
  const oldN = numberTokens(oldSt);
  const newN = numberTokens(newSt);
  if (!oldN.length || oldN.length !== newN.length) return null;
  const onFig = svgNumbers(svg);
  if (!onFig.size) return null;
  const map = new Map();
  oldN.forEach((o, i) => { if (newN[i] && newN[i] !== o && onFig.has(o)) map.set(o, newN[i]); });
  return map.size ? map : null;
}

// Redenumirea punctelor din desen, dedusă din schimbarea notațiilor în enunț:
// literele-punct ale enunțului ORIGINAL (păstrate doar cele care apar chiar pe
// desen) se pun în corespondență, în ordinea apariției, cu literele-punct ale
// enunțului NOU. „A,B,C,D coliniare” → „M,N,P,Q coliniare” dă A→M, B→N, C→P, D→Q.
// Dacă numărul de puncte nu se potrivește, nu ghicim: desenul rămâne neatins.
function labelMapFromStatements(oldSt, newSt, svg) {
  const onFig = svgLabels(svg);
  if (!onFig.size) return null;
  // Punerea în corespondență se face pe listele ÎNTREGI de puncte ale celor două
  // enunțuri (altfel pozițiile nu s-ar mai potrivi), și abia apoi se păstrează
  // doar literele care apar chiar pe desen: un enunț cu ABCD desenat doar prin
  // A și B trebuie să dea tot A→M, B→N.
  const oldL = pointLabels(oldSt);
  const newL = pointLabels(newSt);
  if (!oldL.length || newL.length !== oldL.length) return null;
  const map = new Map();
  oldL.forEach((o, i) => { if (newL[i] && newL[i] !== o && onFig.has(o)) map.set(o, newL[i]); });
  return map.size ? map : null;
}

const reEsc = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Rescrie etichetele desenului: literele punctelor ȘI numerele trecute pe figură
// (lungimi, unghiuri). Se atinge NUMAI conținutul elementelor <text> — liniile,
// coordonatele, viewBox-ul și proporțiile rămân intacte.
// Înlocuirea e SIMULTANĂ (o singură trecere, fiecare potrivire căutată în hartă),
// deci și interschimbările A↔B sau 3↔5 ies corect.
function rewriteSvgText(svg, letterMap = null, numMap = null) {
  const lKeys = letterMap && letterMap.size
    ? [...letterMap.keys()].sort((a, b) => b.length - a.length) : null;
  const nKeys = numMap && numMap.size
    ? [...numMap.keys()].sort((a, b) => b.length - a.length) : null;
  // literă-punct: nelipită de litere mici (ca să nu atingem cuvinte)
  const lRe = lKeys ? new RegExp(`(?<![${RO_LOW}])(${lKeys.map(reEsc).join('|')})(?![${RO_LOW}])`, 'g') : null;
  // număr întreg: nelipit de alte cifre, virgule sau puncte, ca „4” din „4,5” sau
  // „1” din „12” să rămână în pace
  const nRe = nKeys ? new RegExp(`(?<![\\d.,])(${nKeys.map(reEsc).join('|')})(?![\\d.,])`, 'g') : null;
  if (!lRe && !nRe) return String(svg);
  return String(svg).replace(/(<text\b[^>]*>)([\s\S]*?)(<\/text\s*>)/gi, (t, o, body, c) => {
    const plain = body.replace(/<[^>]+>/g, '').trim();
    // eticheta e exact un nume de punct → o înlocuim întreagă
    if (letterMap && letterMap.has(plain)) return `${o}${letterMap.get(plain)}${c}`;
    let nb = body;
    if (lRe) nb = nb.replace(lRe, (mm) => letterMap.get(mm) ?? mm);
    if (nRe) nb = nb.replace(nRe, (mm) => numMap.get(mm) ?? mm);
    return nb === body ? t : `${o}${nb}${c}`;
  });
}

// Corespondențele declarate de model în marcaj: <!--FIG:4 A>M; B>N; 3 cm>5 cm-->
// Separatorul e „;”, pentru că numerele românești folosesc virgula la zecimale
// („4,5 cm”); dacă modelul a separat totuși cu virgule, le acceptăm la a doua
// încercare. Perechile de litere merg în harta punctelor, cele cu cifre în harta
// numerelor.
function parseDeclaredFig(extra) {
  const letters = new Map();
  const nums = new Map();
  const raw = String(extra || '').trim();
  if (!raw) return { letters, nums };
  let chunks = raw.split(';');
  if (chunks.length === 1 && (raw.match(/[>=→]/g) || []).length > 1) chunks = raw.split(',');
  for (const p of chunks) {
    const mm = p.trim().match(/^(.{1,16}?)\s*(?:->|=>|→|>|=)\s*(.{1,16}?)$/);
    if (!mm) continue;
    const a = mm[1].trim();
    const b = mm[2].trim();
    if (!a || !b || a === b) continue;
    if (/^[A-Za-zĂÂÎȘȚăâîșț]['’]?[0-9]?$/.test(a)) letters.set(a, b);
    else {
      // „3 cm>5 cm”: comparăm numerele, nu textul cu unitate
      const na = numberTokens(a);
      const nb = numberTokens(b);
      if (na.length === 1 && nb.length === 1 && na[0] !== nb[0]) nums.set(na[0], nb[0]);
    }
  }
  return { letters, nums };
}

// Reinserează figurile la marcaje, după generare.
// Notațiile ȘI valorile de pe desen urmează enunțul, în două feluri:
//  1. modelul le declară în marcaj: <!--FIG:4 A>M; B>N; 3 cm>5 cm-->;
//  2. altfel serverul deduce singur corespondențele, comparând enunțul original al
//     itemului cu enunțul nou — literele-punct pentru notații, numerele pentru
//     lungimi/unghiuri.
// Geometria desenului (linii, coordonate, proporții) rămâne în ambele cazuri
// neatinsă: se rescrie doar textul etichetelor.
function figRestore(html, figs) {
  let out = String(html || '');
  out = out.replace(/<!--\s*FIG:(\d+)([\s\S]{0,300}?)-->/g, (m, num, extra, offset, whole) => {
    const rec = (figs || [])[Number(num)];
    if (!rec) return '';
    const svg = typeof rec === 'string' ? rec : rec.svg;
    const declared = parseDeclaredFig(extra);
    // ce se poate deduce din enunțul nou, scris chiar înaintea marcajului
    const oldSt = typeof rec === 'string' ? '' : rec.statement;
    let dLetters = null;
    let dNums = null;
    if (oldSt) {
      const before = whole.slice(Math.max(0, offset - 1500), offset);
      const found = itemStatements(before);
      const newSt = found.length ? found[found.length - 1] : before.replace(/<[^>]+>/g, ' ').slice(-240);
      dLetters = labelMapFromStatements(oldSt, newSt, svg);
      dNums = numberMapFromStatements(oldSt, newSt, svg);
    }
    // declarația modelului COMPLETEAZĂ ce s-a dedus și are ultimul cuvânt, deci o
    // declarație parțială nu anulează restul schimbărilor din enunț
    const letterMap = new Map(dLetters || []);
    declared.letters.forEach((v, k) => letterMap.set(k, v));
    const numMap = new Map(dNums || []);
    declared.nums.forEach((v, k) => numMap.set(k, v));
    if (!letterMap.size && !numMap.size) return svg;
    return rewriteSvgText(svg, letterMap, numMap);
  });
  // marcaje rămase (numere inexistente / inventate de model) — le curățăm
  return out.replace(/<!--\s*FIG:[\s\S]{0,300}?-->/g, '');
}

// =====================================================================
// SPAȚIUL DE DESENARE al Subiectului III
// =====================================================================
// Problemele Subiectului III (rezolvare redactată) vin, în rubrică, fără desen:
// elevul trebuie să-și facă singur figura. Le dăm un spațiu de desenare cu
// FIGURA DE BAZĂ din datele problemei — un triunghi, un dreptunghi, un
// paralelipiped… — desenată NENOTATĂ (fără litere și fără valori), ca notațiile
// să le pună elevul, cu instrumentele de desen ale șablonului.
//
// Desenele NU vin de la model: forma se recunoaște din enunț (cuvinte-cheie) și
// se ia din biblioteca de mai jos, deci ies mereu curate și în același stil.
// Se injectează ca `<div class="fig">`, elementul pe care șablonul își leagă
// singur creionul/segmentul/radiera (vezi querySelectorAll('.fig') din șablon).

const SH_STROKE = 'fill="none" stroke="#0f2b44" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"';
// muchiile ascunse ale corpurilor geometrice: linie punctată, mai deschisă
const SH_HID = 'fill="none" stroke="#7b8794" stroke-width="1.6" stroke-dasharray="6 4"';
const sh = (w, h, solid, hidden = '') => `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><g ${SH_HID}>${hidden}</g><g ${SH_STROKE}>${solid}</g></svg>`;
// jumătățile unei elipse (bazele corpurilor rotunde): jos = vizibilă, sus = ascunsă
const elBot = (cx, cy, rx, ry) => `M${cx - rx},${cy} A${rx},${ry} 0 0 0 ${cx + rx},${cy}`;
const elTop = (cx, cy, rx, ry) => `M${cx - rx},${cy} A${rx},${ry} 0 0 1 ${cx + rx},${cy}`;
const elFull = (cx, cy, rx, ry) => `${elBot(cx, cy, rx, ry)} ${elTop(cx, cy, rx, ry)}`;
const dot = (x, y) => `<circle cx="${x}" cy="${y}" r="3.5" fill="#0f2b44" stroke="none"/>`;

// Corp cu două fețe paralele (cub, paralelipiped): fața din față, fața din spate
// deplasată cu (dx,-dy); muchiile care se întâlnesc în vârful din spate-jos-stânga
// sunt ascunse.
function shBox(x, y, w, h, dx, dy) {
  const X = x + dx;
  const Y = y - dy;
  const solid = [
    `<path d="M${x},${y} h${w} v${h} h${-w} Z"/>`,                   // fața din față
    `<path d="M${X},${Y} h${w} v${h}"/>`,                            // spate: sus + dreapta
    `<path d="M${x},${y} L${X},${Y}"/>`,                             // muchii de legătură
    `<path d="M${x + w},${y} L${X + w},${Y}"/>`,
    `<path d="M${x + w},${y + h} L${X + w},${Y + h}"/>`,
  ].join('');
  const hidden = [
    `<path d="M${X},${Y + h} h${w}"/>`,                              // spate-jos
    `<path d="M${X},${Y} v${h}"/>`,                                  // spate-stânga
    `<path d="M${x},${y + h} L${X},${Y + h}"/>`,                     // legătura ascunsă
  ].join('');
  return sh(420, 270, solid, hidden);
}

const SHAPES = {
  // vârful clar descentrat, ca să nu semene cu cel isoscel
  triunghi: () => sh(400, 240, '<path d="M95,195 L315,195 L155,50 Z"/>'),
  'triunghi-dreptunghic': () => sh(400, 240, '<path d="M115,195 L300,195 L115,55 Z"/><path d="M115,178 L132,178 L132,195" stroke-width="1.5"/>'),
  'triunghi-isoscel': () => sh(400, 240, '<path d="M115,195 L305,195 L210,48 Z"/>'),
  'triunghi-echilateral': () => sh(400, 240, '<path d="M115,195 L295,195 L205,39 Z"/>'),
  patrat: () => sh(400, 240, '<path d="M135,42 h156 v156 h-156 Z"/>'),
  dreptunghi: () => sh(400, 240, '<path d="M95,62 h220 v132 h-220 Z"/>'),
  paralelogram: () => sh(400, 240, '<path d="M100,192 L270,192 L315,58 L145,58 Z"/>'),
  romb: () => sh(400, 240, '<path d="M205,40 L310,120 L205,200 L100,120 Z"/>'),
  trapez: () => sh(400, 240, '<path d="M90,192 L320,192 L262,58 L150,58 Z"/>'),
  cerc: () => sh(400, 240, `<circle cx="200" cy="120" r="84"/>${dot(200, 120)}`),
  dreapta: () => sh(400, 150, `<path d="M45,75 L355,75"/>${dot(85, 75)}${dot(160, 75)}${dot(240, 75)}${dot(320, 75)}`),
  xOy: () => sh(400, 260, [
    '<path d="M40,200 L360,200"/><path d="M352,193 L360,200 L352,207"/>',
    '<path d="M110,240 L110,25"/><path d="M103,33 L110,25 L117,33"/>',
    [1, 2, 3, 4, 5, 6].map((k) => `<path d="M${110 + k * 38},196 v8" stroke-width="1.4"/>`).join(''),
    [1, 2, 3, 4].map((k) => `<path d="M106,${200 - k * 38} h8" stroke-width="1.4"/>`).join(''),
  ].join('')),
  cub: () => shBox(115, 100, 140, 140, 56, 46),
  paralelipiped: () => shBox(100, 118, 176, 112, 62, 52),
  prisma: () => sh(420, 270, [
    '<path d="M115,90 L295,90 L205,56 Z"/>',            // fața de sus, întreagă
    '<path d="M115,230 L295,230"/>',                     // muchia din față a bazei
    '<path d="M115,90 L115,230"/><path d="M295,90 L295,230"/>',
  ].join(''), '<path d="M115,230 L205,196 L295,230"/><path d="M205,56 L205,196"/>'),
  piramida: () => sh(420, 270, [
    '<path d="M225,42 L105,225 M225,42 L275,225 M225,42 L335,180"/>',
    '<path d="M105,225 L275,225 L335,180"/>',
  ].join(''), '<path d="M335,180 L165,180 L105,225"/><path d="M225,42 L165,180"/>'),
  con: () => sh(420, 270, `<path d="M210,45 L115,215 M210,45 L305,215"/><path d="${elBot(210, 215, 95, 28)}"/>`, `<path d="${elTop(210, 215, 95, 28)}"/>`),
  cilindru: () => sh(420, 270, `<path d="${elFull(210, 72, 85, 25)}"/><path d="M125,72 L125,212 M295,72 L295,212"/><path d="${elBot(210, 212, 85, 25)}"/>`, `<path d="${elTop(210, 212, 85, 25)}"/>`),
  sfera: () => sh(420, 270, `<circle cx="210" cy="135" r="95"/><path d="${elBot(210, 135, 95, 28)}"/>${dot(210, 135)}`, `<path d="${elTop(210, 135, 95, 28)}"/>`),
  'trunchi-con': () => sh(420, 270, `<path d="${elFull(210, 68, 52, 16)}"/><path d="M115,218 L158,68 M305,218 L262,68"/><path d="${elBot(210, 218, 95, 27)}"/>`, `<path d="${elTop(210, 218, 95, 27)}"/>`),
  'trunchi-piramida': () => sh(420, 270, [
    '<path d="M155,70 L265,70 L300,45 L190,45 Z"/>',
    '<path d="M105,225 L285,225 L340,185"/>',
    '<path d="M155,70 L105,225 M265,70 L285,225 M300,45 L340,185"/>',
  ].join(''), '<path d="M340,185 L160,185 L105,225"/><path d="M190,45 L160,185"/>'),
};

// Forma de bază, recunoscută din enunț. Ordinea contează: corpurile geometrice
// înaintea figurilor plane (un „paralelipiped dreptunghic" nu e un dreptunghi),
// iar „triunghi" înaintea lui „dreptunghi" („triunghi dreptunghic").
const SHAPE_RULES = [
  [/paralelipiped/, 'paralelipiped'],
  [/trunchi de (con|cilindru)|trunchi-con/, 'trunchi-con'],
  [/trunchi de piramid|trunchi-piramid/, 'trunchi-piramida'],
  [/\bcub(ul|uri|ului|ic)?\b/, 'cub'],
  [/prism/, 'prisma'],
  [/piramid/, 'piramida'],
  [/cilindr/, 'cilindru'],
  [/\bcon(ul|ului|uri)?\b|conic/, 'con'],
  [/sfer|glob/, 'sfera'],
  [/triunghi/, 'triunghi'],
  [/trapez/, 'trapez'],
  [/paralelogram/, 'paralelogram'],
  [/\bromb/, 'romb'],
  [/patrat/, 'patrat'],
  [/dreptunghi/, 'dreptunghi'],
  [/cerc|disc\b|circumferin|diametr|\braza\b/, 'cerc'],
  [/grafic|sistem de axe|axe de coordonate|reprezentarea grafica|f\s*\(\s*x\s*\)/, 'xOy'],
  [/coliniar|semidreapt|\bdreapta\b|segmentul/, 'dreapta'],
];

function detectShape(statement) {
  const t = deDia(statement).replace(/\s+/g, ' ');
  if (!t) return null;
  for (const [re, name] of SHAPE_RULES) {
    if (!re.test(t)) continue;
    if (name !== 'triunghi') return name;
    if (/echilateral/.test(t)) return 'triunghi-echilateral';
    if (/isoscel/.test(t)) return 'triunghi-isoscel';
    if (/dreptunghic|unghiul drept|ipotenuz|catet/.test(t)) return 'triunghi-dreptunghic';
    return 'triunghi';
  }
  return null; // problemă de algebră → fără spațiu de desenare
}

// Desenele de bază pentru itemii unui subiect, pe poziții (null unde enunțul nu
// descrie nicio figură — problemele de algebră rămân curate).
function baseShapesFor(items) {
  return (items || []).map((it) => {
    if (it.hasFig) return null; // itemul are deja desenul lui
    const name = detectShape(itemStatements(it.text)[0] || it.text || '');
    return name && SHAPES[name] ? SHAPES[name]() : null;
  });
}

// Scriptul care pune spațiile de desenare în itemii subiectului, la randare.
// Se inserează ÎNAINTE de blocul cu instrumentele de desen al șablonului, ca
// acestea să se lege singure și de figurile noi; itemii scriși din JavaScript
// (array-urile de exerciții) există deja în pagină în acel moment.
function drawSpaceScript(sec, shapes) {
  return `<script>
/* spațiile de desenare ale Subiectului ${sec} — figura de bază, nenotată */
(function(){
  try {
    var SH = ${JSON.stringify(shapes)};
    var secRe = /subiectul\\s*(${sec === 'III' ? 'iii|3' : sec === 'II' ? 'ii|2' : 'i|1'})\\b/i;
    var titles = [].slice.call(document.querySelectorAll('.sec-title, h2, h3'));
    var t = null, next = null;
    for (var i = 0; i < titles.length; i++) {
      if (t === null && secRe.test(titles[i].textContent || '')) { t = titles[i]; continue; }
      if (t !== null) { next = titles[i]; break; }
    }
    if (!t) return;
    function between(el) {
      var after = t.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING;
      var before = !next || (next.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_PRECEDING);
      return after && before;
    }
    function hasFig(c) {
      if (c.querySelector('.fig')) return true;
      var s = c.querySelectorAll('svg');
      for (var j = 0; j < s.length; j++) if (!s[j].closest('mjx-container, .MathJax, mjx-math')) return true;
      return false;
    }
    var cards = [].slice.call(document.querySelectorAll('.card, .item, .problema')).filter(between);
    cards.forEach(function(c, k) {
      if (!SH[k] || hasFig(c)) return;
      var host = c.querySelector('.qbody') || c.querySelector('.qtxt') || c;
      var d = document.createElement('div');
      d.className = 'fig';
      d.innerHTML = SH[k];
      if (host === c) host.appendChild(d); else host.appendChild(d);
    });
  } catch (e) { /* spațiul de desenare e un plus: dacă nu merge, testul rămâne întreg */ }
})();
</script>
`;
}

function injectDrawSpaces(html, sec, shapes) {
  if (!Array.isArray(shapes) || !shapes.some(Boolean)) return String(html || '');
  const s = String(html || '');
  const block = drawSpaceScript(sec, shapes);
  // exact înaintea scriptului care leagă instrumentele de desen
  const anchor = s.search(/querySelectorAll\(\s*['"]\.fig['"]\s*\)/);
  if (anchor !== -1) {
    const k = s.lastIndexOf('<script', anchor);
    if (k !== -1) return s.slice(0, k) + block + s.slice(k);
  }
  const b = s.lastIndexOf('</body>');
  return b === -1 ? s + block : s.slice(0, b) + block + s.slice(b);
}

// Sparge un test în ITEMI, grupați pe subiect.
function splitTestItems(html, figs) {
  const s = String(html || '');
  const marks = sectionMarks(s);
  const order = [];
  marks.forEach((k) => { if (!order.includes(k.sec)) order.push(k.sec); });
  const secOf = (pos) => {
    let v = order[0] || 'I';
    for (const k of marks) { if (k.at <= pos) v = k.sec; else break; }
    return v;
  };
  const buckets = {};
  const push = (sec, rec) => { (buckets[sec] = buckets[sec] || []).push(rec); };

  for (const c of extractCards(s)) {
    const f = pullFigures(c.html, figs);
    push(secOf(c.at), { form: 'card', text: f.text, hasFig: f.hasFig });
  }
  // Array-urile de itemi stau în <script>, la FINALUL fișierului — după toate
  // titlurile de secțiune — deci subiectul lor NU se poate lua din poziție: îl
  // luăm din cifra din nume (EX1 → primul subiect, EX2 → al doilea…).
  for (const a of extractArrayItems(s)) {
    const d = (a.name.match(/(\d+)\s*$/) || [])[1];
    const sec = (d && order[Number(d) - 1]) || secOf(a.at);
    a.items.forEach((o) => {
      const f = pullFigures(o, figs);
      push(sec, { form: 'obj', array: a.name, text: f.text, hasFig: f.hasFig });
    });
  }
  return { order, buckets };
}

// Rulează `fn` pe listă cu paralelism limitat (descărcările din Storage ale
// celor ~24 de teste ar dura prea mult una după alta).
async function mapLimit(list, limit, fn) {
  const arr = [...(list || [])];
  const out = [];
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, arr.length) }, async () => {
    for (;;) {
      const k = i++;
      if (k >= arr.length) return;
      try { out.push(await fn(arr[k])); } catch { /* element ignorat */ }
    }
  });
  await Promise.all(workers);
  return out.filter(Boolean);
}

// Banca de itemi a rubricii: fiecare test devine o listă de itemi pe subiecte.
// `excludeId` = testul folosit ca ȘABLON (itemii lui nu intră în bancă, ca
// rezultatul să nu semene cu el).
async function buildItemPool({ supa, rows, maxSources = 24, excludeId = null, allowFig = true, bodyCache = null }) {
  const figs = [];
  const picked = shuffle(rows).filter((r) => r.id !== excludeId).slice(0, maxSources);
  const perSource = await mapLimit(picked, 6, async (r) => {
    if (r.interactive_data?.exercise) {
      const qs = Array.isArray(r.interactive_data.exercise.questions) ? r.interactive_data.exercise.questions : [];
      if (qs.length < 2) return null;
      return { title: r.title, order: ['I'], buckets: { I: qs.map((q) => ({ form: 'json', text: JSON.stringify(q).slice(0, 2000), hasFig: false })) } };
    }
    // fișierele deja citite la alegerea șablonului nu se mai descarcă a doua oară
    let raw = bodyCache ? bodyCache.get(r.id) : null;
    if (raw == null) {
      const { buf } = await downloadStorage(supa, r.file_url);
      if (!buf) return null;
      raw = buf.toString('utf8');
      if (bodyCache) bodyCache.set(r.id, raw);
    }
    const sp = splitTestItems(raw, figs);
    const total = Object.values(sp.buckets).reduce((n, a) => n + a.length, 0);
    if (total < 2) return null;
    if (!allowFig) {
      // rubricile non-EN se generează fără desene: itemii cu figură ar rămâne
      // fără ea (stripFigures) și enunțul ar trimite la un desen inexistent
      Object.keys(sp.buckets).forEach((k) => { sp.buckets[k] = sp.buckets[k].filter((it) => !it.hasFig); });
    }
    return { title: r.title, order: sp.order, buckets: sp.buckets };
  });
  return { figs, perSource };
}

// Trage la sorți itemii unui subiect, POZIȚIE CU POZIȚIE: la Evaluare Națională
// poziția fixează TIPUL exercițiului (exercițiul 3 de la Subiectul II e mereu
// același tip de problemă în toate testele), deci exercițiul 3 al testului nou
// se ia dintre exercițiile 3 de la Subiectul II ale testelor-sursă — nu dintre
// toate exercițiile subiectului, cum se întâmpla înainte (de acolo veneau
// „tipurile amestecate”).
// Sursele se rotesc: fiecare poziție preferă un test care n-a mai fost folosit,
// deci cele 6 exerciții ale unui subiect vin din 6 teste diferite.
function drawItemsByPosition(perSource, sec, need) {
  const lists = shuffle(perSource
    .map((s) => ({ title: s.title, items: s.buckets[sec] || [] }))
    .filter((s) => s.items.length));
  const maxLen = lists.reduce((n, s) => Math.max(n, s.items.length), 0);
  const used = new Map(); // titlu → de câte ori a fost folosit testul
  const out = [];
  for (let p = 0; p < need; p++) {
    // sursele care au un exercițiu EXACT pe poziția p a subiectului
    let idx = p;
    let cand = lists.filter((s) => s.items[idx]);
    if (!cand.length && maxLen) {
      // niciun test-sursă nu are atâtea exerciții la subiectul ăsta → cea mai
      // apropiată poziție existentă (mai bine tipul vecin decât un item lipsă)
      idx = Math.min(p, maxLen - 1);
      cand = lists.filter((s) => s.items[idx]);
    }
    if (!cand.length) break;
    const min = cand.reduce((n, s) => Math.min(n, used.get(s.title) || 0), Infinity);
    const pick = shuffle(cand.filter((s) => (used.get(s.title) || 0) === min))[0];
    used.set(pick.title, (used.get(pick.title) || 0) + 1);
    out.push({ ...pick.items[idx], src: pick.title, pos: idx + 1 });
  }
  return out;
}

// Amprenta itemilor unui test: enunțurile, normalizate (din markup — .qtxt —
// și din array-urile JS — q:'…').
function itemStatements(html) {
  const s = String(html || '');
  const out = [];
  let m;
  const re1 = /<div[^>]*class=["'][^"']*\bqtxt\b[^"']*["'][^>]*>([\s\S]*?)<\/div>/gi;
  while ((m = re1.exec(s))) out.push(m[1]);
  const re2 = /[{,\s]["']?(?:q|statement|enunt|lead)["']?\s*:\s*(['"`])([\s\S]*?)\1/g;
  while ((m = re2.exec(s))) out.push(m[2]);
  return out
    .map((t) => String(t).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim())
    .filter((t) => t.length >= 25);
}

// ─── GARDA ANTI-„ACELAȘI TEST" ───────────────────────────────────────────────
// Cu banca de itemi, TOȚI itemii rezultatului vin din ALTE teste ale rubricii,
// cu numere și notații schimbate — deci un enunț identic caracter cu caracter
// cu unul din șablon înseamnă că modelul a copiat itemul șablonului. Cazul cel
// mai perfid: blocul <script> cu array-ul itemilor lăsat ca marcaj gol
// <script data-tpl="N"></script>, pe care serverul îl reinserează cu itemii
// VECHI — testul părea generat, dar era copia celui existent.
// `bankText` = itemii trimiși modelului: un enunț care vine din BANCĂ e
// legitim chiar dacă e identic cu unul din șablon (rubrica are teste asemănătoare
// și modelul poate să nu fi schimbat numerele) — se numără doar enunțurile care
// există DOAR în șablon.
function assertRenewedItems({ html, template, bankText = '', what = 'Testul generat' }) {
  const bankSt = new Set(itemStatements(bankText));
  const tplSt = itemStatements(template).filter((t) => !bankSt.has(t));
  if (tplSt.length < 4) return; // prea puține enunțuri recunoscute — nu judecăm
  const outSt = new Set(itemStatements(html));
  const kept = tplSt.filter((t) => outSt.has(t));
  const limit = Math.max(2, Math.floor(tplSt.length / 3));
  if (kept.length > limit) {
    throw httpErr(502, `${what}: ${kept.length} din ${tplSt.length} exerciții au rămas IDENTICE cu cele ale șablonului („${kept[0].slice(0, 70)}…”) — ar fi o copie a testului existent, așa că nu îl public. Mai încearcă.`);
  }
}

// Cheile grilei, așa cum apar în rezultat: data-correct="c" (markup) și ok:'c'
// (array-urile JS).
function answerKeys(html) {
  const s = String(html || '');
  const out = [];
  let m;
  const re1 = /data-correct\s*=\s*["']([a-d])["']/gi;
  while ((m = re1.exec(s))) out.push(m[1].toLowerCase());
  const re2 = /[{,\s]["']?ok["']?\s*:\s*["']([a-d])["']/gi;
  while ((m = re2.exec(s))) out.push(m[1].toLowerCase());
  return out;
}

// Cererea adminului: răspunsul corect nu trebuie să cadă mereu la a). Dacă TOATE
// cheile testului sunt pe aceeași literă, modelul a ignorat regula — eroare, ca
// rularea să se reia, în loc să publicăm un test în care se ghicește din prima.
function assertAnswerSpread({ html, what = 'Testul generat' }) {
  const keys = answerKeys(html);
  if (keys.length < 6) return;
  const uniq = [...new Set(keys)];
  if (uniq.length === 1) {
    throw httpErr(502, `${what}: la toți cei ${keys.length} itemi de grilă răspunsul corect e la „${uniq[0]})” — trebuie distribuit între a), b), c) și d). Nu îl public; mai încearcă.`);
  }
}

// Eticheta rubricii pentru titlul testului generat
const CAT_LABELS = { 'evaluare-nationala': 'Evaluare Națională', bacalaureat: 'Bacalaureat' };
const catLabel = (c) => CAT_LABELS[String(c || '')] || String(c || '').replace(/[-_]+/g, ' ').trim();

// ─── AUTOMATIZAREA pe rubrică (mutată din ai-exercise-agent.js, acțiunea
// „auto") — combină teste existente din rubrică într-un test NOU.
// Rubrici INTERACTIVE → FORMATUL STANDARD (HTML cu figuri + desen), sau
// „exam" → subiect structurat (JSON). Rubrici PDF → test structurat (JSON),
// sau „interactive" → FORMATUL STANDARD. `aiModel` = ID-ul Claude ales
// (opțional; validat în claude.resolveModel — necunoscut → implicitul).
// NOU: `extraRubrics` = rubrici-referință suplimentare (ex. bareme);
// `resultKind='format'` + formatHtml/formatPdf = MODELUL DE FORMAT al
// adminului: HTML → rezultatul CLONEAZĂ exact fișierul (design+funcții),
// PDF → structura testului structurat se potrivește cu el.
// Adună usage-ul tuturor apelurilor; apelantul face ai.logUsage.
async function runAuto({ supa, category, subcategory = null, profile = null, ctype = 'interactive', instructions: autoInstr = '', resultKind = 'auto', dataMode = 'modify', aiModel = null, extraRubrics = [], formatHtml = null, formatPdf = null, seqDone = [] }) {
  if (!category) throw httpErr(400, 'Alege rubrica (categoria).');
  if (resultKind === 'format' && !formatHtml && !formatPdf) {
    throw httpErr(400, 'Task-ul cere rezultat „după modelul de format", dar modelul de format lipsește — încarcă un fișier HTML sau PDF în setările task-ului.');
  }
  const wantFormatHtml = resultKind === 'format' && !!formatHtml; // clonare exactă a șablonului încărcat
  const wantFormatPdf = resultKind === 'format' && !formatHtml && !!formatPdf; // structură după PDF

  // Modul de lucru, dedus din instrucțiuni: „pe rând" / combinare (implicit),
  // + corespondența test↔barem când contextul suplimentar o permite.
  const mode = detectMode(autoInstr, extraRubrics);
  const hasExtras = Array.isArray(extraRubrics) && extraRubrics.length > 0;
  // figurile geometrice: DOAR la Evaluare Națională (cererea adminului)
  const allowFig = figuresAllowed(category);

  let q = supa.from('content')
    .select('id, title, file_url, interactive_data, subcategory, content_type')
    .eq('content_type', ctype).eq('category', category);
  if (subcategory && String(subcategory).includes('+')) q = q.in('subcategory', String(subcategory).split('+'));
  else if (subcategory) q = q.eq('subcategory', subcategory);
  if (profile) q = q.eq('profile', profile); // separă strict profilurile BAC
  const { data: rows } = await q.order('created_at', { ascending: true }).limit(200);
  if (!rows || !rows.length) throw httpErr(400, 'Rubrica nu are materiale de tipul ales.');
  if (!mode.sequential && rows.length < 2) throw httpErr(400, 'Rubrica are prea puține materiale (minim 2) pentru combinare.');

  const shuffled = shuffle(rows); // permutare uniformă (vezi shuffle)

  // Contextul suplimentar pentru sursele date: la modul „pair" întâi caută
  // BAREMELE CORESPONDENTE (după titlu); dacă nu găsește nimic — sau modul e
  // simplu — cade pe referințele alese la întâmplare din rubricile extra.
  async function ctxFor(srcTitles) {
    if (!hasExtras) return { docBlocks: [], textBlock: '', names: [], line: '' };
    if (mode.pair) {
      const paired = await fetchPairedContext(supa, extraRubrics, srcTitles);
      if (paired.names.length) return paired;
    }
    const e = await fetchExtraContext(supa, extraRubrics);
    return { ...e, line: extraLine(e.names) };
  }

  // ── MOD „PE RÂND": fiecare rulare ia URMĂTORUL fișier neprelucrat din
  // rubrică și îl transformă singur într-un test/exercițiu interactiv nou.
  // Progresul (ce fișiere s-au procesat) vine din task.seq_done (seqDone).
  if (mode.sequential) {
    const doneSet = new Set(Array.isArray(seqDone) ? seqDone : []);
    // Luăm PRIMUL fișier neprelucrat pe care chiar îl putem CITI: dacă un material
    // nu mai poate fi descărcat (șters din Storage, cheie stricată după o mutare
    // gratuit↔premium, prea mare), îl SĂRIM și trecem la următorul. Înainte, un
    // singur fișier ilizibil oprea task-ul la FIECARE rulare, la nesfârșit —
    // progresul „pe rând" rămânea blocat și rularea se termina zilnic cu eroare.
    // Fișierele sărite se întorc în `skippedSources`: runTask le bifează ca
    // procesate și scrie motivul în istoric (se reiau cu ↺ după reîncărcare).
    const skippedSources = [];
    let src = null;
    let srcPdf = null;   // PDF → bloc nativ pentru model
    let srcHtml = null;  // HTML brut (exercițiu interactiv)
    let srcText = null;  // JSON-ul exercițiului (interactive_data)
    for (const cand of rows) {
      if (doneSet.has(cand.id)) continue;
      if (cand.content_type === 'pdf') {
        const { buf, reason } = await downloadStorage(supa, cand.file_url);
        if (!buf) { skippedSources.push({ id: cand.id, title: cand.title, reason }); continue; }
        if (buf.length > 3 * 1024 * 1024) { skippedSources.push({ id: cand.id, title: cand.title, reason: 'prea mare (max ~3 MB)' }); continue; }
        srcPdf = buf.toString('base64');
      } else if (cand.interactive_data?.exercise) {
        srcText = JSON.stringify(cand.interactive_data.exercise).slice(0, 20000);
      } else {
        const { buf, reason } = await downloadStorage(supa, cand.file_url);
        if (!buf) { skippedSources.push({ id: cand.id, title: cand.title, reason }); continue; }
        // plafon mărit: la 160k se tăia uneori chiar array-ul de itemi de la
        // finalul fișierelor mari — modelul primea carcasa fără exerciții
        srcHtml = buf.toString('utf8').slice(0, 320000);
      }
      src = cand;
      break;
    }
    if (!src) {
      return {
        skipped: true,
        skippedSources,
        reason: skippedSources.length
          ? `Nu am putut citi din Storage ${skippedSources.length} fișier(e) rămase din rubrică: ${skippedSources.map((x) => `„${x.title}” (${x.reason})`).join('; ')}. Reîncarcă-le în rubrică, apoi resetează progresul (↺) din panoul task-ului.`
          : 'Toate fișierele din rubrică au fost deja procesate de acest task. Adaugă materiale noi în rubrică sau resetează progresul (↺) din panoul task-ului.',
      };
    }
    const ctx = await ctxFor([src.title]);

    // (a) sursă HTML fără model de format → CLONĂM chiar fișierul-sursă:
    // același design și funcționalitate, conținutul ajustat după dataMode.
    if (srcHtml && !wantFormatHtml) {
      const sysSeq = `Ești agentul de creare de exerciții al platformei ExamenMate (matematică, românește).
Primești UN SINGUR fișier HTML sursă (un test/exercițiu interactiv al rubricii „${category}${subcategory ? ' / ' + subcategory : ''}”). Sarcina: produci un fișier HTML NOU, COMPLET și AUTONOM, pornind de la acest fișier — VARIANTA lui nouă.
Reguli stricte:
- COPIAZĂ ÎNTOCMAI tot ce nu ține de conținutul exercițiilor: CSS-ul complet, TOT JavaScript-ul, instrumentele (desen, creion, radieră etc.), structura și bara de scor — NIMIC eliminat sau simplificat;
${allowFig
    ? '- FIGURILE/DESENELE (SVG, canvas, imagini) NU SE MODIFICĂ DELOC (vor fi restaurate programatic din sursă, deci modificarea lor e inutilă și greșită); itemii cu figură rămân consistenți cu figura;'
    : NO_FIG_RULE.slice(1) + ' Itemii care în sursă aveau figură se REFORMULEAZĂ cu toate datele în enunț (sau se înlocuiesc cu itemi echivalenți fără figură);'}
- REGIM DE LUCRU CU DATELE: ${modeLine(dataMode)}
- păstrează (sau adaugă, dacă lipsește) raportarea scorului: parent.postMessage({type:'MATE_SCORE', score: <procent 0-100>, maxScore: 100}, '*');
- răspunsurile corecte trebuie să fie corecte matematic; verifică-ți calculele.${TPL_RULE}${COMPLETE_RULE_HTML}${MATH_RULE}${ctx.line}
Răspunde DOAR cu documentul HTML complet (de la <!doctype html> la </html>), fără explicații, fără markdown.`;
      const tplSeqA = tplAnnotate(srcHtml);
      const blocksS = [];
      blocksS.push(...ctx.docBlocks);
      blocksS.push({ type: 'text', text: `FIȘIERUL-SURSĂ („${src.title}”, cu blocurile <style>/<script> numerotate <!--TPL:N-->):\n${tplSeqA.annotated}${ctx.textBlock}\n\nProdu ACUM varianta nouă — doar documentul HTML. REAMINTIRE FINALĂ (economie de tokeni): blocurile <style>/<script> pe care NU le modifici = DOAR marcajele goale <style data-tpl=\"N\"></style> / <script data-tpl=\"N\"></script> — nu le rescrie; blocul cu DATELE itemilor se scrie complet.${String(autoInstr || '').trim() ? ` INSTRUCȚIUNILE ADMINULUI (prioritare${allowFig ? ', dar desenele tot NU se modifică' : ', dar tot FĂRĂ figuri'}): ${String(autoInstr).slice(0, 3000)}` : ''} Sesiune #${Math.random().toString(36).slice(2, 8)}.` });
      const rS = await chatClaudeLong({ system: sysSeq, blocks: blocksS, maxTokens: 30000, model: aiModel, until: (t) => /<\/html>/i.test(t) });
      let hS = cutHtml(rS.text);
      if (hS) hS = tplRestore(hS, tplSeqA.blocks);
      if (hS && allowFig) {
        const srcSvgs = srcHtml.match(/<svg[\s\S]*?<\/svg>/gi) || [];
        if (srcSvgs.length) { let k = 0; hS = hS.replace(/<svg[\s\S]*?<\/svg>/gi, (m) => (k < srcSvgs.length ? srcSvgs[k++] : m)); }
      }
      if (hS && !allowFig) hS = stripFigures(hS);
      try {
        assertCompleteHtml({ html: hS, baseline: srcHtml, what: `Varianta fișierului „${src.title}”` });
      } catch (e) {
        e.message += ` [stop=${rS.stopReason || '?'}, continuări=${rS.continuations || 0}${rS.viaUserMode ? ', fără prefill' : ''}${rS.strictRetry ? ', re-cerere strictă' : ''}, lungime=${rS.textLength ?? '?'}]`;
        console.error('exgen(seq-html): invalid. stopReason=%s continuations=%s', rS.stopReason, rS.continuations);
        throw e;
      }
      return { html: hS, provider: rS.provider, combinedFrom: [src.title, ...ctx.names], usage: rS.usage, sourceId: src.id, sourceTitle: src.title, skippedSources, template: src.title };
    }

    // (b) model de format HTML → clonăm MODELUL DE FORMAT, cu exercițiile
    // preluate/adaptate din fișierul-sursă curent.
    if (wantFormatHtml) {
      const sysSeqF = `Ești agentul de creare de exerciții al platformei ExamenMate (matematică, românește).
Primești un ȘABLON HTML — MODELUL DE FORMAT ales de admin — și UN SINGUR material-sursă („${src.title}”, din rubrica „${category}${subcategory ? ' / ' + subcategory : ''}”).
Construiește un fișier HTML NOU în ACELAȘI fișier-format ca șablonul, cu exercițiile preluate/adaptate din materialul-sursă.
Reguli: COPIAZĂ întocmai tot ce nu ține de conținutul itemilor (CSS, JavaScript, instrumente, bara de scor); ${allowFig ? 'FIGURILE din șablon NU se modifică; ' : NO_FIG_RULE.slice(3) + ' '}raportarea scorului MATE_SCORE se păstrează (sau se adaugă: parent.postMessage({type:'MATE_SCORE', score: <procent 0-100>, maxScore: 100}, '*')). REGIM DE LUCRU CU DATELE: ${modeLine(dataMode)}${TPL_RULE}${COMPLETE_RULE_HTML}${MATH_RULE}${ctx.line}
Răspunde DOAR cu documentul HTML complet (<!doctype html> … </html>).`;
      const tplF = String(formatHtml).slice(0, 180000);
      const tplFA = tplAnnotate(tplF);
      const blocksF = [];
      if (srcPdf) {
        blocksF.push({ type: 'text', text: `MATERIALUL-SURSĂ (PDF): ${src.title}` });
        blocksF.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: srcPdf } });
      }
      blocksF.push(...ctx.docBlocks);
      blocksF.push({ type: 'text', text: `ȘABLONUL (modelul de format, cu blocurile <style>/<script> numerotate <!--TPL:N-->):\n${tplFA.annotated}${srcText ? `\n\nMATERIALUL-SURSĂ („${src.title}”):\n${srcText}` : ''}${srcHtml ? `\n\nMATERIALUL-SURSĂ („${src.title}”, HTML):\n${srcHtml.slice(0, 60000)}` : ''}${ctx.textBlock}\n\nConstruiește acum fișierul. REAMINTIRE FINALĂ (economie de tokeni): blocurile <style>/<script> pe care NU le modifici = DOAR marcajele goale <style data-tpl=\"N\"></style> / <script data-tpl=\"N\"></script> — nu le rescrie; blocul cu DATELE itemilor se scrie complet.${String(autoInstr || '').trim() ? ` INSTRUCȚIUNILE ADMINULUI (prioritare): ${String(autoInstr).slice(0, 3000)}` : ''} Sesiune #${Math.random().toString(36).slice(2, 8)}.` });
      const rF = await chatClaudeLong({ system: sysSeqF, blocks: blocksF, maxTokens: 30000, model: aiModel, until: (t) => /<\/html>/i.test(t) });
      let hF = cutHtml(rF.text);
      if (hF) hF = tplRestore(hF, tplFA.blocks);
      if (hF && allowFig) {
        const tplSvgsF = tplF.match(/<svg[\s\S]*?<\/svg>/gi) || [];
        if (tplSvgsF.length) { let k = 0; hF = hF.replace(/<svg[\s\S]*?<\/svg>/gi, (m) => (k < tplSvgsF.length ? tplSvgsF[k++] : m)); }
      }
      if (hF && !allowFig) hF = stripFigures(hF);
      try {
        assertCompleteHtml({ html: hF, baseline: `${tplF}\n${srcHtml || ''}\n${srcText || ''}`, what: `Fișierul din „${src.title}” în modelul de format` });
      } catch (e) {
        e.message += ` [stop=${rF.stopReason || '?'}, continuări=${rF.continuations || 0}${rF.viaUserMode ? ', fără prefill' : ''}${rF.strictRetry ? ', re-cerere strictă' : ''}, lungime=${rF.textLength ?? '?'}]`;
        console.error('exgen(seq-format): invalid. stopReason=%s continuations=%s', rF.stopReason, rF.continuations);
        throw e;
      }
      return { html: hF, provider: rF.provider, combinedFrom: [src.title, ...ctx.names], usage: rF.usage, sourceId: src.id, sourceTitle: src.title, skippedSources, template: 'modelul de format al task-ului' };
    }

    // (c) sursă PDF sau exercițiu JSON → test interactiv STRUCTURAT (JSON),
    // transformarea întregului fișier-sursă (opțional după modelul de format PDF).
    const sysSeqJ = `Ești agentul de creare de exerciții al platformei ExamenMate (matematică, românește).
Primești UN SINGUR material-sursă („${src.title}”, din rubrica „${category}${subcategory ? ' / ' + subcategory : ''}”). Transformă-l ÎNTREG într-un test/exercițiu INTERACTIV NOU: păstrează numărul de itemi, ordinea, structura și baremul materialului-sursă.${COMPLETE_RULE_JSON}
Rezultatul NU are figuri: enunțurile se scriu SELF-CONTAINED, cu toate datele în text — nicio referire la „figura alăturată/de mai jos”.
REGIM DE LUCRU CU DATELE: ${modeLine(dataMode)}${wantFormatPdf ? '\nPrimești și MODELUL DE FORMAT (PDF): potrivește STRUCTURA rezultatului (itemi, secțiuni, barem) cu el, iar CONȚINUTUL cu materialul-sursă.' : ''}${ctx.line}
Răspunde STRICT cu UN obiect JSON valid (fără alt text):
{ "title": "…", "kind": "grila", "output": null, "statement": "", "questions": [ { "statement": "…", "options": ["A","B","C","D"], "answer_index": 0, "answer_text": null, "hint": "…", "explanation": "…", "points": 5 } ], "steps": null, "final_answer": null }
Itemii cu răspuns liber: "options" null, "answer_index" null, "answer_text" = răspunsul. LaTeX între $...$ cu backslash dublu — DOAR expresii/simboluri, NICIODATĂ propoziții sau cuvinte românești în $...$ (textul rămâne în afară; gradele: $70^\\circ$). Indiciile („hint”) ghidează fără să dea răspunsul; „explanation” = rezolvarea completă. Verifică-ți calculele.`;
    const blocksJ = [];
    if (srcPdf) {
      blocksJ.push({ type: 'text', text: `MATERIALUL-SURSĂ (PDF): ${src.title}` });
      blocksJ.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: srcPdf } });
    }
    if (wantFormatPdf) {
      blocksJ.push({ type: 'text', text: 'MODELUL DE FORMAT (PDF) — structura rezultatului se potrivește cu el:' });
      blocksJ.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: String(formatPdf) } });
    }
    blocksJ.push(...ctx.docBlocks);
    blocksJ.push({ type: 'text', text: `${srcText ? `MATERIALUL-SURSĂ („${src.title}”):\n${srcText}\n\n` : ''}${ctx.textBlock ? ctx.textBlock + '\n\n' : ''}Transformă acum materialul-sursă în test interactiv.${String(autoInstr || '').trim() ? ` INSTRUCȚIUNILE ADMINULUI (prioritare): ${String(autoInstr).slice(0, 3000)}` : ''} Sesiune #${Math.random().toString(36).slice(2, 8)}.` });
    const rJ = await chatClaudeLong({ system: sysSeqJ, blocks: blocksJ, maxTokens: 16000, model: aiModel, schema: EXERCISE_SCHEMA });
    const exJ = parseExercise(rJ);
    if (!exJ) {
      console.error('exgen(seq-json): invalid. stopReason=%s continuations=%s', rJ.stopReason, rJ.continuations);
      throw httpErr(502, `Nu am obținut un test valid din „${src.title}”. Mai încearcă.`);
    }
    exJ.title = exJ.title || `${src.title} · interactiv`;
    return { exercise: exJ, provider: rJ.provider, combinedFrom: [src.title, ...ctx.names], usage: rJ.usage, sourceId: src.id, sourceTitle: src.title, skippedSources };
  }

  // ── Rubrici PDF (exerciții / teste / bareme) ──
  if (ctype === 'pdf') {
    const blocksA = [];
    const names = [];
    for (const r of shuffled) {
      if (names.length >= 3) break;
      try {
        const { buf } = await downloadStorage(supa, r.file_url);
        if (!buf) continue;
        if (buf.length > 2.5 * 1024 * 1024) continue;
        blocksA.push({ type: 'text', text: `TESTUL ${String.fromCharCode(65 + names.length)}: ${r.title}` });
        blocksA.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: buf.toString('base64') } });
        names.push(r.title);
      } catch { /* sursă ignorată */ }
    }
    if (names.length < 2) throw httpErr(400, 'Nu am putut folosi suficiente PDF-uri din rubrică (fiecare max ~2,5 MB).');
    const ctx = await ctxFor(names); // bareme corespondente (pair) sau referințe la întâmplare

    // ── rezultat INTERACTIV cu exerciții din PDF-uri: în FORMATUL STANDARD
    // sau, la result_kind='format' cu HTML, în MODELUL DE FORMAT al adminului ──
    if (resultKind === 'interactive' || wantFormatHtml) {
      let tpl = null;
      let tplName = 'șablonul standard';
      let tplDesc = `ȘABLONUL HTML STANDARD al site-ului (test interactiv ${figuresAllowed(category) ? 'cu figuri și instrumente de desen' : 'cu instrumente de desen, FĂRĂ figuri'})`;
      if (wantFormatHtml) {
        tpl = String(formatHtml).slice(0, 180000);
        tplName = 'modelul de format al task-ului';
        tplDesc = 'ȘABLONUL HTML — MODELUL DE FORMAT ales de admin (clonează-i EXACT designul, stilul și funcționalitatea)';
      } else {
        try { tpl = fs.readFileSync(path.join(__dirname, 'template-standard.html'), 'utf8').slice(0, 120000); } catch { /* n/a */ }
      }
      if (!tpl) throw httpErr(500, 'Șablonul standard lipsește.');
      const lettersD = names.map((_, i) => String.fromCharCode(65 + i)).sort(() => Math.random() - 0.5);
      const planD = Array.from({ length: 8 }, (_, i) => `- Itemul ${i + 1}${allowFig ? ' (dacă nu are figură)' : ''} ← TESTUL ${lettersD[i % lettersD.length]}, un exercițiu ales aleatoriu.`).join('\n');
      const sysD = `Ești agentul de creare de exerciții al platformei ExamenMate (matematică, românește).
Primești ${tplDesc} și ${names.length} subiecte PDF din rubrica „${category}${subcategory ? ' / ' + subcategory : ''}”.
Construiește un TEST INTERACTIV NOU în ACELAȘI fișier-format ca șablonul, cu exercițiile preluate din PDF-uri după plan:
${planD}
Reguli: COPIAZĂ întocmai tot ce nu ține de conținutul itemilor (CSS, JavaScript, instrumente de desen, bara de scor, raportarea scorului MATE_SCORE — dacă șablonul nu o are, ADAUG-O: parent.postMessage({type:'MATE_SCORE', score: <procent 0-100>, maxScore: 100}, '*')). ${allowFig ? 'FIGURILE din șablon NU se modifică deloc; itemii cu figură rămân ai șablonului. ' : NO_FIG_RULE.slice(3) + ' '}REGIM DE LUCRU CU DATELE: ${modeLine(dataMode)}${TPL_RULE}${COMPLETE_RULE_HTML}${MATH_RULE}${ctx.line}
Răspunde DOAR cu documentul HTML complet (<!doctype html> … </html>).`;
      const tplDA = tplAnnotate(tpl);
      blocksA.push(...ctx.docBlocks);
      blocksA.push({ type: 'text', text: `ȘABLONUL (${tplName}, cu blocurile <style>/<script> numerotate <!--TPL:N-->):\n${tplDA.annotated}${ctx.textBlock}\n\nConstruiește acum testul interactiv. REAMINTIRE FINALĂ (economie de tokeni): blocurile <style>/<script> pe care NU le modifici = DOAR marcajele goale <style data-tpl=\"N\"></style> / <script data-tpl=\"N\"></script> — nu le rescrie; blocul cu DATELE itemilor se scrie complet.${String(autoInstr || '').trim() ? ` INSTRUCȚIUNILE ADMINULUI (prioritare${allowFig ? '' : ', dar tot FĂRĂ figuri'}): ${String(autoInstr).slice(0, 3000)}` : ''} Sesiune #${Math.random().toString(36).slice(2, 8)}.` });
      const rD = await chatClaudeLong({ system: sysD, blocks: blocksA, maxTokens: 30000, model: aiModel, until: (t) => /<\/html>/i.test(t) });
      let hOut = cutHtml(rD.text);
      if (hOut) hOut = tplRestore(hOut, tplDA.blocks);
      if (hOut && allowFig) {
        const tplSvgsD = tpl.match(/<svg[\s\S]*?<\/svg>/gi) || [];
        if (tplSvgsD.length) { let k = 0; hOut = hOut.replace(/<svg[\s\S]*?<\/svg>/gi, (m) => (k < tplSvgsD.length ? tplSvgsD[k++] : m)); }
      }
      if (hOut && !allowFig) hOut = stripFigures(hOut);
      try {
        assertCompleteHtml({ html: hOut, baseline: tpl, what: 'Testul interactiv din PDF-uri' });
      } catch (e) {
        e.message += ` [stop=${rD.stopReason || '?'}, continuări=${rD.continuations || 0}${rD.viaUserMode ? ', fără prefill' : ''}${rD.strictRetry ? ', re-cerere strictă' : ''}, lungime=${rD.textLength ?? '?'}]`;
        console.error('exgen(auto-pdf-interactiv): invalid. stopReason=%s continuations=%s', rD.stopReason, rD.continuations);
        throw e;
      }
      return { html: hOut, provider: rD.provider, combinedFrom: names, template: tplName, usage: rD.usage };
    }

    const lettersP = names.map((_, i) => String.fromCharCode(65 + i)).sort(() => Math.random() - 0.5);
    const planP = Array.from({ length: 10 }, (_, i) => `- Itemul ${i + 1} ← TESTUL ${lettersP[i % lettersP.length]}, itemul nr. ${1 + Math.floor(Math.random() * 5)} din el (sau alt item al aceluiași test).`).join('\n');
    const sysPdf = `Ești agentul de creare de exerciții al platformei ExamenMate (matematică, românește).
Primești ${names.length} teste PDF existente din rubrica „${category}${subcategory ? ' / ' + subcategory : ''}”.
Construiește URMĂTORUL test al rubricii (nr. ${rows.length + 1}) prin COMBINARE, după PLANUL DE MAI JOS (tras la sorți pe server — respectă-l întocmai, ca generările succesive să fie DIFERITE):
${planP}
Pentru fiecare poziție: COPIAZĂ itemul indicat (enunț, tip, structură). REGIM DE LUCRU CU DATELE: ${modeLine(dataMode)} Păstrează structura și baremul tipic rubricii.${COMPLETE_RULE_JSON}
Rezultatul NU are figuri: enunțurile se scriu SELF-CONTAINED, cu toate datele în text — nicio referire la „figura alăturată”; itemii-sursă care depind de o figură se înlocuiesc cu alți itemi din același test.${wantFormatPdf ? '\nPrimești și MODELUL DE FORMAT (PDF): potrivește STRUCTURA testului generat cu el — numărul de itemi, împărțirea pe secțiuni/subiecte, tipul itemilor (grilă/răspuns liber) și proporțiile baremului vin din modelul de format, iar CONȚINUTUL din testele-sursă.' : ''}${ctx.line}
Răspunde STRICT cu UN obiect JSON valid (fără alt text):
{ "title": "…", "kind": "grila", "output": null, "statement": "", "questions": [ { "statement": "…", "options": ["A","B","C","D"], "answer_index": 0, "answer_text": null, "hint": "…", "explanation": "…", "points": 5 } ], "steps": null, "final_answer": null }
Itemii cu răspuns liber: "options" null, "answer_index" null, "answer_text" = răspunsul. LaTeX între $...$ cu backslash dublu — DOAR expresii/simboluri, NICIODATĂ propoziții sau cuvinte românești în $...$ (textul rămâne în afară; gradele: $70^\\circ$). Verifică-ți calculele.`;
    if (wantFormatPdf) {
      blocksA.push({ type: 'text', text: 'MODELUL DE FORMAT (PDF) — structura rezultatului se potrivește cu el:' });
      blocksA.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: String(formatPdf) } });
    }
    blocksA.push(...ctx.docBlocks);
    blocksA.push({ type: 'text', text: `${ctx.textBlock ? ctx.textBlock + '\n\n' : ''}Construiește acum testul nr. ${rows.length + 1}.${String(autoInstr || '').trim() ? ` INSTRUCȚIUNILE ADMINULUI (prioritare): ${String(autoInstr).slice(0, 3000)}` : ''} Sesiune #${Math.random().toString(36).slice(2, 8)}.` });
    const rP = await chatClaudeLong({ system: sysPdf, blocks: blocksA, maxTokens: 12000, model: aiModel, schema: EXERCISE_SCHEMA });
    const exP = parseExercise(rP);
    if (!exP || (exP.questions || []).length < 6) {
      console.error('exgen(auto-pdf): invalid/incomplet (%s itemi). stopReason=%s continuations=%s', exP ? (exP.questions || []).length : 0, rP.stopReason, rP.continuations);
      throw httpErr(502, exP
        ? `Testul generat din PDF-uri a ieșit INCOMPLET (doar ${(exP.questions || []).length} itemi din 10) — nu îl public. Mai încearcă.`
        : 'Automatizarea nu a produs un test valid din PDF-uri. Mai încearcă o dată.');
    }
    exP.title = exP.title || `Test ${rows.length + 1} · ${category}${subcategory ? ' / ' + subcategory : ''}`;
    exP.output = 'pdf';
    return { exercise: exP, provider: rP.provider, combinedFrom: names, usage: rP.usage };
  }

  // ── rubrici interactive → SUBIECT structurat: la „exam" sau la modelul
  // de format PDF (structura testului se potrivește cu PDF-ul încărcat) ──
  if (ctype === 'interactive' && (resultKind === 'exam' || wantFormatPdf)) {
    const srcTexts = [];
    for (const r of shuffled) {
      if (srcTexts.length >= 5) break;
      try {
        if (r.interactive_data?.exercise) { srcTexts.push({ title: r.title, text: JSON.stringify(r.interactive_data.exercise).slice(0, 5000) }); continue; }
        const { buf } = await downloadStorage(supa, r.file_url);
        if (!buf) continue;
        const raw = buf.toString('utf8');
        const t = raw.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
        if (t.length > 200) srcTexts.push({ title: r.title, text: t.slice(0, 5000) });
      } catch { /* ignorată */ }
    }
    if (srcTexts.length < 2) throw httpErr(400, 'Prea puține surse utilizabile în rubrică.');
    const ctx = await ctxFor(srcTexts.map((x) => x.title)); // bareme corespondente sau referințe
    const lettersE = srcTexts.map((_, i) => String.fromCharCode(65 + i)).sort(() => Math.random() - 0.5);
    const planE = Array.from({ length: 10 }, (_, i) => `- Itemul ${i + 1} ← TESTUL ${lettersE[i % lettersE.length]}, un exercițiu ales aleatoriu.`).join('\n');
    const sysE = `Ești agentul de creare de exerciții al platformei ExamenMate (matematică, românește).
Primești ${srcTexts.length} teste din rubrica „${category}${subcategory ? ' / ' + subcategory : ''}”. Construiește un SUBIECT DE EXAMEN NOU prin combinare, după plan:
${planE}
REGIM DE LUCRU CU DATELE: ${modeLine(dataMode)}${COMPLETE_RULE_JSON}
Rezultatul NU are figuri: enunțurile se scriu SELF-CONTAINED, cu toate datele în text — nicio referire la „figura alăturată”; itemii-sursă care depind de o figură se înlocuiesc cu alți itemi din același test.${wantFormatPdf ? '\nPrimești și MODELUL DE FORMAT (PDF): potrivește STRUCTURA subiectului cu el — numărul de itemi, secțiunile, tipul itemilor și proporțiile baremului vin din modelul de format, iar CONȚINUTUL din testele-sursă.' : ''}${ctx.line}
Răspunde STRICT cu UN obiect JSON valid: { "title": "…", "kind": "grila", "output": null, "statement": "", "questions": [ { "statement": "…", "options": ["A","B","C","D"], "answer_index": 0, "answer_text": null, "hint": "…", "explanation": "…", "points": 5 } ], "steps": null, "final_answer": null } (itemii cu răspuns liber: "options" null, "answer_text" = răspunsul; LaTeX cu backslash dublu).`;
    const blkE = srcTexts.map((x, i) => `=== TESTUL ${String.fromCharCode(65 + i)}: ${x.title} ===\n${x.text}`).join('\n\n');
    const blocksE = [];
    if (wantFormatPdf) {
      blocksE.push({ type: 'text', text: 'MODELUL DE FORMAT (PDF) — structura rezultatului se potrivește cu el:' });
      blocksE.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: String(formatPdf) } });
    }
    blocksE.push(...ctx.docBlocks);
    blocksE.push({ type: 'text', text: `${blkE}${ctx.textBlock}\n\nConstruiește subiectul acum.${String(autoInstr || '').trim() ? ` INSTRUCȚIUNI: ${String(autoInstr).slice(0, 3000)}` : ''} #${Math.random().toString(36).slice(2, 8)}` });
    const rE = await chatClaudeLong({ system: sysE, blocks: blocksE, maxTokens: 12000, model: aiModel, schema: EXERCISE_SCHEMA });
    const exE = parseExercise(rE);
    if (!exE || (exE.questions || []).length < 6) {
      console.error('exgen(auto-exam): invalid/incomplet (%s itemi). stopReason=%s continuations=%s', exE ? (exE.questions || []).length : 0, rE.stopReason, rE.continuations);
      throw httpErr(502, exE
        ? `Subiectul generat a ieșit INCOMPLET (doar ${(exE.questions || []).length} itemi din 10) — nu îl public. Mai încearcă.`
        : 'Nu am obținut un subiect valid. Mai încearcă.');
    }
    exE.output = 'pdf';
    return { exercise: exE, provider: rE.provider, combinedFrom: srcTexts.map((x) => x.title), usage: rE.usage };
  }

  // ── Rubrici INTERACTIVE → FORMATUL STANDARD (figuri + desen) sau, la
  // result_kind='format' cu HTML, MODELUL DE FORMAT încărcat de admin ──
  let templateHtml = wantFormatHtml ? String(formatHtml).slice(0, 180000) : null;
  let templateName = wantFormatHtml ? 'modelul de format al task-ului' : null;
  let templateId = null; // testul folosit ca șablon — itemii lui NU intră în bancă
  const sources = [];
  // Sursele-text (calea de rezervă) rămân plafonate, dar mai generos: la 5
  // teste × 6000 de caractere, Subiectul III al fiecărei surse era tăiat.
  const MAX_SRC = 14;
  const SRC_CHARS = 9000;
  const bodyCache = new Map(); // fișierele citite aici se refolosesc la banca de itemi
  for (const r of shuffled) {
    // avem șablonul ȘI destule surse-text → nu mai descărcăm restul rubricii
    // (banca de itemi își ia singură ce-i mai trebuie, din cache)
    if (templateHtml && sources.length >= MAX_SRC) break;
    try {
      if (r.interactive_data?.exercise) {
        if (sources.length < MAX_SRC) sources.push({ title: r.title, text: JSON.stringify(r.interactive_data.exercise).slice(0, SRC_CHARS) });
        continue;
      }
      const { buf } = await downloadStorage(supa, r.file_url);
      if (!buf) continue;
      const raw = buf.toString('utf8');
      bodyCache.set(r.id, raw);
      // formatul standard: figuri geometrice + instrumente de desen + scor
      const isStandard = /desen|<canvas|class="fig"/i.test(raw) && /MATE_SCORE/.test(raw);
      if (!templateHtml && isStandard && raw.length < 200000) { templateHtml = raw.slice(0, 120000); templateName = r.title; templateId = r.id; }
      const textOnly = raw.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
      if (textOnly.length > 200 && sources.length < MAX_SRC) sources.push({ title: r.title, text: textOnly.slice(0, SRC_CHARS) });
    } catch { /* sursă ignorată */ }
  }
  if (!templateHtml) {
    try {
      templateHtml = fs.readFileSync(path.join(__dirname, 'template-standard.html'), 'utf8').slice(0, 120000);
      templateName = 'șablonul standard al site-ului';
    } catch { /* lipsă */ }
  }
  if (sources.length < 2) throw httpErr(400, 'Nu am putut extrage conținut din suficiente teste ale rubricii.');
  if (!templateHtml) throw httpErr(500, 'Nu am găsit șablonul formatului standard.');
  const ctx = await ctxFor(sources.map((x) => x.title)); // bareme corespondente sau referințe

  // ── BANCA DE ITEMI: itemii testului nou se trag la sorți pe SERVER, din
  //    TOATE testele rubricii, subiect cu subiect (vezi buildItemPool) ──
  const tplFigs = [];
  const tplSplit = splitTestItems(templateHtml, tplFigs);
  const needBySec = {};
  tplSplit.order.forEach((sec) => { needBySec[sec] = (tplSplit.buckets[sec] || []).length; });
  const tplItems = Object.values(needBySec).reduce((a, b) => a + b, 0);

  let pool = null;      // { figs, perSource }
  let drawn = null;     // { I: [item], II: [...], III: [...] }
  let poolSources = []; // titlurile testelor din care au ieșit itemii
  if (tplSplit.order.length && tplItems >= 4 && rows.length >= 2) {
    try {
      pool = await buildItemPool({ supa, rows, maxSources: 24, excludeId: templateId, allowFig, bodyCache });
      drawn = {};
      let full = true;
      for (const sec of tplSplit.order) {
        drawn[sec] = drawItemsByPosition(pool.perSource, sec, needBySec[sec]);
        if (drawn[sec].length < needBySec[sec]) full = false;
      }
      if (!full) { drawn = null; pool = null; } // cădere pe combinarea clasică
      else {
        const seen = new Set();
        Object.values(drawn).flat().forEach((it) => seen.add(it.src));
        poolSources = [...seen];
      }
    } catch (e) {
      console.warn('exgen(auto-html): banca de itemi a eșuat (%s) — trec pe combinarea clasică', String(e?.message || e));
      drawn = null; pool = null;
    }
  }
  const usePool = !!drawn;

  // Planul: cu banca de itemi = lista EXACTĂ de itemi pe subiecte (toți itemii
  // testului, nu doar 8 poziții). Fără bancă = planul clasic pe teste-sursă,
  // dar acum acoperind TOȚI itemii șablonului și fără să ceară mereu itemii 1–5.
  const itemBlocks = [];
  let planI;
  if (usePool) {
    const lines = [];
    for (const sec of tplSplit.order) {
      lines.push(`SUBIECTUL ${sec} — ${drawn[sec].length} itemi, EXACT în ordinea asta:`);
      drawn[sec].forEach((it, i) => {
        const id = `${sec}.${i + 1}`;
        const from = `exercițiul ${it.pos || i + 1} de la Subiectul ${sec} din „${it.src}”`;
        lines.push(`  exercițiul ${i + 1} ← ITEM ${id} = ${from}${it.hasFig ? ' · ARE FIGURĂ' : ''}`);
        const form = it.form === 'obj'
          ? `obiect JS pentru array-ul ${it.array}`
          : it.form === 'card' ? 'bloc HTML <div class="card">' : 'item JSON';
        itemBlocks.push(`=== ITEM ${id} · ${from} · pe poziția ${i + 1} a Subiectului ${sec} · ${form} ===\n${it.text}`);
      });
    }
    planI = lines.join('\n');
  } else {
    const lettersI = shuffle(sources.map((_, i) => String.fromCharCode(65 + i)));
    const nPos = Math.min(24, Math.max(8, tplItems || 12));
    planI = Array.from({ length: nPos }, (_, i) => `- Itemul ${i + 1}${allowFig ? ' (DOAR dacă nu are figură)' : ''} ← TESTUL ${lettersI[i % lettersI.length]}, un item ales aleatoriu din ORICE subiect al lui (Subiectul I, II sau III — nu doar de la început), cu numere/notații noi.`).join('\n');
  }
  const tplIntro = wantFormatHtml
    ? 'Primești un ȘABLON HTML — MODELUL DE FORMAT ales de admin (clonează-i EXACT designul, stilul CSS și funcționalitatea JavaScript)'
    : `Primești un ȘABLON HTML în FORMATUL STANDARD al site-ului (test interactiv ${allowFig ? 'cu figuri geometrice SVG și instrumente de desen' : 'cu instrumente de desen, FĂRĂ figuri'})`;
  // Regulile pentru figuri. Cu banca de itemi, figura CĂLĂTOREȘTE cu itemul:
  // în textul itemului desenul e înlocuit cu marcajul <!--FIG:k-->, iar
  // serverul reinserează SVG-ul original al itemului după generare. Așa
  // Subiectul II (geometrie) se schimbă la fiecare rulare, iar enunțul și
  // desenul rămân consistente, pentru că vin din același test-sursă.
  const figRules = !allowFig
    ? `${NO_FIG_RULE.slice(1)} Itemii care aveau figură se ÎNLOCUIESC cu itemi fără figură (enunț complet, cu toate datele în text);`
    : usePool
      ? `- FIGURILE vin CU ITEMUL: în itemii marcați „ARE FIGURĂ” desenul e deja înlocuit cu marcajul <!--FIG:k-->. PĂSTREAZĂ marcajul EXACT așa, la locul lui (ex. <div class="fig"><!--FIG:7--></div>) — NU scrii SVG, NU desenezi, NU descrii figura: serverul reinserează desenul original al itemului;
- ETICHETELE DESENULUI URMEAZĂ ENUNȚUL — și literele, și valorile. Redenumește punctele (A,B,C,D → M,N,P,Q) și, dacă schimbi o lungime sau un unghi care e TRECUT PE DESEN, schimbă și valoarea. DECLARĂ toate corespondențele în marcaj, separate cu punct și virgulă: <!--FIG:7 A>M; B>N; C>P; D>Q; 3 cm>5 cm-->. Serverul rescrie atunci etichetele figurii (doar textul lor — liniile și proporțiile nu se ating). Declarația e OBLIGATORIE la orice schimbare de notație sau de valoare la un item cu figură: fără ea serverul încearcă să deducă singur corespondențele din enunț și poate rata, iar desenul ar rămâne cu literele și numerele vechi;
- ca deducerea automată să meargă și când uiți declarația: folosește EXACT ATÂTEA puncte și EXACT ATÂTEA numere câte are itemul original, în aceeași ordine de apariție în enunț;
- literele și valorile noi se folosesc consecvent în enunț, variante, rezolvare și barem;
- DESENUL TREBUIE SĂ RĂMÂNĂ CORECT: figura păstrează forma și proporțiile originale, deci schimbă valorile numai în fel care nu contrazice desenul — cel mai sigur e să înmulțești TOATE lungimile cu același factor (3, 4, 5 cm → 6, 8, 10 cm), păstrând unghiul drept, paralelismul, mijlocul de segment și celelalte relații din figură. Dacă o valoare nu poate fi schimbată fără să strice figura (ex. un unghi dintr-o configurație fixă), lasă-o exact cum e și schimbă doar notațiile;
- la itemii FĂRĂ figură schimbi liber și numerele și notațiile;`
      : `- FIGURILE/DESENELE (SVG, canvas) NU SE MODIFICĂ DELOC — rămân EXACT cele din șablon, cu aceleași etichete și valori (oricum vor fi restaurate programatic din șablon, deci orice modificare a lor e inutilă și greșită);
- itemii CU figură rămân cei ai șablonului: enunț, valori și notații consistente cu figura, cel mult mici reformulări care NU contrazic figura; combini din celelalte teste DOAR itemii FĂRĂ figură;`;

  // Titlul: adminul cere numărul testului + numele rubricii, nu lista
  // subiectelor („Subiectul I & Subiectul II" din antetul șablonului).
  const testNo = rows.length + 1;
  const titleRule = `\n- TITLUL: în <title> și în titlul din antetul paginii scrie „Test ${testNo}${catLabel(category) ? ` · ${catLabel(category)}` : ''}”. În subtitlu NU enumeri subiectele („Subiectul I & Subiectul II” se ȘTERGE): scrie numărul de exerciții, punctajul total și, dacă șablonul îl are, timpul de lucru.`;

  const poolRules = usePool
    ? `
BANCA DE ITEMI (OBLIGATORIE): serverul a tras deja la sorți, din ${poolSources.length} teste DIFERITE ale rubricii, TOȚI cei ${Object.values(drawn).reduce((a, b) => a + b.length, 0)} itemi ai testului nou. Îi primești mai jos, fiecare cu id-ul lui.
- FOLOSEȘTE EXACT acești itemi, în ordinea din plan, la subiectele indicate: nu păstra itemii șablonului, nu inventa alții, nu schimba ordinea, nu sări niciunul, nu adăuga în plus;
- POZIȚIA FIXEAZĂ TIPUL: fiecare item a fost tras la sorți dintre exercițiile de pe ACEEAȘI poziție ale testelor rubricii (exercițiul 3 de la Subiectul II ← dintre exercițiile 3 de la Subiectul II). Păstrează itemul pe poziția lui din plan: nu-l muta pe altă poziție, nu-l rescrie ca alt tip de exercițiu și nu amesteca tipurile între poziții — la Subiectul ${tplSplit.order[0] || 'I'} exercițiul 1 trebuie să ceară același lucru ca exercițiile 1 din rubrică, exercițiul 2 ca exercițiile 2 și așa mai departe;
- ȘABLONUL e doar CARCASA (design, CSS, JavaScript, instrumente de desen, bara de scor, structura pe subiecte): TOT conținutul itemilor vine din bancă;
- SCHIMBĂ NUMERELE ȘI NOTAȚIILE fiecărui item — aceeași cerință, alte valori și alte litere — apoi RECALCULEAZĂ răspunsul corect și REscrie rezolvarea/baremul ca să corespundă noilor valori;
- RĂSPUNSUL CORECT la grilă se distribuie între a), b), c) și d) (nu toate la a)), cu EXACT un răspuns corect pe item: reașază variantele, nu doar eticheta, și pune cheia (data-correct / "ok") pe litera care ajunge să conțină răspunsul;
- itemii „obiect JS pentru array-ul EX1” intră în array-ul cu acel nume din script (rescris COMPLET, cu noii itemi); itemii „bloc HTML <div class=\\"card\\">” intră ca atare în secțiunea lor, renumerotați (.nr) de la 1;`
    : '';

  const sysAuto = `Ești agentul de creare de exerciții al platformei ExamenMate (matematică, românește).
${tplIntro} și ${usePool ? `o BANCĂ DE ITEMI trasă la sorți din ${poolSources.length} teste` : `${sources.length} teste`} existente din rubrica „${category}${subcategory ? ' / ' + subcategory : ''}”.
Sarcina: construiește URMĂTORUL test al rubricii (nr. ${testNo}), ÎN ACELAȘI FIȘIER-FORMAT ca șablonul.
${poolRules}
PLAN${usePool ? ' — itemii testului, pe subiecte (tras la sorți pe server, respectă-l întocmai)' : ' DE COMBINARE — tras la sorți pe server; respectă-l întocmai, ca generările succesive să fie DIFERITE'}:
${planI}

Reguli:
- COPIAZĂ ÎNTOCMAI tot ce nu ține de conținutul itemilor: CSS-ul complet, TOT JavaScript-ul, instrumentele de desen, structura pe subiecte, bara de scor — NIMIC eliminat sau simplificat;
- ${usePool ? 'pentru fiecare poziție din plan: PORNEȘTE de la itemul indicat din bancă' : 'pentru pozițiile din plan: COPIAZĂ itemul indicat'}; REGIM DE LUCRU CU DATELE: ${modeLine(dataMode)};
- același număr de itemi și aceeași structură (subiecte, punctaje) ca șablonul;
${figRules}
- păstrează raportarea scorului (MATE_SCORE) exact ca în șablon; dacă șablonul NU o are, ADAUG-O: parent.postMessage({type:'MATE_SCORE', score: <procent 0-100>, maxScore: 100}, '*').${titleRule}${TPL_RULE}${COMPLETE_RULE_HTML}${MATH_RULE}${ctx.line}
Răspunde DOAR cu documentul HTML complet (de la <!doctype html> la </html>), fără explicații, fără markdown.`;

  const srcBlock = usePool
    ? `=== BANCA DE ITEMI (folosește-i pe TOȚI, în ordinea din plan) ===\n${itemBlocks.join('\n\n')}\n=== SFÂRȘIT BANCA DE ITEMI ===`
    : sources.map((x, i) => `=== TESTUL ${String.fromCharCode(65 + i)}: ${x.title} ===\n${x.text}`).join('\n\n');
  const tplIA = tplAnnotate(templateHtml);
  const blocksI = [];
  blocksI.push(...ctx.docBlocks);
  const figNote = usePool && allowFig ? ' Marcajele <!--FIG:k--> se copiază EXACT, nu se înlocuiesc cu SVG.' : '';
  const poolNote = usePool
    ? ` REAMINTIRE: toți itemii vin din BANCA DE ITEMI, fiecare pe poziția lui din plan (poziția fixează tipul exercițiului) — niciun item al șablonului nu rămâne în rezultat.${figNote}`
    : '';
  blocksI.push({ type: 'text', text: `ȘABLONUL (${wantFormatHtml ? 'modelul de format' : 'formatul standard'}, cu blocurile <style>/<script> numerotate <!--TPL:N-->):\n${tplIA.annotated}\n\n${srcBlock}${ctx.textBlock}\n\nConstruiește ACUM testul nr. ${testNo} — doar documentul HTML. REAMINTIRE FINALĂ (economie de tokeni): blocurile <style>/<script> pe care NU le modifici = DOAR marcajele goale <style data-tpl=\"N\"></style> / <script data-tpl=\"N\"></script> — nu le rescrie; blocul cu DATELE itemilor se scrie complet.${poolNote}${String(autoInstr || '').trim() ? ` INSTRUCȚIUNILE ADMINULUI (prioritare${allowFig ? (usePool ? ', dar marcajele de figură se păstrează' : ', dar desenele tot NU se modifică') : ', dar tot FĂRĂ figuri'}): ${String(autoInstr).slice(0, 3000)}` : ''} Sesiune #${Math.random().toString(36).slice(2, 8)}.` });
  const rA = await chatClaudeLong({
    system: sysAuto,
    blocks: blocksI,
    maxTokens: 30000,
    model: aiModel,
    until: (t) => /<\/html>/i.test(t),
  });

  let htmlOut = cutHtml(rA.text);
  if (htmlOut) htmlOut = tplRestore(htmlOut, tplIA.blocks);

  if (htmlOut && usePool) {
    // Figurile se reinserează din ITEMUL din care au venit (marcaje FIG), nu
    // din șablon pe poziții — altfel un item de geometrie luat din alt test ar
    // primi desenul altui exercițiu.
    htmlOut = figRestore(htmlOut, pool.figs);
    // Subiectul III (probleme cu rezolvare redactată) vine fără desene: îi dăm
    // un spațiu de desenare cu figura de bază a problemei, nenotată.
    if (allowFig && drawn.III && drawn.III.length) {
      const shapes = baseShapesFor(drawn.III);
      if (shapes.some(Boolean)) htmlOut = injectDrawSpaces(htmlOut, 'III', shapes);
    }
  } else if (htmlOut && allowFig) {
    // Combinarea clasică (fără bancă): itemii cu figură rămân ai șablonului, deci
    // restaurăm figurile EXACT din șablon.
    const tplSvgs = templateHtml.match(/<svg[\s\S]*?<\/svg>/gi) || [];
    if (tplSvgs.length) {
      let svgIdx = 0;
      htmlOut = htmlOut.replace(/<svg[\s\S]*?<\/svg>/gi, (m) => (svgIdx < tplSvgs.length ? tplSvgs[svgIdx++] : m));
    }
  }
  if (htmlOut && !allowFig) htmlOut = stripFigures(htmlOut);

  if (!htmlOut && rA.stopReason === 'max_tokens') {
    console.error('exgen(auto-html): trunchiat și după continuări. continuations=%s', rA.continuations);
    throw httpErr(502, `Șablonul rubricii e prea mare pentru o singură generare — mai încearcă (sau folosește o rubrică cu teste mai mici). [stop=max_tokens, continuări=${rA.continuations || 0}${rA.viaUserMode ? ', fără prefill' : ''}, lungime=${rA.textLength ?? '?'}]`);
  }
  try {
    assertCompleteHtml({ html: htmlOut, baseline: templateHtml, what: 'Testul generat pe rubrică' });
    // cu banca de itemi știm că NICIUN item al șablonului nu are ce căuta în
    // rezultat — dacă modelul le-a copiat, rularea eșuează în loc să publice
    // încă o dată același test
    if (usePool) {
      assertRenewedItems({ html: htmlOut, template: templateHtml, bankText: itemBlocks.join('\n'), what: 'Testul generat pe rubrică' });
      assertAnswerSpread({ html: htmlOut, what: 'Testul generat pe rubrică' });
    }
  } catch (e) {
    e.message += ` [stop=${rA.stopReason || '?'}, continuări=${rA.continuations || 0}${rA.viaUserMode ? ', fără prefill' : ''}${rA.strictRetry ? ', re-cerere strictă' : ''}, lungime=${rA.textLength ?? '?'}]`;
    console.error('exgen(auto-html): invalid. stopReason=%s continuations=%s', rA.stopReason, rA.continuations);
    throw e;
  }
  return {
    html: htmlOut,
    provider: rA.provider,
    // istoricul task-ului arată din câte teste s-a compus efectiv rezultatul
    combinedFrom: usePool ? poolSources : sources.map((x) => x.title),
    template: templateName,
    usage: rA.usage,
  };
}

// =====================================================================
// RANDAREA exercițiului JSON ca HTML interactiv autonom.
// COPIE CJS a src/lib/exerciseRender.js (renderExercise) + autoMath din
// src/lib/katex.js — dacă schimbi designul acolo, oglindește-l și aici.
// =====================================================================
const CMDS = 'cdot|times|div|pm|mp|angle|pi|alpha|beta|gamma|delta|theta|lambda|mu|omega|leq|geq|le|ge|neq|approx|equiv|infty|circ|Delta|Omega|deg|notin|in|subseteq|subset|supset|cup|cap|Rightarrow|rightarrow|leftarrow|to|forall|exists';

function wrapBare(s) {
  if (!s) return s;
  // grade scrise stricat în text: „70^∘" / „70^{∘}" (caret literal) → „70°"
  s = s.replace(/(\d)\s*\^\s*(?:\{\s*[∘°]\s*\}|[∘°])/g, '$1°');
  s = s.replace(/\\frac\s*\{[^{}]*\}\s*\{[^{}]*\}/g, (m) => '$' + m + '$');
  s = s.replace(/\\sqrt\s*(\[[^\]]*\])?\s*\{[^{}]*\}/g, (m) => '$' + m + '$');
  // exponentul poate fi și o COMANDĂ (\circ): altfel „70^\circ" rămânea
  // „70^" + „∘" — caretul apărea literal în enunț (eroarea de redactare)
  s = s.replace(/((?:\d+[A-Za-z]?)?\([^()]*\)|\[[^\][]*\]|\d+(?:[.,]\d+)?|[A-Za-z0-9])(\^|_)(\{[^{}]*\}|\\[a-zA-Z]+|[A-Za-z0-9]+)/g, (m) => '$' + m + '$');
  // comenzile rămase se încadrează DOAR în afara zonelor deja împachetate mai
  // sus (altfel \circ din „$70^\circ$" se re-împacheta și strica expresia)
  const cmdRe = new RegExp('\\\\(' + CMDS + ')\\b', 'g');
  s = s.split(/(\$[^$]*\$)/g).map((seg, i) => (i % 2 === 1 ? seg : seg.replace(cmdRe, (m) => '$' + m + '$'))).join('');
  s = s.replace(/\$\s*\$/g, ' ');
  return s;
}

// Propoziții românești împachetate GREȘIT în $...$ (tot enunțul în math mode
// → cuvinte italice lipite: „Știindcăm(∠B)"): le scoatem din matematică și
// re-încadrăm DOAR bucățile cu adevărat matematice.
const ROM_TEXT_RE = /[ăâîșțĂÂÎȘȚ]|(?:^|[^\\a-zA-Z])(și|sau|este|sunt|fie|dacă|atunci|deci|află|arată|calculează|determină|știind|unghiul|unghiului|triunghiul|laturile|numerele|valoarea)(?![a-zA-Z])/i;
function unwrapTextMath(seg) {
  const m = seg.match(/^(\${1,2})([\s\S]*)\1$/);
  if (!m) return seg;
  const inner = m[2];
  if (!ROM_TEXT_RE.test(inner)) return seg;
  return wrapBare(inner.replace(/\.\s*(?=[A-ZĂÎÂȘȚ])/g, '. '));
}

function autoMath(input) {
  if (!input || (String(input).indexOf('\\') === -1 && String(input).indexOf('^') === -1 && String(input).indexOf('_') === -1 && String(input).indexOf('$') === -1)) return input;
  const parts = String(input).split(/(\$\$[^$]*\$\$|\$[^$]*\$|\\\([^)]*\\\)|\\\[[^\]]*\\\])/g);
  const out = parts.map((seg, i) => (i % 2 === 1 ? unwrapTextMath(seg) : wrapBare(seg))).join('');
  // spațiu după punctul dintre propoziții („BC).Știind" → „BC). Știind")
  return out.replace(/([)\]a-zăâîșț])\.(?=[A-ZĂÎÂȘȚ])/g, '$1. ');
}

function esc(s = '') {
  return String(autoMath(s || '')).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

const HEAD = `<!doctype html><html lang="ro"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.css">
<style>
  body{font-family:system-ui,-apple-system,'Segoe UI',sans-serif;color:#0f2b44;margin:0;padding:16px;background:#fff;line-height:1.6}
  h1{font-size:1.15rem;margin:0 0 6px}
  .total{font-size:.82rem;color:#667;margin-bottom:14px}
  .enunt{background:#f7f9fc;border:1px solid #e6e9ef;border-radius:12px;padding:14px;margin-bottom:14px}
  .q{border:1px solid #e6e9ef;border-radius:12px;padding:14px;margin-bottom:12px}
  .stmt{font-size:1.02rem;margin-bottom:10px}
  .pts{float:right;font-size:.75rem;font-weight:700;color:#8a6d00;background:#fff4e5;border-radius:20px;padding:2px 10px;margin-left:8px}
  .opt{display:flex;align-items:center;gap:8px;padding:8px 10px;border:1px solid #e6e9ef;border-radius:8px;margin-bottom:6px;cursor:pointer}
  .opt:hover{background:#f7f9fc}
  .txt{width:100%;padding:9px 11px;border:1px solid #ccd3dd;border-radius:8px;font-size:.95rem;box-sizing:border-box}
  .hintBtn{background:none;border:1px dashed #c49a1a;color:#8a6d00;border-radius:8px;padding:5px 10px;font-size:.78rem;cursor:pointer;margin-top:8px}
  .hint{display:none;margin-top:8px;font-size:.85rem;background:#fff9e8;border-radius:8px;padding:8px 10px;color:#6b5400}
  .fb{margin-top:8px;font-size:.9rem;font-weight:600}
  .ok{color:#1e7e34}.bad{color:#c0392b}
  .exp{margin-top:6px;font-weight:400;color:#444;font-size:.86rem;background:#f7f9fc;border-radius:8px;padding:8px 10px}
  button.main{background:#e8b931;color:#0f2b44;border:none;border-radius:10px;padding:11px 20px;font-weight:700;font-size:.95rem;cursor:pointer;margin-top:6px}
  .res{font-size:1.1rem;font-weight:800;margin:12px 0}
  .barem{font-size:.85rem;color:#445;margin-top:4px}
  .final{background:#eef7f0;border:1px solid #cde8d4;border-radius:10px;padding:10px 12px;margin-top:10px;display:none}
</style></head><body>`;

const KATEX = `<script src="https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.js"><\/script>
<script src="https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/contrib/auto-render.min.js"><\/script>
<script>
  function rmath(){ if(window.renderMathInElement) renderMathInElement(document.body,{delimiters:[{left:'$$',right:'$$',display:true},{left:'$',right:'$',display:false}],throwOnError:false}); }
  if(window.renderMathInElement) rmath(); else window.addEventListener('load', rmath);
  function norm(s){return String(s||'').trim().toLowerCase().replace(',','.').replace(/\\s+/g,'');}
  ${ANS_EQ_JS}
  function showHint(i){var h=document.getElementById('hint'+i);h.style.display=h.style.display==='block'?'none':'block';rmath();}
<\/script>`;

function itemShell(i, inner, pts, hint) {
  return `<div class="q">
    <span class="pts">${pts} p</span>
    ${inner}
    ${hint ? `<button class="hintBtn" onclick="showHint(${i})">💡 Indiciu</button><div class="hint" id="hint${i}">${esc(hint)}</div>` : ''}
    <div class="fb" id="fb${i}"></div>
  </div>`;
}

function renderGrila(ex) {
  const qs = Array.isArray(ex.questions) ? ex.questions : [];
  const total = qs.reduce((s, q) => s + (Number(q.points) || 0), 0);
  const items = qs.map((q, i) => {
    const hasOpts = Array.isArray(q.options) && q.options.length > 0;
    const body = hasOpts
      ? `<div>${q.options.map((o, oi) => `<label class="opt"><input type="radio" name="q${i}" value="${oi}"> <b>${String.fromCharCode(65 + oi)})</b> <span>${esc(o)}</span></label>`).join('')}</div>`
      : `<input class="txt" type="text" name="q${i}" placeholder="Răspunsul tău">`;
    return itemShell(i, `<div class="stmt"><b>${i + 1}.</b> ${esc(q.statement)}</div>${body}`, q.points || 0, q.hint);
  }).join('');

  const data = qs.map((q) => ({
    t: Array.isArray(q.options) && q.options.length ? 'c' : 'o',
    a: Array.isArray(q.options) && q.options.length ? Number(q.answer) : String(q.answer ?? ''),
    p: Number(q.points) || 0,
    e: esc(q.explanation || ''), // escapat: se afișează prin innerHTML (matematica $..$ rămâne)
  }));

  return `${HEAD}
  <h1>${esc(ex.title || 'Exercițiu grilă')}</h1>
  <div class="total">Barem: ${total} puncte</div>
  ${ex.statement ? `<div class="enunt">${esc(ex.statement)}</div>` : ''}
  ${items}
  <button class="main" id="check">Verifică</button>
  <div class="res" id="res"></div>
  ${KATEX}
<script>
  var D=${JSON.stringify(data).replace(/</g, '\\u003c')};
  document.getElementById('check').addEventListener('click', function(){
    var got=0, max=0, A=[];
    for(var i=0;i<D.length;i++){
      max+=D[i].p; var ok=false;
      if(D[i].t==='c'){ var s=document.querySelector('input[name="q'+i+'"]:checked'); ok=s&&Number(s.value)===D[i].a; A.push(s?Number(s.value):null); }
      else { var el=document.querySelector('input[name="q'+i+'"]'); ok=el&&ansEq(el.value,D[i].a); A.push(el?String(el.value||''):''); }
      if(ok) got+=D[i].p;
      var fb=document.getElementById('fb'+i);
      fb.className='fb '+(ok?'ok':'bad');
      fb.innerHTML=(ok?'✓ Corect (+'+D[i].p+' p)':'✗ Greșit (0 p)')+(D[i].e?'<div class="exp"><b>Rezolvare:</b> '+D[i].e+'</div>':'');
    }
    rmath();
    var pct=max?Math.round(got/max*100):0;
    document.getElementById('res').innerHTML='Punctaj: '+got+' / '+max+' puncte ('+pct+'%)';
    var MSG={type:'MATE_SCORE',score:pct,maxScore:100,answers:A,raw:{got:got,max:max}}; // answers: serverul recalculează scorul (Etapa 3)
    try{ parent.postMessage(MSG,'*'); }catch(e){}
    try{ if(window.opener) window.opener.postMessage(MSG,'*'); }catch(e){}
  });
<\/script></body></html>`;
}

function renderEtape(ex) {
  const steps = Array.isArray(ex.steps) ? ex.steps : [];
  const total = steps.reduce((s, x) => s + (Number(x.points) || 0), 0);
  const items = steps.map((s, i) => itemShell(
    i,
    `<div class="stmt"><b>Etapa ${i + 1}.</b> ${esc(s.prompt)}</div><input class="txt" type="text" name="q${i}" placeholder="Răspunsul etapei">`,
    s.points || 0, s.hint,
  )).join('');

  const data = steps.map((s) => ({ a: String(s.answer ?? ''), p: Number(s.points) || 0, e: esc(s.explanation || '') }));

  return `${HEAD}
  <h1>${esc(ex.title || 'Problemă cu etape de rezolvare')}</h1>
  <div class="total">Barem: ${total} puncte · ${steps.length} etape</div>
  <div class="enunt"><b>Enunț.</b> ${esc(ex.statement || '')}</div>
  ${items}
  <button class="main" id="check">Verifică rezolvarea</button>
  <div class="res" id="res"></div>
  <div class="final" id="final"><b>Răspuns final:</b> <span>${esc(ex.final_answer || '')}</span></div>
  ${KATEX}
<script>
  var D=${JSON.stringify(data).replace(/</g, '\\u003c')};
  document.getElementById('check').addEventListener('click', function(){
    var got=0, max=0, A=[];
    for(var i=0;i<D.length;i++){
      max+=D[i].p;
      var el=document.querySelector('input[name="q'+i+'"]');
      var ok=el&&ansEq(el.value,D[i].a); A.push(el?String(el.value||''):'');
      if(ok) got+=D[i].p;
      var fb=document.getElementById('fb'+i);
      fb.className='fb '+(ok?'ok':'bad');
      var ad=String(D[i].a).replace(/[&<>]/g,function(c){return c==='&'?'&amp;':c==='<'?'&lt;':'&gt;';}); // răspunsul escapat DOAR pt. afișare (comparația de mai sus rămâne pe D[i].a brut)
      fb.innerHTML=(ok?'✓ Corect (+'+D[i].p+' p)':'✗ Greșit (0 p) — răspuns corect: '+ad)+(D[i].e?'<div class="exp"><b>Barem/rezolvare:</b> '+D[i].e+'</div>':'');
    }
    rmath();
    document.getElementById('final').style.display='block';
    var pct=max?Math.round(got/max*100):0;
    document.getElementById('res').innerHTML='Punctaj: '+got+' / '+max+' puncte ('+pct+'%)';
    var MSG={type:'MATE_SCORE',score:pct,maxScore:100,answers:A,raw:{got:got,max:max}}; // answers: serverul recalculează scorul (Etapa 3)
    try{ parent.postMessage(MSG,'*'); }catch(e){}
    try{ if(window.opener) window.opener.postMessage(MSG,'*'); }catch(e){}
  });
<\/script></body></html>`;
}

function renderExerciseHtml(exercise) {
  const ex = exercise || {};
  return ex.kind === 'etape' ? renderEtape(ex) : renderGrila(ex);
}

// ─── Postarea pe site: Storage + rând în `content` (ca formularele din Admin) ─
// Subcategoria sub care materialul INTERACTIV e chiar VIZIBIL pe site.
// Cauza lui „am bifat postare automată și nu a apărut pe site": paginile
// Evaluare Națională / Bacalaureat afișează conținut interactiv DOAR la
// anumite subcategorii (tab-ul „Teste Interactive" = 'teste-interactive';
// comutatoarele Interactive/PDF există doar la 'capitole' și
// 'exercitii-subiecte' / 'exercitii'). Un rând postat cu subcategory
// 'variante', 'simulari', 'bareme' sau o rubrică-mix 'a+b' se salva în baza
// de date, dar NICIO pagină nu-l interoga — părea că postarea a eșuat.
// Clasele nu filtrează după subcategorie → rămân neatinse.
const INTERACTIVE_VISIBLE_SUBS = {
  'evaluare-nationala': ['teste-interactive', 'capitole', 'exercitii-subiecte'],
  'bacalaureat': ['teste-interactive', 'capitole', 'exercitii'],
};
function visibleSubcategory(category, subcategory) {
  let sub = subcategory ? String(subcategory) : null;
  if (sub && sub.includes('+')) sub = sub.split('+')[0]; // rubrică-mix „a+b"
  const ok = INTERACTIVE_VISIBLE_SUBS[String(category || '')];
  if (!ok) return sub;                 // clasele: orice subcategorie se vede
  return ok.includes(sub) ? sub : 'teste-interactive';
}

function slug(s) {
  return String(s || 'exercitiu').toLowerCase()
    .replace(/[ăâ]/g, 'a').replace(/î/g, 'i').replace(/[șş]/g, 's').replace(/[țţ]/g, 't')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'exercitiu';
}

async function postContent({ supa, title, description = '', category, subcategory = null, profile = null, isFree = false, html = null, exercise = null, postType = 'test', taskId = null }) {
  const finalHtml = html || renderExerciseHtml(exercise);
  if (!finalHtml || finalHtml.length < 200) throw httpErr(500, 'Nu există conținut de postat.');
  const bucket = isFree ? 'content-files-free' : 'content-files';
  const storagePath = `interactive/${category}/${Date.now()}_task_${slug(title)}.html`;
  const { error: upErr } = await supa.storage.from(bucket)
    .upload(storagePath, Buffer.from(finalHtml, 'utf8'), { contentType: 'text/html' });
  if (upErr) throw httpErr(502, `Încărcarea în Storage a eșuat: ${upErr.message}`);
  const { data: urlData } = supa.storage.from(bucket).getPublicUrl(storagePath);
  const row = {
    title: String(title || 'Test generat').slice(0, 300),
    description: String(description || '').slice(0, 500),
    category, content_type: 'interactive', is_free: !!isFree,
    file_url: urlData?.publicUrl || storagePath,
    interactive_data: {
      type: postType === 'exercise' ? 'exercise' : 'test',
      html: true, ai_generated: true, agent: 'claude',
      ...(taskId ? { agent_task: taskId } : {}),
      ...(exercise ? { exercise } : {}),
    },
    // subcategoria e mapată pe una VIZIBILĂ pe site (vezi visibleSubcategory)
    subcategory: visibleSubcategory(category, subcategory),
    profile: profile || null,
    sort_order: 0,
  };
  const { data: ins, error: dbErr } = await supa.from('content').insert(row).select('id').single();
  if (dbErr) {
    await supa.storage.from(bucket).remove([storagePath]).catch(() => {});
    throw httpErr(502, `Salvarea în baza de date a eșuat: ${dbErr.message}`);
  }
  return { contentId: ins?.id || null, fileUrl: row.file_url };
}

// ─── MODELUL DE FORMAT al unui task: fișier HTML/PDF încărcat de admin ───────
// Se păstrează în Storage (bucketul privat 'content-files', folderul
// agent-formats/), iar în task rămâne doar descriptorul
// {bucket, path, name, kind}. La fiecare rulare, runTask îl descarcă.
const FORMAT_BUCKET = 'content-files';

async function storeFormatModel({ supa, name, html = null, pdf = null }) {
  if (!html && !pdf) throw httpErr(400, 'Modelul de format e gol.');
  const kind = pdf ? 'pdf' : 'html';
  const body = pdf ? Buffer.from(String(pdf), 'base64') : Buffer.from(String(html), 'utf8');
  if (body.length > 2.8 * 1024 * 1024) throw httpErr(400, 'Modelul de format e prea mare (max ~2,5 MB).');
  if (body.length < 200) throw httpErr(400, 'Modelul de format pare gol sau corupt.');
  const safe = slug(String(name || 'model-format').replace(/\.(html?|pdf)$/i, ''));
  const storagePath = `agent-formats/${Date.now()}_${safe}.${kind}`;
  const { error } = await supa.storage.from(FORMAT_BUCKET)
    .upload(storagePath, body, { contentType: kind === 'pdf' ? 'application/pdf' : 'text/html' });
  if (error) throw httpErr(502, `Nu am putut salva modelul de format în Storage: ${error.message}`);
  return { bucket: FORMAT_BUCKET, path: storagePath, name: String(name || 'model-format').slice(0, 160), kind };
}

async function removeFormatModel({ supa, formatModel }) {
  if (!formatModel?.path) return;
  await supa.storage.from(formatModel.bucket || FORMAT_BUCKET).remove([formatModel.path]).catch(() => {});
}

// Descarcă modelul de format al unui task (la rulare) → { formatHtml, formatPdf }
async function loadFormatModel({ supa, task }) {
  if (task.result_kind !== 'format' || !task.format_model?.path) return { formatHtml: null, formatPdf: null };
  const fm = task.format_model;
  const { data: blob, error } = await supa.storage.from(fm.bucket || FORMAT_BUCKET).download(fm.path);
  if (error || !blob) throw httpErr(502, `Modelul de format („${fm.name || fm.path}”) nu a putut fi descărcat din Storage — reîncarcă-l în setările task-ului.`);
  const buf = Buffer.from(await blob.arrayBuffer());
  return fm.kind === 'pdf'
    ? { formatHtml: null, formatPdf: buf.toString('base64') }
    : { formatHtml: buf.toString('utf8'), formatPdf: null };
}

// ─── Emailul către admin după o rulare programată (dacă task.notify) ─────────
async function notifyAdmin({ task, run }) {
  const mailer = require('./mailer');
  if (!task.notify || !mailer.enabled()) return false;
  const site = (process.env.SITE_URL || 'https://examenmate.com').replace(/\/$/, '');
  const rubric = `${task.category}${task.subcategory ? ' / ' + task.subcategory : ''}${task.profile ? ' · ' + task.profile : ''}`;
  const state = run.status === 'posted'
    ? { subj: `🤖 Task „${task.name}”: test nou PUBLICAT pe site`, head: 'Testul a fost generat și publicat automat pe site.' }
    : run.status === 'pending_review'
      ? { subj: `🤖 Task „${task.name}”: test generat — așteaptă aprobarea ta`, head: 'Testul a fost generat și AȘTEAPTĂ aprobarea ta în admin (nu e pe site încă).' }
      : run.status === 'skipped'
        ? { subj: `ℹ️ Task „${task.name}”: nimic nou de generat`, head: 'Modul „pe rând”: toate fișierele din rubrică au fost deja procesate de acest task. Adaugă materiale noi în rubrică sau resetează progresul (↺) din panoul task-ului.' }
        : { subj: `⚠️ Task „${task.name}”: eroare la generare`, head: 'Rularea programată a eșuat.' };
  const html = mailer.template({
    title: state.subj.replace(/^[^ ]+ /, ''),
    preheader: run.title || rubric,
    bodyHtml: `
      <p>${state.head}</p>
      <ul style="padding-left:20px">
        <li><strong>Task:</strong> ${mailer.escapeHtml(task.name)}</li>
        <li><strong>Rubrica:</strong> ${mailer.escapeHtml(rubric)}</li>
        ${run.title ? `<li><strong>Titlu generat:</strong> ${mailer.escapeHtml(run.title)}</li>` : ''}
        ${run.provider ? `<li><strong>Model AI:</strong> ${mailer.escapeHtml(run.provider)}</li>` : ''}
        ${run.error ? `<li style="color:#b71c1c"><strong>Eroare:</strong> ${mailer.escapeHtml(run.error)}</li>` : ''}
      </ul>
      <p style="margin-top:16px"><a href="${site}/admin" style="display:inline-block;background:#17233f;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:600">Deschide panoul de admin</a></p>`,
    footerNote: 'Email automat de la agentul Claude de exerciții (task programat). Gestionezi task-urile din Admin → Agent Claude → Task-uri programate.',
  });
  const r = await mailer.sendMail({ to: mailer.ADMIN_EMAIL, subject: state.subj, html });
  return !!r.ok;
}

// ─── Execuția completă a unui task programat (folosită de cron și „Rulează acum”) ─
async function runTask({ supa, task, triggerKind = 'cron' }) {
  const startedAt = new Date().toISOString();

  // Revendicare ATOMICĂ la START: mutăm last_run_at la ACUM, condiționat pe
  // valoarea veche. Dacă o altă rulare (cron vs. „Rulează acum" apăsat aproape
  // de ora programată) a revendicat deja task-ul, update-ul nu potrivește →
  // ieșim, ca să NU generăm de două ori (și, cu auto_post, să nu publicăm dublu).
  let claimQuery = supa.from('agent_tasks').update({ last_run_at: startedAt }).eq('id', task.id);
  claimQuery = task.last_run_at == null ? claimQuery.is('last_run_at', null) : claimQuery.eq('last_run_at', task.last_run_at);
  const { data: claimed } = await claimQuery.select('id');
  if (!claimed || !claimed.length) {
    return {
      ok: false, skipped: true, runId: null, usage: null, emailed: false,
      run: { status: 'skipped', title: 'Sărit — task-ul e deja în curs de rulare', provider: null, content_id: null, error: null },
    };
  }

  const run = {
    task_id: task.id, trigger_kind: triggerKind, status: 'error',
    title: null, provider: null, content_id: null, error: null, result: null, combined_from: null,
  };
  let usage = null;
  const seqAppend = []; // id-urile fișierelor-sursă consumate (modul „pe rând")
  let seqWarn = '';     // fișiere-sursă sărite pentru că nu se pot citi din Storage
  try {
    // modelul de format (dacă task-ul cere rezultat „după modelul de format")
    const { formatHtml, formatPdf } = await loadFormatModel({ supa, task });
    const g = await runAuto({
      supa,
      category: task.category, subcategory: task.subcategory, profile: task.profile,
      ctype: task.ctype || 'interactive',
      instructions: task.instructions || '',
      resultKind: task.result_kind || 'auto',
      dataMode: task.data_mode || 'modify',
      aiModel: task.ai_model || null,
      extraRubrics: task.extra_rubrics || [],
      formatHtml, formatPdf,
      seqDone: Array.isArray(task.seq_done) ? task.seq_done : [],
    });
    usage = g.usage || null;
    // fișierele-sursă ilizibile se bifează ca procesate (altfel task-ul „pe rând"
    // s-ar opri pe ele la fiecare rulare) și motivul ajunge în istoric + email
    const badSrc = Array.isArray(g.skippedSources) ? g.skippedSources : [];
    if (badSrc.length) {
      seqAppend.push(...badSrc.map((x) => x.id).filter(Boolean));
      seqWarn = `Am sărit ${badSrc.length} fișier(e)-sursă care nu au putut fi citite din Storage: ${badSrc.map((x) => `„${x.title}” (${x.reason})`).join('; ')}. Le-am bifat ca procesate ca să nu blocheze task-ul — reîncarcă-le în rubrică și apasă ↺ dacă vrei să fie folosite.`;
    }

    if (g.skipped) {
      // modul „pe rând": nu mai există fișiere neprelucrate în rubrică
      run.status = 'skipped';
      run.title = 'Nimic nou de generat — toate fișierele din rubrică au fost procesate';
      run.result = { kind: 'note', note: g.reason };
    } else {
      run.provider = g.provider || null;
      run.combined_from = g.combinedFrom || null;
      run.title = (g.exercise && g.exercise.title)
        || (String(g.html || '').match(/<title>([^<]*)<\/title>/i)?.[1] || '').trim()
        || `Test generat · ${task.name}`;

      if (task.auto_post) {
        const posted = await postContent({
          supa,
          title: run.title,
          // fără descrierea „Generat automat de agentul Claude…” pe site
          // (cererea adminului) — proveniența rămâne în interactive_data
          // (agent: 'claude', agent_task) și în istoricul task-ului
          description: '',
          category: task.category, subcategory: task.subcategory, profile: task.profile,
          isFree: !!task.is_free,
          html: g.html || null, exercise: g.exercise || null,
          postType: task.post_type || 'test',
          taskId: task.id,
        });
        run.status = 'posted';
        run.content_id = posted.contentId;
      } else {
        run.status = 'pending_review';
        // rezultatul rămâne în istoricul rulărilor până îl aprobi/ștergi din
        // admin (plafonat sub ~1 MB — limita payload-ului API-ului Supabase)
        run.result = g.html
          ? { kind: 'html', html: String(g.html).slice(0, 700000) }
          : { kind: 'exercise', exercise: g.exercise };
      }
      // progresul modului „pe rând": fișierul-sursă e bifat ca procesat
      // (inclusiv la „pending_review" — a fost consumat de generare; resetarea
      // progresului se face cu ↺ din panoul task-ului)
      if (g.sourceId) seqAppend.push(g.sourceId);
    }
  } catch (e) {
    run.error = String(e?.message || e || 'eroare necunoscută').slice(0, 900);
  }

  // avertismentul apare în istoric (și în email) chiar dacă rularea a reușit
  if (seqWarn) run.error = (run.error ? `${run.error} · ⚠️ ${seqWarn}` : `⚠️ ${seqWarn}`).slice(0, 900);
  const { data: inserted, error: insErr } = await supa.from('agent_task_runs').insert(run).select('id').single();
  if (insErr) {
    console.error('exgen runTask: insert agent_task_runs eșuat:', insErr.message);
    // Pt. „pending_review" rezultatul trăia DOAR în run.result → e pierdut.
    // Marcăm eroare ca să NU trimitem emailul „așteaptă aprobarea ta" spre o
    // coadă goală. Pt. „posted"/„skipped" efectul există deja pe site (doar
    // istoricul rulării lipsește), deci lăsăm statusul cum e.
    if (run.status === 'pending_review') {
      run.status = 'error';
      run.error = `Salvarea rulării a eșuat (rezultat pierdut): ${insErr.message}`.slice(0, 900);
    }
  }
  await supa.from('agent_tasks').update({
    last_run_at: startedAt,
    last_status: run.status,
    last_error: run.error,
    ...(seqAppend.length ? { seq_done: [...(Array.isArray(task.seq_done) ? task.seq_done : []), ...seqAppend] } : {}),
  }).eq('id', task.id);
  const emailed = await notifyAdmin({ task, run }).catch((e) => { console.warn('exgen: email eșuat:', e.message); return false; });

  return { ok: run.status !== 'error', runId: inserted?.id || null, run, usage, emailed };
}

// ─── Aprobarea manuală: postează rezultatul unei rulări „pending_review” ─────
async function postRun({ supa, runId }) {
  const { data: run, error } = await supa.from('agent_task_runs').select('*').eq('id', runId).single();
  if (error || !run) throw httpErr(404, 'Rularea nu a fost găsită.');
  if (run.status !== 'pending_review') throw httpErr(400, 'Doar rulările „așteaptă aprobare” se pot posta.');
  if (!run.result || (!run.result.html && !run.result.exercise)) throw httpErr(400, 'Rularea nu mai are rezultatul salvat.');
  const { data: task } = await supa.from('agent_tasks').select('*').eq('id', run.task_id).single();
  if (!task) throw httpErr(404, 'Task-ul rulării nu mai există.');

  const posted = await postContent({
    supa,
    title: run.title || `Test generat · ${task.name}`,
    // fără descrierea „Generat de agentul Claude…” pe site (cererea adminului)
    description: '',
    category: task.category, subcategory: task.subcategory, profile: task.profile,
    isFree: !!task.is_free,
    html: run.result.html || null, exercise: run.result.exercise || null,
    postType: task.post_type || 'test',
    taskId: task.id,
  });
  // eliberăm HTML-ul din istoric (exercițiul JSON rămâne pe rândul din `content`)
  await supa.from('agent_task_runs').update({ status: 'posted', content_id: posted.contentId, result: null }).eq('id', runId);
  return { contentId: posted.contentId, fileUrl: posted.fileUrl };
}

module.exports = {
  runAuto, normalize, renderExerciseHtml, postContent, runTask, postRun, notifyAdmin,
  storeFormatModel, removeFormatModel, loadFormatModel, fetchExtraContext,
  detectMode, titleMatchScore, fetchPairedContext, downloadStorage,
  // pentru teste (test/agent-tasks.test.js)
  figuresAllowed, stripFigures, itemSignals, missingSections, assertCompleteHtml, cutHtml,
  EXERCISE_SCHEMA, parseExercise, visibleSubcategory, chatClaudeLong, tplAnnotate, tplRestore,
};
