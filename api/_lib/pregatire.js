// =====================================================================
// api/_lib/pregatire.js — „PREGĂTIRE DE EXAMEN" (Planul meu), ca o meditație live
//
// Prof. Tudor pregătește elevul EXERCIȚIU CU EXERCIȚIU, în ordinea din examen:
//   Subiectul I ex. 1 → ex. 2 → … → ex. 6 → Subiectul al II-lea → al III-lea.
// La fiecare poziție (ex. „Subiectul I, exercițiul 1") ia DOAR exercițiile de pe
// acea poziție, din subiectele oficiale ale examenului elevului (EN sau BAC-ul
// profilului lui), explicate pe BAREMUL lor — itemii lecțiilor din meditațiile
// live (api/_lib/liveLesson.js: enunț, „încercați singuri", explicația pe barem,
// „Ai înțeles?" cu alte moduri, verificare).
//   · cel puțin PREP_EXERCITII (10) exerciții, câte unul din fiecare subiect;
//   · apoi un TEST DE VERIFICARE (exerciții noi, fără ajutor);
//   · promovat (≥ PREP_PRAG, 80%) → profesorul propune poziția următoare;
//     nepromovat → propune să mai rămână (încă PREP_IN_PLUS exerciții) și refacerea testului.
// Elevul poate continua oricât, poate cere testul oricând sau alege orice poziție.
//
// Progresul stă în ai_meditatii_sessions (fără tabele noi): un rând pe „bloc" de
// lucru și unul pe test, cu chapter = „pregatire:<examen>" și payload.prep —
// apar și în „Progresul meu" și în rapoartele pentru părinți/profesori.
//
// Aici: funcții pure (pozițiile, progresul, propunerile profesorului, cronologiile).
// Acțiunile HTTP sunt în api/live.js (prep_*). Teste: test/pregatire-examen.test.js.
// =====================================================================
const crypto = require('node:crypto');
const L = require('./live');
const LL = require('./liveLesson');

const envNum = (k, d) => { const v = parseFloat(process.env[k] || ''); return Number.isFinite(v) ? v : d; };

function settings() {
  return {
    target: Math.max(1, Math.round(envNum('PREP_EXERCITII', 10))),        // exerciții înainte de test
    testSingle: Math.max(1, Math.round(envNum('PREP_TEST_EXERCITII', 5))), // la itemii simpli (Subiectul I, grilele)
    testMulti: Math.max(1, Math.round(envNum('PREP_TEST_PROBLEME', 3))),   // la problemele cu a), b), c)
    pass: Math.min(1, Math.max(0.3, envNum('PREP_PRAG', 80) / 100)),       // pragul de promovare
    extra: Math.max(1, Math.round(envNum('PREP_IN_PLUS', 5))),             // câte în plus după un test nepromovat
  };
}

// ─── Examenul elevului (din „Planul meu") ─────────────────────────────────────
const TARGETS = {
  'evaluare-nationala': { exam: 'en', profile: null, label: 'Evaluarea Națională', spoken: 'Evaluarea Națională' },
  'bac-mate-info': { exam: 'bac', profile: 'mate-info', label: 'BAC Mate-Info', spoken: 'bacalaureat, profilul mate-info' },
  'bac-stiinte': { exam: 'bac', profile: 'stiinte-naturii', label: 'BAC Științele Naturii', spoken: 'bacalaureat, profilul științele naturii' },
  'bac-tehnologic': { exam: 'bac', profile: 'tehnologic', label: 'BAC Tehnologic', spoken: 'bacalaureat, profilul tehnologic' },
};
const examOf = (target) => (TARGETS[target] ? { target, ...TARGETS[target] } : null);
const chapterOf = (target) => `pregatire:${target}`;

