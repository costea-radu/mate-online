// =====================================================================
// api/_lib/lessonCheck.js — 🤖 BOTUL CARE VERIFICĂ LECȚIILE LIVE GENERATE
//
// Cererea lui Radu (26 oct. 2026): „fă un bot care să verifice dacă o lecție
// generată are sunet, întrebări pentru exerciții". Verificarea e DETERMINISTĂ
// (fără AI, fără cost) și se face pe lecția exact cum o primesc elevii (după
// loadLesson: grilele de EN refăcute, enunțurile ilizibile scoase):
//
//   1. SUNETUL — fiecare frază rostită are vocea generată (fișier + durată), iar
//      fișierul chiar există în Storage (live-media/lessons/<id>/); altfel elevul
//      aude vocea browserului (pe iPhone: voce de femeie, uneori nimic).
//   2. ÎNTREBĂRILE LA EXERCIȚII — fiecare exercițiu are cel puțin o întrebare pentru
//      elev; grilele au întrebarea pe ecran (4 variante + litera corectă); la
//      Subiectele II și III, fiecare subpunct (a, b, c) are întrebarea lui; fiecare
//      întrebare e validă (răspuns nevid, verificabil, nu se dă singură de gol).
//   3. ITEMII — toți itemii subiectului sunt în lecție, enunțurile se pot citi,
//      formulele se afișează, desenele din PDF sunt adăugate.
//   4. CRONOLOGIA — lecția se poate juca (grup și 1-la-1), fiecare întrebare are cheia.
//
// Rezultatul (raportul) stă în live_lessons.qa; îl arată Admin → 🎥 Meditații live →
// „🤖 Botul de verificare". `fix` la fiecare problemă = ce o repară (api/live.js):
//   voce   — vocea care lipsește se generează (din Admin; costă cât vocea obișnuită)
//   voce_refa — fișierele de voce pierdute din Storage / sunetul gol se refac (și singur, în cron)
//   pasi   — întrebările pe pași pentru subpunctele fără întrebare (din barem, gratuit;
//            din Admin și „✨ cu AI")
//   itemi  — itemii care lipsesc se scriu (AI, din Admin)
//   figuri — desenele din PDF se decupează din nou (gratuit)
//   regenereaza — doar lecția scrisă din nou o repară (din Admin, „Regenerează")
// =====================================================================
const live = require('./live');
const LL = require('./liveLesson');
const tts = require('./tts');
const mathcheck = require('./mathcheck');
let texRepair = null;
try { texRepair = require('./texRepair'); } catch { texRepair = null; }

const QA_V = 1;                 // versiunea verificărilor: o creștere le reface la toate lecțiile
const LEVELS = { grav: 3, major: 2, minor: 1, info: 0 };
const MIN_DUR = 0.15;           // o frază cu sunet mai scurt de atât e „goală"
const MAX_ISSUES = 60;