// ─── Pozițiile din examen ─────────────────────────────────────────────────────
const SUB_LABEL = { I: 'Subiectul I', II: 'Subiectul al II-lea', III: 'Subiectul al III-lea' };
const SUB_SPOKEN = { I: 'Subiectul întâi', II: 'Subiectul al doilea', III: 'Subiectul al treilea' };
const SUB_SHORT = { I: 'S. I', II: 'S. II', III: 'S. III' };

function positions(exam) {
  const list = [];
  const add = (sub, ex, multi) => list.push({ pos: `${sub}.${ex}`, sub, ex, multi });
  for (let k = 1; k <= 6; k++) add('I', k, false);
  if (exam === 'en') {
    for (let k = 1; k <= 6; k++) add('II', k, false);
    for (let k = 1; k <= 6; k++) add('III', k, true);          // EN: problemele cu a), b)
  } else {
    for (const s of ['II', 'III']) for (let k = 1; k <= 2; k++) add(s, k, true);   // BAC: 2 probleme cu a), b), c)
  }
  return list.map((p, i) => ({
    ...p, index: i,
    label: `${SUB_LABEL[p.sub]}, exercițiul ${p.ex}`,
    short: `${SUB_SHORT[p.sub]} · ex. ${p.ex}`,
    spoken: `${SUB_SPOKEN[p.sub]}, exercițiul ${p.ex}`,
  }));
}
// ─── Subpunctele (alegerea elevului): „Subiectul al II-lea, exercițiul 2 b)" ──
// La BAC, problemele de la Subiectele II și III au cerințele a), b), c) — fiecare e
// un item separat în lecțiile pe barem („II.2.b"). Elevul poate exersa DOAR un
// subpunct (ex. doar III.1.c, din toate subiectele oficiale). Ordinea propusă de
// profesor rămâne cea a pozițiilor întregi; subpunctele sunt doar la alegere.
// (La EN, problemele de la Subiectul III sunt itemi întregi, cu a) și b) împreună.)
const LETTERS = ['a', 'b', 'c'];
function subPositions(exam) {
  if (exam === 'en') return [];
  const out = [];
  for (const p of positions(exam).filter((x) => x.multi)) {
    for (const l of LETTERS) {
      out.push({
        pos: `${p.pos}.${l}`, sub: p.sub, ex: p.ex, letter: l, parent: p.pos, multi: false, index: p.index,
        label: `${SUB_LABEL[p.sub]}, exercițiul ${p.ex} ${l})`,
        short: `${SUB_SHORT[p.sub]} · ex. ${p.ex} ${l})`,
        spoken: `${SUB_SPOKEN[p.sub]}, exercițiul ${p.ex}, punctul ${l}`,
      });
    }
  }
  return out;
}
const allPositions = (exam) => [...positions(exam), ...subPositions(exam)];
const positionOf = (exam, pos) => allPositions(exam).find((p) => p.pos === pos) || null;
// după un subpunct: următorul subpunct al aceleiași probleme, apoi poziția de după problemă
function nextPosition(exam, pos) {
  const ps = positions(exam);
  const sp = subPositions(exam).find((p) => p.pos === pos);
  if (sp) {
    const k = LETTERS.indexOf(sp.letter);
    if (k < LETTERS.length - 1) return positionOf(exam, `${sp.parent}.${LETTERS[k + 1]}`);
    pos = sp.parent;
  }
  const i = ps.findIndex((p) => p.pos === pos);
  return i >= 0 && i < ps.length - 1 ? ps[i + 1] : null;
}

// ─── Exercițiul de pe o poziție, dintr-un subiect (lecția lui pe barem) ───────
// „I.3" → itemul I.3; „III.1" → III.1 (sau III.1.a, III.1.b, … în ordine);
// „III.1.c" → doar subpunctul c) al problemei
function itemsAt(script, pos) {
  const [sub, exS, letter] = String(pos || '').split('.');
  const ex = parseInt(exS, 10);
  return (script?.items || [])
    .map((it) => ({ it, r: LL.parseRef(it.ref) }))
    .filter((x) => x.r && x.r.subject === sub && x.r.ex === ex && (!letter || x.r.letter === letter) && String(x.it.statement || '').trim())
    .sort((a, b) => String(a.r.letter || '').localeCompare(String(b.r.letter || '')))
    .map((x) => x.it);
}
const pollsOf = (items) => items.flatMap((it) => [it.tryPoll, it.check].filter((p) => p && p.id));

// id-uri unice în sală (același item „I.1" există în fiecare subiect): prefix din
// amprenta subiectului (nu din începutul id-ului — acela se poate repeta)
const nsOf = (sid) => `${L.shortId(`prep|${sid}`).slice(0, 9)}~`;
const splitNs = (id) => { const s = String(id || ''); const k = s.indexOf('~'); return k > 0 ? { ns: s.slice(0, k + 1), id: s.slice(k + 1) } : { ns: '', id: s }; };

function namespaced(items, sid) {
  const ns = nsOf(sid);
  const seg = (arr) => (arr || []).map((s) => ({ ...s, id: ns + s.id }));
  const poll = (p) => (p ? { ...p, id: ns + p.id } : null);
  return items.map((it) => ({
    ...it,
    intro: seg(it.intro), afterTry: seg(it.afterTry), afterCheck: seg(it.afterCheck),
    modes: Object.fromEntries(Object.entries(it.modes || {}).map(([k, v]) => [k, Array.isArray(v) ? seg(v) : v])),
    tryPoll: poll(it.tryPoll), check: poll(it.check),
  }));
}

const spokenTitle = (t) => String(t || 'un subiect oficial').replace(/[_]+/g, ' ').replace(/\.pdf$/i, '').replace(/\s+/g, ' ').trim().slice(0, 110);
const segOf = (id, say) => ({ id, say, board: [] });

// Cronologia unui EXERCIȚIU de antrenament (1-la-1: se oprește la întrebări și la
// „Ai înțeles?"), cu vocea browserului (Planul meu nu generează voce).
function exerciseTimeline({ items, sid, n, title }) {
  const ns = nsOf(sid);
  const script = {
    intro: [segOf(`${ns}pin${n}`, `Exercițiul ${n}, din ${spokenTitle(title)}.`)],
    items: namespaced(items, sid), qna: [], breakSay: [], outro: [],
  };
  return { ...L.buildTimeline(script, {}, { mode: 'privat' }), noVoice: true };
}

// Cronologia TESTULUI: enunțul și întrebarea fiecărui item, fără explicații și
// fără răspunsurile corecte (rezultatul îl spune profesorul la final)
function testTimeline(exercises, { introSay }) {
  const items = [];
  for (const e of exercises) items.push(...namespaced(e.items.filter((it) => it.tryPoll || it.check), e.sid));
  const script = { intro: [segOf(`ptest-${crypto.randomBytes(3).toString('hex')}`, introSay)], items, qna: [], breakSay: [], outro: [] };
  const tl = L.buildTimeline(script, {}, { mode: 'privat' });
  // la test nu se explică nimic: doar enunțul (proiectat) și întrebarea (fără barem, fără răspuns)
  const keep = tl.scenes.filter((s) => s.type === 'intro' || s.type === 'item' || s.type === 'sondaj');
  let t = 0;
  for (const s of keep) { s.t0 = Math.round(t * 1000) / 1000; t += s.dur; if (s.type === 'sondaj') s.test = true; }
  return { scenes: keep, duration: Math.round(t), noVoice: true, test: true };
}

// Explicațiile exercițiilor greșite la test: enunțul, explicația pe barem, „Ai înțeles?"
function reviewTimeline(exercises, { introSay }) {
  const items = [];
  for (const e of exercises) items.push(...namespaced(e.items, e.sid));
  const script = { intro: [segOf(`prev-${crypto.randomBytes(3).toString('hex')}`, introSay)], items, qna: [], breakSay: [], outro: [] };
  const tl = L.buildTimeline(script, {}, { mode: 'privat' });
  const keep = tl.scenes.filter((s) => !['sondaj', 'rezultate'].includes(s.type));
  let t = 0;
  for (const s of keep) { s.t0 = Math.round(t * 1000) / 1000; t += s.dur; }
  return { scenes: keep, duration: Math.round(t), noVoice: true };
}