const fileOfUrl = (url) => { try { return decodeURIComponent(String(url || '').split('?')[0].split('/').pop() || ''); } catch { return ''; } };
const listRefs = (refs, n = 6) => (refs.length > n ? `${refs.slice(0, n).join(', ')} și încă ${refs.length - n}` : refs.join(', '));
const correctText = (p) => (p.type === 'grila' ? (p.options || [])['abcd'.indexOf(String(p.answer || '').toLowerCase())] || '' : String(p.answer || ''));
const UNREADABLE = /(nu\s+(sunt|este|e)\s+(lizibil|vizibil)|ilizibil|\[\s*formula|nu\s+se\s+(poate|pot)\s+citi)/;

// răspunsul așteptat e „text" (cuvinte), nu un număr / o expresie: serverul îl compară doar
// ca text, deci elevul care scrie altfel poate fi marcat greșit
function wordyAnswer(ans) {
  const t = String(ans || '').replace(/\\[a-zA-Z]+/g, ' ').replace(/\$/g, ' ');
  const words = (t.match(/[a-zA-ZăâîșțĂÂÎȘȚ]{4,}/g) || []).filter((w) => !/^(sqrt|frac|cdot|infty|left|right|pi)$/i.test(w));
  return words.length >= 2;
}

// ─── verificarea unei întrebări ───────────────────────────────────────────────
function pollProblems(p) {
  const out = [];
  if (!p || typeof p !== 'object') return ['lipsește'];
  if (!p.id) out.push('fără id (nu apare în sală)');
  if (!String(p.question || '').trim()) out.push('întrebarea e goală');
  if (p.type === 'grila') {
    const opts = Array.isArray(p.options) ? p.options : [];
    if (opts.length !== 4) out.push(`grila are ${opts.length} variante, nu 4`);
    if (opts.some((o) => !String(o || '').trim())) out.push('o variantă e goală');
    const norm = opts.map((o) => String(o || '').replace(/\s+/g, '').toLowerCase());
    if (new Set(norm).size !== norm.length) out.push('două variante sunt la fel');
    if (!/^[a-d]$/i.test(String(p.answer || '').trim())) out.push(`litera corectă lipsește („${String(p.answer || '').slice(0, 8)}")`);
  } else {
    const a = String(p.answer || '').trim();
    if (!a) out.push('răspunsul corect lipsește');
    else if (a.length > 80) out.push('răspunsul corect e prea lung pentru a fi scris de elev');
  }
  return out;
}

// ─── raportul unei lecții ─────────────────────────────────────────────────────
// lesson = { id, status, script, progress } (script-ul ca în sală — loadLesson)
// opts.files = Set cu numele fișierelor din Storage (lessons/<id>/) sau null (neverificat)
// opts.ttsOn = există o voce configurată (OpenAI / Azure)
// opts.needsFigures = desenele din PDF n-au fost încă adăugate
function checkLesson(lesson, { files = null, ttsOn = true, needsFigures = false, now = new Date() } = {}) {
  const issues = [];
  const add = (level, code, text, extra = {}) => { if (issues.length < MAX_ISSUES) issues.push({ level, code, text, ...extra }); };
  const script = lesson?.script;
  const progress = lesson?.progress || {};
  const status = lesson?.status || 'nou';
  const base = { v: QA_V, at: now.toISOString(), lessonId: lesson?.id || null, status, updatedAt: lesson?.updated_at || null };
  if (!script || !Array.isArray(script.items)) {
    add(status === 'eroare' ? 'grav' : 'info', 'fara_script', status === 'eroare' ? `Lecția nu s-a putut scrie: ${String(lesson?.error || '').slice(0, 160)}` : 'Lecția nu are încă textul scris (se scrie când intră primul elev).', status === 'eroare' ? { fix: 'regenereaza' } : {});
    return finish(base, issues, { sound: null, questions: null, items: { count: 0, missing: [] } });
  }
  const audio = progress.audio || {};
  const items = script.items || [];

  // ── 1. SUNETUL ──
  const heard = (s) => !!tts.speakable(s?.say);
  // fișierele se verifică doar în folderul lecției (lessons/<id>/), cu lista confirmată (confirmFiles)
  const own = ownUrl(lesson?.id);
  const lost = (a) => !!(a && a.url && files && own(a.url) && !files.has(fileOfUrl(a.url)));
  const okVoice = (s) => {
    const a = audio[s.id];
    if (!a || !a.url) return false;
    if (!(Number(a.dur) >= MIN_DUR)) return false;
    return !lost(a);
  };
  let total = 0, voiced = 0, zero = 0, lostFiles = 0, noLip = 0;
  const brokenIds = [];              // fișier pierdut / sunet gol → se regenerează
  const silentItems = [];            // itemii fără nicio frază cu voce
  const partialItems = [];
  const count = (segs) => {
    let t = 0, v = 0;
    for (const s of segs || []) {
      if (!heard(s)) continue;
      t++;
      const a = audio[s.id];
      if (lost(a)) { lostFiles++; brokenIds.push(s.id); }
      else if (a && a.url && !(Number(a.dur) >= MIN_DUR)) { zero++; brokenIds.push(s.id); }
      if (okVoice(s)) { v++; if (!a.lip) noLip++; }
    }
    return { t, v };
  };
  const g1 = count([...(script.intro || []), ...(script.qna || []), ...(script.breakSay || []), ...(script.outro || [])]);
  total += g1.t; voiced += g1.v;
  const byItem = [];
  for (const it of items) {
    const c = count(LL.itemSegments(it));
    total += c.t; voiced += c.v;
    byItem.push({ ref: it.ref, total: c.t, voiced: c.v });
    if (c.t && !c.v) silentItems.push(it.ref);
    else if (c.t && c.v < c.t) partialItems.push(it.ref);
  }
  const pct = total ? Math.round((100 * voiced) / total) : 100;
  const voicing = status === 'audio' || status === 'script';     // vocea e încă în lucru (o termină serverul)
  const mode = !ttsOn && !voiced ? 'browser' : voiced === 0 ? 'browser' : voiced < total ? 'partial' : 'generat';
  if (!ttsOn) add('major', 'fara_tts', 'Nu e configurată nicio voce (OPENAI_API_KEY sau AZURE_SPEECH_KEY în Vercel): lecțiile vorbesc cu vocea browserului — pe iPhone e o voce de femeie, iar pe unele telefoane nu se aude nimic.');
  if (lostFiles) add('grav', 'fisiere_lipsa', `${lostFiles} ${lostFiles === 1 ? 'fișier de voce lipsește' : 'fișiere de voce lipsesc'} din Storage: la ${lostFiles === 1 ? 'fraza aceea' : 'frazele acelea'} se aude vocea browserului (sau nimic).`, { fix: 'voce_refa' });
  if (zero) add('major', 'voce_goala', `${zero} ${zero === 1 ? 'frază are' : 'fraze au'} sunetul gol (sub ${MIN_DUR} s).`, { fix: 'voce_refa' });
  if (ttsOn && voiced === 0 && total > 0) {
    add(voicing ? 'info' : 'grav', voicing ? 'voce_in_lucru' : 'fara_voce', voicing
      ? 'Vocea lecției se generează acum (o termină singur serverul, la 15 minute).'
      : `Lecția nu are vocea generată (${total} fraze): vorbește vocea browserului — pe iPhone, voce de femeie; pe unele telefoane nu se aude nimic.`, voicing ? {} : { fix: 'voce' });
  } else if (ttsOn && voiced < total) {
    const missing = total - voiced - lostFiles - zero;
    if (missing > 0) {
      add(voicing ? 'info' : 'major', voicing ? 'voce_in_lucru' : 'voce_partiala', voicing
        ? `Vocea se generează: ${voiced} din ${total} fraze (${pct}%) — o termină singur serverul.`
        : `Vocea lipsește la ${missing} din ${total} fraze${silentItems.length ? ` — fără nicio voce: ${listRefs(silentItems)}` : partialItems.length ? ` (la ${listRefs(partialItems)})` : ''}.`, voicing ? {} : { fix: 'voce' });
    }
  }
  if (voiced > 0 && noLip > voiced * 0.2) add('minor', 'fara_buze', `${noLip} fraze n-au mișcarea gurii (profesorul vorbește cu gura închisă).`, { fix: 'voce' });
  const sound = { mode, total, voiced, pct, lostFiles, zero, filesChecked: !!files, silentItems, partialItems: partialItems.slice(0, 20), brokenIds: brokenIds.slice(0, 400), ok: ttsOn && voiced >= total && !lostFiles && !zero };

  // ── 2. ÎNTREBĂRILE LA EXERCIȚII ──
  const q = { items: items.length, withQuestion: 0, tries: 0, steps: 0, checks: 0, noQuestion: [], grilaNoTry: [], partsMissing: [], invalid: [] };
  for (const it of items) {
    const polls = live.itemPolls(it);
    if (it.tryPoll && it.tryPoll.id) q.tries++;
    if (it.check && it.check.id) q.checks++;
    q.steps += live.stepsFor(it).length;
    if (polls.length) q.withQuestion++;
    const isGrila = it.kind === 'grila' || (Array.isArray(it.options) && it.options.length === 4);
    if (!polls.length) {
      q.noQuestion.push(it.ref);
      add('major', 'fara_intrebare', `${it.title || it.ref}: exercițiul nu are nicio întrebare pentru elev (profesorul doar explică).`, { ref: it.ref, fix: LL.stepEligible(it) ? 'pasi' : 'regenereaza' });
    } else if (isGrila && !(it.tryPoll && it.tryPoll.type === 'grila' && it.tryPoll.id)) {
      q.grilaNoTry.push(it.ref);
      add('major', 'grila_fara_intrebare', `${it.title || it.ref}: grila n-are întrebarea pe ecran (cu variantele a–d) — elevul aude „alegeți răspunsul", dar nu are unde.`, { ref: it.ref, fix: 'regenereaza' });
    }
    // subpunctele (a, b, c) de la Subiectele II și III fără nicio întrebare
    const miss = LL.missingParts(it);
    if (miss.length && polls.length) {
      q.partsMissing.push({ ref: it.ref, parts: miss });
      add('major', 'pasi_lipsa', `${it.title || it.ref}: ${miss.filter(Boolean).length ? `subpunctele ${miss.filter(Boolean).map((p) => `${p})`).join(', ')} n-au` : 'subpunctul n-are'} nicio întrebare pentru elev.`, { ref: it.ref, fix: 'pasi' });
    }
    for (const p of polls) {
      const bad = pollProblems(p);
      const what = p === it.tryPoll ? 'întrebarea de început' : p === it.check ? 'verificarea' : 'întrebarea pe pas';
      if (bad.length) {
        q.invalid.push({ ref: it.ref, id: p.id || null, why: bad });
        add('major', 'intrebare_invalida', `${it.title || it.ref}, ${what}: ${bad.join('; ')}.`, { ref: it.ref, fix: p === it.tryPoll || p === it.check ? 'regenereaza' : 'pasi' });
        continue;
      }
      const val = correctText(p);
      if (val && LL.revealsAnswer(String(p.question || ''), val)) add('minor', 'dezvaluie', `${it.title || it.ref}, ${what}: întrebarea își conține răspunsul („${String(val).slice(0, 30)}").`, { ref: it.ref });
      if (p.type !== 'grila' && wordyAnswer(p.answer)) add('minor', 'raspuns_text', `${it.title || it.ref}, ${what}: răspunsul așteptat e un text („${String(p.answer).slice(0, 40)}") — se compară doar ca text, deci un elev care îl scrie altfel poate fi marcat greșit.`, { ref: it.ref });
      // răspunsul corect, scris SIMPLU de elev (ex. „1/2" pentru \frac{1}{2}, „2√3", „x^2+1"),
      // trebuie să treacă de verificarea automată — altfel elevul e marcat greșit deși are dreptate
      if (p.type !== 'grila' && val && !wordyAnswer(val)) {
        const plain = mathcheck.plainForm(val);
        if (plain && plain !== val && live.checkPollAnswer(p, plain, mathcheck.answersEquivalent) !== true) {
          add('minor', 'raspuns_greu', `${it.title || it.ref}, ${what}: răspunsul corect scris simplu („${plain.slice(0, 40)}") nu e recunoscut de verificarea automată — elevul trebuie să-l scrie exact ca „${String(val).slice(0, 40)}".`, { ref: it.ref });
        }
      }
    }
  }
  const questions = { ...q, ok: !q.noQuestion.length && !q.grilaNoTry.length && !q.partsMissing.length && !q.invalid.length };

  // ── 3. ITEMII ──
  const missing = Array.isArray(script.missing) ? script.missing : LL.missingGuess(script);
  if (items.length < 3) add('grav', 'prea_putini_itemi', `Lecția are doar ${items.length} ${items.length === 1 ? 'item' : 'itemi'}.`, { fix: 'regenereaza' });
  if (missing.length) add('major', 'itemi_lipsa', `Lipsesc itemii: ${listRefs(missing, 10)}.`, { fix: 'itemi', refs: missing });
  const unread = items.filter((it) => UNREADABLE.test(live.foldRo(String(it.statement || '')))).map((it) => it.ref);
  if (unread.length) add('major', 'enunt_ilizibil', `Enunțuri care nu se pot citi: ${listRefs(unread)}.`, { fix: 'regenereaza' });
  if (Number(script.v || 1) < 2) add('minor', 'fara_pagini', 'Lecția a fost scrisă fără paginile PDF — radicalii, fracțiile sau exponenții pot lipsi din enunțuri.', { fix: 'regenereaza' });
  if (texRepair && texRepair.brokenMath) {
    const broken = [];
    for (const it of items) {
      const texts = [it.statement, ...(LL.itemSegments(it).flatMap((s) => s.board || [])), ...live.itemPolls(it).flatMap((p) => [p.question, ...(p.options || [])])];
      if (texts.some((t) => texRepair.brokenMath(String(t || '')))) broken.push(it.ref);
    }
    if (broken.length) add('minor', 'formula_stricata', `Formule care nu se pot afișa (apar ca text): ${listRefs(broken)}.`, { fix: 'regenereaza' });
  }
  if (needsFigures) add('minor', 'desene', 'Desenele din PDF (problemele „în figura alăturată") încă nu sunt adăugate.', { fix: 'figuri' });

  // ── 4. CRONOLOGIA (lecția se poate juca, fiecare întrebare are cheia) ──
  try {
    for (const m of ['privat', 'grup']) {
      const tl = live.buildTimeline(script, audio, { mode: m });
      const keys = new Set();
      for (const it of items) for (const p of live.itemPolls(it)) keys.add(p.id);
      const orphan = (tl.scenes || []).filter((s) => s.type === 'sondaj' && (!s.poll || !s.poll.id || !keys.has(s.poll.id)));
      if (orphan.length) { add('grav', 'cronologie', `${orphan.length} întrebări din sală (${m}) n-au răspunsul corect în lecție.`, { fix: 'regenereaza' }); break; }
      if (!(tl.duration > 0)) { add('grav', 'cronologie', `Lecția (${m}) nu are durată — nu se poate juca.`, { fix: 'regenereaza' }); break; }
    }
  } catch (e) {
    add('grav', 'cronologie', `Lecția nu se poate juca: ${String(e.message || e).slice(0, 120)}.`, { fix: 'regenereaza' });
  }

  return finish(base, issues, { sound, questions, items: { count: items.length, missing, unreadable: unread } });
}

function finish(base, issues, parts) {
  issues.sort((a, b) => (LEVELS[b.level] || 0) - (LEVELS[a.level] || 0));
  const n = (lv) => issues.filter((i) => i.level === lv).length;
  const counts = { grav: n('grav'), major: n('major'), minor: n('minor'), info: n('info') };
  const score = Math.max(0, 100 - counts.grav * 35 - counts.major * 12 - counts.minor * 3);
  const fixes = [...new Set(issues.filter((i) => i.fix && i.level !== 'info').map((i) => i.fix))];
  const ok = !counts.grav && !counts.major;
  return {
    ...base, ok, score, counts, fixes, issues,
    summary: summaryOf(parts, counts),
    ...parts,
  };
}

// o linie pentru listă: „✓ sunet 100% · 24 întrebări" / „⚠ vocea lipsește la 12 fraze · 2 subpuncte fără întrebare"
function summaryOf({ sound, questions, items }, counts) {
  const bits = [];
  if (sound) bits.push(sound.ok ? `sunet ${sound.pct}%` : sound.mode === 'browser' ? 'fără voce generată' : `sunet ${sound.pct}%${sound.lostFiles ? ` (${sound.lostFiles} fișiere lipsă)` : ''}`);
  if (questions) {
    const nq = questions.tries + questions.steps + questions.checks;
    bits.push(`${nq} întrebări la ${questions.withQuestion}/${questions.items} exerciții`);
    if (questions.partsMissing.length) bits.push(`${questions.partsMissing.length} cu subpuncte fără întrebare`);
  }
  if (items?.missing?.length) bits.push(`lipsesc ${items.missing.length} itemi`);
  return `${!counts.grav && !counts.major ? '✓' : '⚠'} ${bits.join(' · ')}`;
}

// fișierele de voce ale unei lecții (numele din live-media/lessons/<id>/), în tranșe
async function storageFiles(supa, lessonId, { bucket = tts.BUCKET } = {}) {
  const b = supa.storage.from(bucket);
  const dir = `lessons/${lessonId}`;
  const names = new Set();
  for (let offset = 0, round = 0; round < 20; round++) {
    const { data, error } = await b.list(dir, { limit: 1000, offset });
    if (error) throw new Error(error.message);
    for (const f of data || []) if (f && f.name) names.add(f.name);
    if (!data || data.length < 1000) break;
    offset += data.length;
  }
  return names;
}

// Fișierele vocii unei lecții, verificate: Set-ul numelor din Storage — dar DOAR dacă lista e de
// încredere. Când lista spune că lipsesc fișiere, câteva (cel mult 4) se verifică și direct, cu o
// cerere HEAD pe adresa lor: abia dacă Storage răspunde „nu există" (400/404) e o pierdere
// adevărată; altfel (lista incompletă, rețeaua) → null = „nu verificăm fișierele acum" — botul nu
// pornește o regenerare a vocii pe o listă greșită.
const ownUrl = (lessonId) => (url) => String(url || '').includes(`/lessons/${lessonId}/`);
async function confirmFiles(supa, lesson, { fetchImpl = (typeof fetch === 'function' ? fetch : null), timeoutMs = 4000 } = {}) {
  const audio = lesson?.progress?.audio || {};
  const own = ownUrl(lesson?.id);
  const urls = Object.values(audio).map((a) => a && a.url).filter((u) => u && own(u));
  if (!urls.length) return null;
  let names;
  try { names = await storageFiles(supa, lesson.id); } catch { return null; }
  const missing = urls.filter((u) => !names.has(fileOfUrl(u)));
  if (!missing.length) return names;
  if (!fetchImpl) return null;
  const sample = missing.slice(0, 4).filter((u) => { try { return new URL(u).hostname.includes('.'); } catch { return false; } });
  if (!sample.length) return null;
  const codes = await Promise.all(sample.map((u) => fetchImpl(u, { method: 'HEAD', signal: AbortSignal.timeout(timeoutMs) }).then((r) => r.status).catch(() => 0)));
  return codes.every((c) => c === 400 || c === 404) ? names : null;
}

module.exports = { QA_V, LEVELS, checkLesson, pollProblems, storageFiles, confirmFiles, fileOfUrl, wordyAnswer, summaryOf };