// ─── Progresul elevului, din rândurile lui (ai_meditatii_sessions) ────────────
// rows: [{ id, status, score, max_score, created_at, prep: { pos, mode, ex[], items[], answers{}, … } }]
function progressFrom(rows, exam) {
  const S = settings();
  const byPos = new Map(allPositions(exam).map((p) => [p.pos, {
    pos: p.pos, done: 0, correct: 0, total: 0, used: new Set(), tests: [], lastAt: null,
  }]));
  const sorted = (rows || []).filter((r) => r && r.prep && byPos.has(r.prep.pos))
    .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
  let last = null;
  for (const r of sorted) {
    const g = byPos.get(r.prep.pos);
    if (r.prep.mode === 'test') {
      for (const it of r.prep.items || []) g.used.add(it.sid);
      if (r.status === 'finalizata' && r.prep.result) {
        g.tests.push({ at: r.completed_at || r.created_at, correct: r.prep.result.correct, total: r.prep.result.total, passed: !!r.prep.result.passed, doneBefore: r.prep.doneBefore ?? g.done });
      }
    } else {
      for (const e of r.prep.ex || []) {
        if (!e.done) continue;
        g.done++; g.used.add(e.sid);
        const polls = Object.values(e.polls || {});
        g.correct += polls.filter((x) => x.correct).length;
        g.total += polls.length;
      }
    }
    g.lastAt = r.created_at;
    last = r.prep.pos;
  }
  const out = {};
  for (const [pos, g] of byPos) {
    const lastTest = g.tests[g.tests.length - 1] || null;
    const failed = g.tests.filter((t) => !t.passed);
    const lastFailed = lastTest && !lastTest.passed ? lastTest : null;
    const nextTestAt = lastFailed ? Math.max(S.target, (lastFailed.doneBefore || 0) + S.extra) : S.target;
    out[pos] = {
      pos, done: g.done, correct: g.correct, total: g.total, used: [...g.used],
      tests: g.tests.length, failedTests: failed.length, lastTest, nextTestAt,
      mastered: !!(lastTest && lastTest.passed),
      status: lastTest && lastTest.passed ? 'stapanit' : (g.done || g.tests.length) ? 'in_lucru' : 'nou',
      lastAt: g.lastAt,
    };
  }
  return { byPos: out, lastPos: last };
}

// Poziția pe care o propune profesorul: cea la care a lucrat ultima dată (dacă nu
// a trecut încă testul), altfel prima netrecută, în ordinea din examen; cu toate
// trecute → recapitulare la cea cu cel mai slab test.
function currentPosition(exam, prog) {
  const ps = positions(exam);
  const last = prog.lastPos ? prog.byPos[prog.lastPos] : null;
  if (last && !last.mastered && positionOf(exam, prog.lastPos)) return { pos: positionOf(exam, prog.lastPos), allDone: false };
  const open = ps.find((p) => !prog.byPos[p.pos]?.mastered);
  if (open) return { pos: open, allDone: false };
  const weakest = ps.slice().sort((a, b) => {
    const ta = prog.byPos[a.pos].lastTest, tb = prog.byPos[b.pos].lastTest;
    return (ta.correct / Math.max(1, ta.total)) - (tb.correct / Math.max(1, tb.total));
  })[0];
  return { pos: weakest, allDone: true };
}

const testSize = (p) => { const S = settings(); return p?.multi ? S.testMulti : S.testSingle; };
const pct = (c, t) => (t ? Math.round((100 * c) / t) : 0);
const exWord = (n) => (n === 1 ? 'un exercițiu' : `${n} exerciții`);

// ─── Ce PROPUNE profesorul (rostit + variantele de pe ecran) ──────────────────
// options: [{ key, label, primary?, pos? }] — key: next | test | advance | stay | review | choose | end
function proposeWelcome({ exam, target, prog, name = null }) {
  const S = settings();
  const E = examOf(target) || { spoken: exam === 'en' ? 'Evaluarea Națională' : 'bacalaureat' };
  const { pos: cur, allDone } = currentPosition(exam, prog);
  const st = prog.byPos[cur.pos];
  const nxt = nextPosition(exam, cur.pos);
  const hi = name ? `, ${name}` : '';
  const first = !Object.values(prog.byPos).some((g) => g.done || g.tests);
  if (first) {
    return {
      pos: cur.pos,
      say: `Bună${hi}! Ne pregătim împreună pentru ${E.spoken}, exercițiu cu exercițiu, exact în ordinea din examen. Începem cu ${cur.spoken}: rezolvăm cel puțin ${S.target} exerciții de acest tip, din subiectele oficiale, și le explicăm pe barem. Apoi un test scurt îmi arată dacă putem trece mai departe. Începem?`,
      options: [
        { key: 'next', label: `▶ Da, începem cu ${cur.label}`, primary: true, pos: cur.pos },
        { key: 'test', label: '🧪 Întâi un test (să vezi ce știi deja)', pos: cur.pos },
        { key: 'choose', label: '🗺️ Aleg eu exercițiul' },
      ],
    };
  }
  if (allDone) {
    return {
      pos: cur.pos,
      say: `Bine ai revenit${hi}! Ai trecut testele la toate exercițiile din examen. Bravo! Îți propun o recapitulare la ${cur.spoken}, unde testul a ieșit cel mai slab.`,
      options: [
        { key: 'next', label: `▶ Da, recapitulăm ${cur.label}`, primary: true, pos: cur.pos },
        { key: 'test', label: `🧪 Refac testul la ${cur.short}`, pos: cur.pos },
        { key: 'choose', label: '🗺️ Aleg eu exercițiul' },
      ],
    };
  }
  const lt = st.lastTest;
  const testLine = lt && !lt.passed ? `, iar la testul de data trecută ai avut ${lt.correct} din ${lt.total}` : '';
  if (st.done >= st.nextTestAt) {
    return {
      pos: cur.pos,
      say: `Bine ai revenit${hi}! La ${cur.spoken} ai lucrat deja ${exWord(st.done)}${testLine}. E momentul testului de verificare: ${exWord(testSize(cur))}, fără ajutor.${nxt ? ` Dacă iese bine, trecem la ${nxt.spoken}.` : ''}`,
      options: [
        { key: 'test', label: '🧪 Da, dau testul', primary: true, pos: cur.pos },
        { key: 'next', label: '▶ Încă un exercițiu întâi', pos: cur.pos },
        { key: 'choose', label: '🗺️ Aleg alt exercițiu' },
      ],
    };
  }
  return {
    pos: cur.pos,
    say: `Bine ai revenit${hi}! Suntem la ${cur.spoken}: ai lucrat ${st.done} din ${st.nextTestAt} exerciții${testLine}. Continuăm cu următorul?`,
    options: [
      { key: 'next', label: '▶ Da, următorul exercițiu', primary: true, pos: cur.pos },
      ...(st.done >= 3 ? [{ key: 'test', label: '🧪 Dau testul acum', pos: cur.pos }] : []),
      { key: 'choose', label: '🗺️ Aleg alt exercițiu' },
    ],
  };
}

function proposeAfterExercise({ exam, pos, prog, result = null }) {
  const p = positionOf(exam, pos);
  const st = prog.byPos[pos];
  const nxt = nextPosition(exam, pos);
  let fb = 'Gata și acest exercițiu.';
  if (result && result.total > 0) {
    fb = result.correct === result.total ? 'Foarte bine, totul corect!'
      : result.correct === 0 ? 'De data asta n-a ieșit — uită-te încă o dată la pașii din barem, de pe tablă.'
        : `Ai avut ${result.correct} din ${result.total} răspunsuri corecte — reține pașii din barem.`;
  }
  if (st.mastered) {
    return {
      pos,
      say: `${fb} Ai trecut deja testul la ${p.spoken}.${nxt ? ` Mergem mai departe, la ${nxt.spoken}?` : ' Alegem alt exercițiu?'}`,
      options: [
        ...(nxt ? [{ key: 'advance', label: `⏭ Da, la ${nxt.label}`, primary: true, pos: nxt.pos }] : []),
        { key: 'next', label: '▶ Încă un exercițiu aici', primary: !nxt, pos },
        { key: 'choose', label: '🗺️ Aleg alt exercițiu' },
        { key: 'end', label: '🏁 Ajunge pentru azi' },
      ],
    };
  }
  if (st.done >= st.nextTestAt) {
    return {
      pos,
      say: `${fb} Ai lucrat ${exWord(st.done)} de acest tip. Hai să vedem cât de bine le stăpânești: un test scurt, de ${exWord(testSize(p))}, fără ajutor.${nxt ? ` Dacă iese bine, trecem la ${nxt.spoken}.` : ''}`,
      options: [
        { key: 'test', label: '🧪 Da, testul de verificare', primary: true, pos },
        { key: 'next', label: '▶ Încă un exercițiu întâi', pos },
        { key: 'end', label: '🏁 Ajunge pentru azi' },
      ],
    };
  }
  return {
    pos,
    say: `${fb} Am terminat exercițiul ${st.done} din ${st.nextTestAt}. Mergem mai departe?`,
    options: [
      { key: 'next', label: `▶ Următorul exercițiu (${st.done + 1} din ${st.nextTestAt})`, primary: true, pos },
      ...(st.done >= 3 ? [{ key: 'test', label: '🧪 Dau testul acum', pos }] : []),
      { key: 'end', label: '🏁 Ajunge pentru azi' },
    ],
  };
}

function proposeAfterTest({ exam, pos, result, prog }) {
  const S = settings();
  const p = positionOf(exam, pos);
  const nxt = nextPosition(exam, pos);
  const line = `Ai rezolvat corect ${result.correct} din ${result.total}${result.total ? `, adică ${pct(result.correct, result.total)} la sută` : ''}.`;
  const wrong = result.total - result.correct;
  if (result.passed) {
    return {
      pos,
      say: nxt
        ? `${line} Foarte bine! Stăpânești ${p.spoken}. Trecem la ${nxt.spoken}?`
        : `${line} Foarte bine! Ai ajuns la ultimul exercițiu din examen și l-ai trecut. Alegem ce recapitulăm?`,
      options: [
        ...(nxt ? [{ key: 'advance', label: `⏭ Da, la ${nxt.label}`, primary: true, pos: nxt.pos }] : [{ key: 'choose', label: '🗺️ Aleg ce recapitulăm', primary: true }]),
        ...(wrong > 0 ? [{ key: 'review', label: wrong === 1 ? '🔍 Vezi ce ai greșit' : `🔍 Vezi cele ${wrong} greșite`, pos }] : []),
        { key: 'stay', label: '🔁 Mai rămân la acest exercițiu', pos },
        { key: 'end', label: '🏁 Ajunge pentru azi' },
      ],
    };
  }
  const st = prog?.byPos?.[pos];
  const more = st ? Math.max(1, st.nextTestAt - st.done) : S.extra;
  return {
    pos,
    say: `${line} Mai exersăm puțin: îți propun încă ${exWord(more)} la ${p.spoken}, apoi refacem testul.${wrong > 0 ? ' Dacă vrei, îți explic întâi ce ai greșit.' : ''}`,
    options: [
      { key: 'stay', label: '🔁 Da, mai rămânem', primary: true, pos },
      ...(wrong > 0 ? [{ key: 'review', label: '🔍 Explică-mi ce am greșit', pos }] : []),
      ...(nxt ? [{ key: 'advance', label: `⏭ Trec totuși la ${nxt.label}`, pos: nxt.pos }] : []),
      { key: 'end', label: '🏁 Ajunge pentru azi' },
    ],
  };
}

function proposeExhausted({ exam, pos, prog }) {
  const p = positionOf(exam, pos);
  const nxt = nextPosition(exam, pos);
  const st = prog.byPos[pos];
  const say = st.mastered
    ? `Am lucrat toate exercițiile de acest tip pe care le am din subiectele oficiale, iar testul l-ai trecut.${nxt ? ` Trecem la ${nxt.spoken}?` : ''}`
    : `Am lucrat toate exercițiile de acest tip pe care le am acum din subiectele oficiale. Hai să dăm testul de verificare la ${p.spoken}.`;
  return {
    pos,
    say,
    options: st.mastered
      ? [...(nxt ? [{ key: 'advance', label: `⏭ Da, la ${nxt.label}`, primary: true, pos: nxt.pos }] : []), { key: 'choose', label: '🗺️ Aleg alt exercițiu', primary: !nxt }, { key: 'end', label: '🏁 Ajunge pentru azi' }]
      : [{ key: 'test', label: '🧪 Da, testul', primary: true, pos }, ...(nxt ? [{ key: 'advance', label: `⏭ Trec la ${nxt.label}`, pos: nxt.pos }] : []), { key: 'end', label: '🏁 Ajunge pentru azi' }],
  };
}

// ─── Alegerea subiectelor ─────────────────────────────────────────────────────
// Ordinea în care vin subiectele e amestecată, dar stabilă pentru fiecare elev și
// poziție (doi elevi nu primesc exact același șir; la reluare, același elev da).
function orderSubjects(list, seed) {
  const h = (id) => crypto.createHash('sha1').update(`${seed}|${id}`).digest().readUInt32BE(0);
  return list.slice().sort((a, b) => (Number(!!b.full) - Number(!!a.full)) || (h(a.id) - h(b.id)));
}

// Rezultatul testului (răspunsurile înregistrate pe server)
function gradeTest(prep) {
  const S = settings();
  const ids = (prep.items || []).flatMap((e) => e.polls || []);
  const answers = prep.answers || {};
  const correct = ids.filter((id) => answers[id]?.correct).length;
  const total = ids.length;
  const wrongSids = (prep.items || []).filter((e) => (e.polls || []).some((id) => !answers[id]?.correct)).map((e) => e.sid);
  return { correct, total, passed: total > 0 && correct / total >= S.pass - 1e-9, wrongSids };
}

// Rezumatul progresului pentru interfață (lista pozițiilor; subpunctele au `parent`)
function publicProgress(exam, prog) {
  return allPositions(exam).map((p) => {
    const g = prog.byPos[p.pos];
    return {
      pos: p.pos, label: p.label, short: p.short, spoken: p.spoken, sub: p.sub, ex: p.ex, multi: p.multi, letter: p.letter || null, parent: p.parent || null,
      done: g.done, nextTestAt: g.nextTestAt, correct: g.correct, total: g.total,
      status: g.status, mastered: g.mastered, tests: g.tests,
      lastTest: g.lastTest ? { correct: g.lastTest.correct, total: g.lastTest.total, passed: g.lastTest.passed, at: g.lastTest.at } : null,
    };
  });
}

module.exports = {
  settings, TARGETS, examOf, chapterOf, positions, subPositions, allPositions, positionOf, nextPosition, itemsAt, pollsOf,
  nsOf, splitNs, namespaced, exerciseTimeline, testTimeline, reviewTimeline, spokenTitle,
  progressFrom, currentPosition, testSize, proposeWelcome, proposeAfterExercise, proposeAfterTest, proposeExhausted,
  orderSubjects, gradeTest, publicProgress,
};
