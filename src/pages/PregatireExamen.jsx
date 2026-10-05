// =====================================================================
// src/pages/PregatireExamen.jsx — „PREGĂTIRE DE EXAMEN" (Planul meu → ca o
// meditație live). Ruta: /meditatii/pregatire
//
// Aceeași clasă ca la meditațiile live (fotografia, Prof. Tudor animat, scrisul
// pe tabla din spatele lui, exercițiul proiectat, vocea browserului, subtitrările,
// chatul, caietul, ecranul complet) — doar că aici PROFESORUL PROPUNE desfășurarea:
//   · exercițiu cu exercițiu, în ordinea din examen: Subiectul I ex. 1, ex. 2, … ex. 6,
//     apoi Subiectul al II-lea și al III-lea (la BAC: problemele II.1, II.2, III.1, III.2);
//   · la fiecare poziție, doar exercițiile de pe ACEA poziție, din subiectele
//     oficiale ale examenului elevului, explicate pe baremul lor (încearcă singur →
//     rezultatul → rezolvarea pe barem, scrisă pe tablă → „Ai înțeles?" → verificare);
//   · după cel puțin 10 exerciții, un TEST DE VERIFICARE (fără ajutor), apoi profesorul
//     propune: mai departe (promovat) sau încă 5 exerciții și testul din nou;
//   · elevul poate continua oricât, cere testul oricând sau alege altă poziție (🗺️);
//   · ALEGEREA ELEVULUI: poate începe cu ORICE exercițiu, nu neapărat la rând — la
//     intrare („Cu ce începi?"), în „🗺️ Plan" sau din „Planul meu" (/meditatii/pregatire?pos=II.2.b);
//     la BAC, problemele de la Subiectele II și III se pot exersa și pe subpuncte (a, b, c);
//   · fără limită de timp: lucrează cât vrea (peste 60 de minute, continuăm până termină).
// Serverul: api/live.js (prep_*) + api/_lib/pregatire.js. Progresul: „Planul meu".
// =====================================================================
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { liveApi } from '../lib/live/api';
import { clock } from '../lib/live/clock';
import { AudioEngine } from '../lib/live/audio';
import { PrivatePlayer, estimateSpeechSec } from '../lib/live/player';
import { loadRig, initials, teacherColor } from '../lib/live/profesori';
import { sceneInset } from '../lib/live/framing';
import { enterFs, exitFs, toggleFs as toggleFullscreen, fsSupported, useIsFullscreen } from '../lib/live/fullscreen';
import TeacherCamera from '../components/live/TeacherCamera';
import ScenePan, { useSceneFocus, useMedia, LANDSCAPE_SHORT } from '../components/live/ScenePan';
import { WhiteboardInk, DigitalScreen } from '../components/live/Board';
import { PollCard, UnderstandCard, ChoiceCard, pollKicker } from '../components/live/PollCard';
import { LiveChat } from '../components/live/LiveChat';
import SpatiuDeLucru from '../components/SpatiuDeLucru';
import PrepPicker from '../components/live/PrepPicker';
import { startDictation, speechRecognitionSupported } from '../lib/voice';
import '../styles/live.css';

const STATUS_BADGE = {
  stapanit: { label: '✓ Stăpânit', cls: 'is-ok' },
  in_lucru: { label: 'În lucru', cls: 'is-work' },
  nou: { label: 'De început', cls: '' },
};
let sayN = 0;

export default function PregatireExamen() {
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const wantPos = searchParams.get('pos');            // din „Planul meu": exercițiul ales de elev

  const [st, setSt] = useState(null);                 // răspunsul prep_state
  const [fatal, setFatal] = useState(null);           // { text, code }
  const [joined, setJoined] = useState(false);
  const [wantFs, setWantFs] = useState(() => typeof window !== 'undefined' && !!window.matchMedia?.('(pointer: coarse)').matches);
  const isFullscreen = useIsFullscreen();
  const canFs = fsSupported();
  const [rig, setRig] = useState(null);
  const [rigLoaded, setRigLoaded] = useState(false);

  const [phase, setPhase] = useState('propune');      // propune | pregateste | exercitiu | test | recap | final
  const [proposal, setProposal] = useState(null);
  const [busyText, setBusyText] = useState(null);
  const [ex, setEx] = useState(null);                 // { rowId, exercise, timeline }
  const [test, setTest] = useState(null);             // { rowId, test, timeline }
  const [review, setReview] = useState(null);         // cronologia explicațiilor pentru greșelile de la test
  const [lastResult, setLastResult] = useState(null); // rezultatul ultimului test
  const [showResult, setShowResult] = useState(false); // proiecția arată rezultatul testului
  const [positions, setPositions] = useState([]);
  const [curPos, setCurPos] = useState(null);
  const [pick, setPick] = useState(null);             // exercițiul ales la intrare (null = cum propune profesorul)

  const [ps, setPs] = useState(null);                 // starea playerului
  const [myAnswers, setMyAnswers] = useState({});
  const [verdicts, setVerdicts] = useState({});
  const [explains, setExplains] = useState({});
  const [panel, setPanel] = useState(null);           // 'chat' | 'plan'
  const [messages, setMessages] = useState([]);
  const [pendingAnswer, setPendingAnswer] = useState(false);
  const [prefill, setPrefill] = useState(null);
  const [speech, setSpeech] = useState(null);         // ce spune profesorul în afara lecției (propunerile)
  const [cc, setCc] = useState(true);
  const [notebook, setNotebook] = useState(false);
  const [micOn, setMicOn] = useState(false);
  const [heard, setHeard] = useState('');
  const [narrow, setNarrow] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [toast, setToast] = useState(null);
  const [voiceHint, setVoiceHint] = useState(null);

  const roomRef = useRef(null);
  const engineRef = useRef(null);
  const playerRef = useRef(null);
  const startedRef = useRef(Date.now());
  const finishedRef = useRef(null);                   // cronologia deja încheiată (o singură dată)
  const speechTimer = useRef(null);
  const phaseRef = useRef(phase);
  useEffect(() => { phaseRef.current = phase; }, [phase]);

  if (!engineRef.current && typeof window !== 'undefined') engineRef.current = new AudioEngine();
  const engine = engineRef.current;
  const teacher = st?.teacher || { id: 'radu', name: 'Prof. Tudor', gender: 'm' };
  const exam = st?.exam;
  const posInfo = (pos) => positions.find((p) => p.pos === pos) || null;
  const cur = posInfo(curPos);
  const mainPositions = positions.filter((p) => !p.parent);   // subpunctele (a, b, c) au `parent`
  const spokenOf = (p) => (p ? p.spoken || p.label : 'exercițiul ales');

  const flash = useCallback((t) => { setToast(t); setTimeout(() => setToast((x) => (x === t ? null : x)), 3800); }, []);

  // ─── 1. starea (examenul elevului, pozițiile, propunerea de început) ────────
  const load = useCallback(async () => {
    try {
      const r = await liveApi.prepState();
      setSt(r); setPositions(r.positions || []); setProposal(r.proposal || null); setCurPos(r.current || null);
      if (wantPos && (r.positions || []).some((p) => p.pos === wantPos)) setPick(wantPos);
    } catch (e) {
      if (e.status === 401) setFatal({ text: 'Intră în cont ca să începi pregătirea de examen.', code: 'LOGIN' });
      else setFatal({ text: e.message || 'Nu am putut porni pregătirea.', code: e.code || null });
    }
  }, [wantPos]);
  useEffect(() => {
    if (authLoading) return;
    if (!user) { setFatal({ text: 'Intră în cont ca să începi pregătirea de examen.', code: 'LOGIN' }); return; }
    load();
  }, [authLoading, user, load]);
  useEffect(() => { loadRig('radu').then((r) => { setRig(r); setRigLoaded(true); }); }, []);
  useEffect(() => () => { playerRef.current?.stop(); engine?.close(); clearTimeout(speechTimer.current); }, [engine]);

  // ─── 2. vocea profesorului în afara lecției (propunerile, salutul) ──────────
  const stopSpeech = useCallback(() => {
    clearTimeout(speechTimer.current);
    engine?.stopAll(null, { hard: true });
    setSpeech(null);
  }, [engine]);
  // se aude tot textul; subtitrarea arată fraza care se spune acum (ca la lecție)
  const say = useCallback((text) => {
    if (!text || !engine) return;
    playerRef.current?.stop();
    engine.stopAll(null, { hard: true });
    const dur = estimateSpeechSec(text);
    const id = ++sayN;
    engine.play(`prep-say-${id}`, { url: null, atServerMs: clock.now() + 120, dur, text });
    const parts = String(text).split(/(?<=[.!?])\s+(?=[A-ZĂÂÎȘȚ„0-9])/).filter(Boolean);
    const lens = parts.map((p) => estimateSpeechSec(p));
    const total = lens.reduce((a, b) => a + b, 0) || 1;
    clearTimeout(speechTimer.current);
    let k = 0;
    const next = () => {
      if (k >= parts.length) { setSpeech(null); return; }
      setSpeech({ id, text: parts[k] });
      speechTimer.current = setTimeout(next, (lens[k] / total) * dur * 1000 + (k === parts.length - 1 ? 600 : 0));
      k++;
    };
    next();
  }, [engine]);

  function propose(p, lead = null) {
    if (!p) return;
    setProposal(p);
    setPhase('propune');
    if (p.pos) setCurPos(p.pos);
    say([lead, p.say].filter(Boolean).join(' '));
  }

  // ─── 3. intrarea (gestul elevului deblochează sunetul) ──────────────────────
  function onJoin() {
    engine.unlock();
    if (wantFs && roomRef.current) enterFs(roomRef.current);
    setJoined(true);
    // elevul a ales exercițiul (nu neapărat la rând): începem direct cu el
    const chosen = pick ? posInfo(pick) : null;
    const name = st?.me?.name ? `, ${st.me.name}` : '';
    if (chosen) setTimeout(() => startExercise(chosen.pos, { lead: `Bună${name}! Începem cu ${spokenOf(chosen)}, cum ai ales.` }), 350);
    else setTimeout(() => propose(proposal), 350);
  }
  // fără voce românească în browser: spunem de ce tace (ca în sala live)
  useEffect(() => {
    if (!joined) return undefined;
    let hide = null;
    const t = setTimeout(() => {
      const v = engine.voiceStatus();
      if (v.status === 'ok') return;
      setVoiceHint(v.status === 'fara'
        ? 'Browserul acesta nu poate citi cu voce tare — urmărește subtitrările. Pentru voce, deschide pagina în Chrome sau Microsoft Edge.'
        : 'Browserul tău nu are o voce în limba română, așa că profesorul vorbește prin subtitrări. Pentru voce: Microsoft Edge (voce naturală, gratuită) sau vocea română din Windows (Setări → Oră și limbă → Vorbire).');
      hide = setTimeout(() => setVoiceHint(null), 15000);   // se închide și singur (pe telefon acoperea exercițiul)
    }, 1800);
    return () => { clearTimeout(t); clearTimeout(hide); };
  }, [joined, engine]);

  // ─── 4. playerul (un exercițiu, testul sau explicațiile greșelilor) ─────────
  function play(timeline) {
    stopSpeech();
    playerRef.current?.stop();
    const p = new PrivatePlayer({ engine, onState: setPs });
    playerRef.current = p;
    finishedRef.current = null;
    setPs(null); setMyAnswers({}); setVerdicts({}); setExplains({});
    p.setTimeline(timeline);
    p.start();
    startedRef.current = Date.now();
  }
  const secsSinceStart = () => Math.round((Date.now() - startedRef.current) / 1000);

  async function busyWhile(text, fn) {
    setBusyText(text);
    const slow = setTimeout(() => setBusyText(`${teacher.name} citește un subiect oficial nou și baremul lui, ca să-ți explice exercițiul pe barem. Durează 1–2 minute, doar prima dată — apoi e gata pentru toți.`), 5000);
    try { return await fn(); }
    finally { clearTimeout(slow); setBusyText(null); }
  }

  // fraza de trecere („Bine, trecem la…") se aude întreagă, apoi începe exercițiul
  const leadUntil = useRef(0);
  const waitLead = () => new Promise((ok) => setTimeout(ok, Math.max(0, leadUntil.current - Date.now())));
  function lead(text) { if (!text) return; say(text); leadUntil.current = Date.now() + estimateSpeechSec(text) * 1000 + 200; }

  async function startExercise(pos, { skip = null, lead: leadText = null } = {}) {
    stopSpeech();
    setPhase('pregateste'); setCurPos(pos); setReview(null); setShowResult(false);
    lead(leadText);
    try {
      const r = await busyWhile(`${teacher.name} alege exercițiul…`, () => liveApi.prepExercise(pos, { skip }));
      if (r.positions) setPositions(r.positions);
      if (r.exhausted) { propose(r.proposal); return; }
      await waitLead();
      setEx(r); setTest(null);
      setPhase('exercitiu');
      play(r.timeline);
      // următorul exercițiu se pregătește din timp (o lecție nouă se scrie în 1–3 minute)
      liveApi.prepPrefetch(pos, r.exercise.sid).catch(() => {});
    } catch (e) {
      flash(e.message);
      setPhase('propune');
    }
  }

  async function startTest(pos) {
    stopSpeech();
    setPhase('pregateste'); setCurPos(pos); setReview(null); setShowResult(false);
    try {
      const r = await busyWhile(`${teacher.name} pregătește testul de verificare…`, () => liveApi.prepTest(pos));
      setTest(r); setEx(null);
      setPhase('test');
      play(r.timeline);
    } catch (e) {
      flash(e.message);
      setPhase('propune');
    }
  }

  function playReview() {
    if (!review) return;
    setPhase('recap');
    play(review);
  }

  function endSession() {
    playerRef.current?.stop();
    setPhase('final');
    say(`Ai lucrat foarte bine azi. Data viitoare continuăm de aici${cur ? `, de la ${cur.label}` : ''}. Spor la învățat!`);
  }

  function choose(o) {
    if (!o) return;
    switch (o.key) {
      case 'next': case 'stay': startExercise(o.pos || curPos); break;
      case 'advance': startExercise(o.pos, { lead: `Bine! Trecem la ${posInfo(o.pos) ? spokenOf(posInfo(o.pos)) : 'exercițiul următor'}.` }); break;
      case 'test': startTest(o.pos || curPos); break;
      case 'review': playReview(); break;
      case 'choose': setPanel('plan'); say('Alege din listă exercițiul la care vrei să lucrăm, în orice ordine.'); break;
      case 'end': endSession(); break;
      default: break;
    }
  }

  // sfârșitul cronologiei (o singură dată pe cronologie)
  useEffect(() => {
    if (ps?.phase !== 'final') return;
    const tl = playerRef.current?.tl;
    if (!tl || finishedRef.current === tl) return;
    finishedRef.current = tl;
    const secs = secsSinceStart();
    if (phaseRef.current === 'exercitiu' && ex) {
      liveApi.prepDone(ex.rowId, ex.exercise.sid, secs)
        .then((r) => { setPositions(r.positions || []); propose(r.proposal); })
        .catch((e) => { flash(e.message); setPhase('propune'); });
    } else if (phaseRef.current === 'test' && test) {
      busyWhile(`${teacher.name} corectează testul…`, () => liveApi.prepTestFinish(test.rowId, secs))
        .then((r) => {
          setPositions(r.positions || []); setReview(r.review || null); setLastResult(r.result); setShowResult(true);
          propose(r.proposal);
        })
        .catch((e) => { flash(e.message); setPhase('propune'); });
    } else if (phaseRef.current === 'recap') {
      const p = proposal ? { ...proposal, options: proposal.options.filter((o) => o.key !== 'review') } : null;
      setReview(null);
      if (p) propose({ ...p, say: 'Acum știi unde a fost greșeala. Ce facem mai departe?' });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ps?.phase]);

  // ─── 5. întrebările (grilă / completare) ────────────────────────────────────
  const scene = ps?.scene;
  const pollScene = scene?.type === 'sondaj' && ['exercitiu', 'test'].includes(phase) ? scene : null;
  const understand = scene?.type === 'intrebare_intelegere' && ps?.status === 'asteapta' && !ps?.inserted && ['exercitiu', 'recap'].includes(phase);
  const inTest = phase === 'test';
  async function answerPoll(answer) {
    const poll = pollScene?.poll;
    if (!poll) return;
    if (inTest) {
      await liveApi.prepAnswer(test.rowId, poll.id, answer);
      setMyAnswers((m) => ({ ...m, [poll.id]: { answer } }));
      setTimeout(() => playerRef.current?.pollDone(poll.id, { answer }), 350);
      return;
    }
    const r = await liveApi.prepAnswer(ex.rowId, poll.id, answer);
    setMyAnswers((m) => ({ ...m, [poll.id]: { answer, correct: r.correct } }));
    setVerdicts((v) => ({ ...v, [poll.id]: { correct: r.correct, answer: r.answer } }));
    if (r.explain) setExplains((x) => ({ ...x, [poll.id]: r.explain }));
  }
  const testQ = inTest && test ? (() => {
    const polls = (test.timeline?.scenes || []).filter((s) => s.type === 'sondaj');
    const k = polls.findIndex((s) => s.poll?.id === pollScene?.poll?.id);
    return { n: k + 1, of: polls.length };
  })() : null;

  // ─── 6. chatul cu profesorul ────────────────────────────────────────────────
  const addMsg = (m) => setMessages((prev) => [...prev, m].slice(-80));
  async function sendChat(text) {
    const mine = { id: Date.now(), author: 'Tu', role: 'elev', text, at: new Date().toISOString(), mine: true };
    addMsg(mine);
    setPendingAnswer(true);
    try {
      const r = await liveApi.prepChat({
        text, sid: ex?.exercise?.sid || null, ref: scene?.ref || null, pos: curPos,
        history: messages.slice(-6).map((m) => ({ role: m.role, text: m.text })),
      });
      const a = r.answer;
      if (a) {
        addMsg(a);
        if (a.role === 'profesor') {
          if (playerRef.current && ['exercitiu', 'recap', 'test'].includes(phaseRef.current) && playerRef.current.status !== 'final') playerRef.current.playAnswer(a);
          else say(a.say || a.text);
        }
      }
    } catch (e) {
      addMsg({ id: Date.now() + 1, author: 'ExamenMate', role: 'sistem', text: e.message, at: new Date().toISOString() });
    } finally { setPendingAnswer(false); }
  }

  // microfonul: dictează întrebarea (recunoașterea vorbirii din browser)
  useEffect(() => {
    if (!joined || !micOn) { setHeard(''); return undefined; }
    if (!speechRecognitionSupported()) { flash('Browserul acesta nu recunoaște vorbirea — scrie întrebarea în chat.'); setMicOn(false); return undefined; }
    let alive = true, rec = null;
    const listen = () => {
      if (!alive) return;
      rec = startDictation({
        onResult: (text, final) => { setHeard(text); if (final && text.trim().length > 3) { setPanel('chat'); sendChat(text.trim()); setHeard(''); } },
        onError: () => {},
        onEnd: () => { if (alive) setTimeout(listen, 250); },
      });
    };
    listen();
    return () => { alive = false; rec?.stop(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [joined, micOn]);

  function raiseHand() {
    playerRef.current?.pause();
    stopSpeech();
    setPanel('chat');
    setPrefill({ id: Date.now(), text: '' });
    flash('Profesorul s-a oprit — scrie-i întrebarea.');
  }

  // pe telefon: camera urmează lecția; la propuneri se uită spre tablă
  const lessonState = ['exercitiu', 'test', 'recap'].includes(phase) ? ps : null;
  const cam = useSceneFocus(lessonState, { override: lessonState ? null : 'profesor' });
  const landscapeShort = useMedia(LANDSCAPE_SHORT);
  const toggleFs = () => toggleFullscreen(roomRef.current);

  // ─── randare ────────────────────────────────────────────────────────────────
  if (fatal) {
    return (
      <div className="lv-fatal">
        <div className="lv-fatal-card">
          <h1>🎓 Pregătire de examen</h1>
          <p>{fatal.text}</p>
          <div className="lv-pre-actions">
            {fatal.code === 'LOGIN' && <Link className="lv-btn-primary" to="/autentificare">Intră în cont</Link>}
            {fatal.code === 'PREMIUM_REQUIRED' && <Link className="lv-btn-primary" to="/preturi">Vezi abonamentul</Link>}
            <Link className="lv-btn-soft" to="/meditatii/plan">Înapoi la Planul meu</Link>
          </div>
        </div>
      </div>
    );
  }
  if (!st) return <div className="lv-fatal"><div className="spinner" /></div>;

  if (!joined) {
    const done = positions.reduce((n, p) => n + (p.done || 0), 0);
    const mastered = mainPositions.filter((p) => p.mastered).length;
    const chosen = pick ? posInfo(pick) : null;
    return (
      <div className="lv-room is-pre" ref={roomRef}>
        <div className="pe-lobby">
          <div className="pe-lobby-card">
            <div className="pe-lobby-photo">
              {rig?.thumb ? <img src={rig.thumb} alt="" /> : <span style={{ background: teacherColor(teacher) }}>{initials(teacher.name)}</span>}
            </div>
            <div className="pe-lobby-kicker">🎓 Pregătire de examen · {exam?.label}</div>
            <h1>{teacher.name} te așteaptă în clasă</h1>
            <p className="pe-lobby-sub">
              Ca la o meditație live: exercițiu cu exercițiu, în ordinea din examen — pe fiecare poziție, doar exerciții
              de pe acea poziție din subiectele oficiale, explicate pe barem. După cel puțin {st.settings?.target || 10} exerciții,
              un test scurt; profesorul îți propune apoi ce urmează.
            </p>
            {cur && (
              <div className="pe-lobby-now">
                <b>Acum: {cur.label}</b>
                <span>{cur.mastered ? '✓ testul trecut' : `${cur.done} din ${cur.nextTestAt} exerciții`}</span>
              </div>
            )}
            {(done > 0 || mastered > 0) && <div className="pe-lobby-stats">{done} exerciții lucrate · {mastered} din {mainPositions.length} poziții stăpânite</div>}
            {/* elevul alege ORICE exercițiu, nu neapărat la rând */}
            <div className="pe-lobby-pick">
              <div className="pe-lobby-pick-t">
                📋 <b>Cu ce începi?</b> Alege orice exercițiu, nu neapărat la rând
                {exam?.exam !== 'en' ? ' — la Subiectele II și III, și doar un subpunct: a), b) sau c)' : ''}.
              </div>
              <PrepPicker positions={positions} current={curPos} selected={pick} compact
                onPick={(p) => setPick(p.pos === pick ? null : p.pos)}
                defaultLabel={cur ? `Cum propune ${teacher.name}: ${cur.label}` : `Cum propune ${teacher.name}`}
                onDefault={() => setPick(null)} />
            </div>
            <div className="pe-lobby-free">
              ⏱ <b>Fără limită de timp:</b> lucrezi cât vrei. Dacă depășești 60 de minute, continuăm până termini exercițiile —
              progresul se salvează după fiecare exercițiu.
            </div>
            {canFs && (
              <label className="lv-pre-check">
                <input type="checkbox" checked={wantFs} onChange={(e) => setWantFs(e.target.checked)} /> Intră pe tot ecranul
              </label>
            )}
            <div className="lv-pre-actions">
              <button type="button" className="lv-btn-primary lv-btn-lg" onClick={onJoin}>{chosen ? `Intră · începem cu ${chosen.short}` : 'Intră la meditație'}</button>
              <Link to="/meditatii/plan" className="lv-btn-soft">Înapoi la Planul meu</Link>
            </div>
            <p className="lv-pre-ai">ⓘ Profesorul este <b>virtual (AI)</b>: vocea și imaginea sunt generate. Explică numai pe <b>baremul oficial</b> al fiecărui subiect.</p>
          </div>
        </div>
      </div>
    );
  }

  // ce se vede pe tablă și pe proiecție
  const board = lessonState?.board || null;
  const screenTitle = phase === 'test' ? `Test · ${test?.test?.label || cur?.label || ''}`
    : ex?.exercise ? ex.exercise.title : (cur?.label || exam?.label);
  const screenKicker = phase === 'test' ? `🧪 Test de verificare · ${exam?.label}`
    : ex?.exercise && lessonState ? `${ex.exercise.label} · exercițiul ${ex.exercise.n}${ex.exercise.target ? ` din ${ex.exercise.target}` : ''}`
      : `🎓 Pregătire de examen · ${exam?.label || ''}`;
  const screenNote = lessonState ? null : cur
    ? `${cur.mastered ? '✓ testul trecut' : `${cur.done} din ${cur.nextTestAt} exerciții`}${cur.lastTest ? ` · ultimul test: ${cur.lastTest.correct}/${cur.lastTest.total}` : ''}`
    : `Explicat pe baremul oficial · ${teacher.name}`;
  const resultOn = showResult && lastResult && !lessonState;
  const screenProps = {
    state: lessonState, results: {}, myAnswers,
    title: resultOn ? `${lastResult.correct} din ${lastResult.total} corecte${lastResult.passed ? ' ✓' : ''}` : screenTitle,
    examLabel: resultOn ? `🧪 Rezultatul testului · ${cur?.label || ''}` : screenKicker, teacherName: teacher.name,
    note: resultOn ? (lastResult.passed ? 'Promovat — poți trece mai departe' : 'Mai exersăm puțin, apoi refacem testul') : screenNote,
  };
  const caption = lessonState?.caption || speech?.text || null;
  const cardOpen = !!(pollScene?.poll || understand || (phase === 'propune' && proposal));
  const camInset = narrow ? sceneInset({ landscape: landscapeShort, card: cardOpen }) : null;
  const view = rig ? 'camera' : rigLoaded ? 'tabla' : 'camera';
  const topSub = [exam?.label, cur?.label, ex?.exercise && phase === 'exercitiu' ? `ex. ${ex.exercise.n}/${ex.exercise.target}` : null, inTest && testQ?.n > 0 ? `test ${testQ.n}/${testQ.of}` : null].filter(Boolean).join(' · ');
  const fsButton = (cls) => (canFs ? (
    <button type="button" className={cls} onClick={toggleFs} title={isFullscreen ? 'Ieși din ecranul complet' : 'Ecran complet'} aria-label={isFullscreen ? 'Ieși din ecranul complet' : 'Ecran complet'}>
      <span className="lv-ctl-ico">{isFullscreen ? '🗗' : '⛶'}</span><span className="lv-ctl-t">{isFullscreen ? 'Ieși' : 'Ecran complet'}</span>
    </button>
  ) : null);
  const playing = ['exercitiu', 'test', 'recap'].includes(phase);
  const leave = () => { playerRef.current?.stop(); exitFs(); navigate('/meditatii/plan'); };

  return (
    <div className={`lv-room view-${view}${panel ? ' has-panel' : ''}${isFullscreen ? ' is-fs' : ''}`} ref={roomRef}>
      <header className="lv-top">
        <div className="lv-top-left">
          <span className="lv-lock" title="Meditație 1-la-1 ExamenMate">🎓</span>
          <span className="lv-top-title">Pregătire de examen · {teacher.name}</span>
          <span className="lv-top-sub">{topSub}</span>
        </div>
        <div className="lv-top-right">
          {cur && <span className="pe-top-pos" title={cur.label}>{cur.short}{cur.mastered ? ' ✓' : ` · ${Math.min(cur.done, cur.nextTestAt)}/${cur.nextTestAt}`}</span>}
          {fsButton('lv-top-fs')}
        </div>
      </header>

      <div className="lv-body">
        <main className={`lv-stage${narrow && view === 'camera' ? ' has-pan' : ''}${cardOpen ? ' has-card' : ''}`}>
          {view === 'camera' ? (
            <>
              {rig && (
                <TeacherCamera teacher={teacher} rig={rig} engine={engine} variant="big" board={board} screen={screenProps}
                  state={lessonState || { phase: 'live', scene: { type: 'propunere', t0: speech?.id || 0 }, caption }}
                  thinking={pendingAnswer || !!busyText} chatCount={messages.length}
                  focus={cam.focus} inset={camInset} onLayout={(l) => setNarrow(!!l.narrow)} onSwipe={cam.set} />
              )}
              {narrow && rig && <ScenePan focus={cam.focus} onChange={cam.set} />}
            </>
          ) : (
            <div className="lv-share">
              <div className="lv-share-bar"><span>🧑‍🏫 {teacher.name} prezintă</span>{board?.title && <b>{board.title}</b>}</div>
              <div className="lv-share-grid">
                <section className="lv-wb" aria-label="Tabla albă">
                  <div className="lv-wb-frame">
                    {board ? <WhiteboardInk board={board} /> : <div className="lv-wb-empty">✎</div>}
                    <div className="lv-wb-tray" />
                  </div>
                </section>
                <section className="lv-digital" aria-label="Exercițiul"><div className="lv-digital-frame"><DigitalScreen {...screenProps} /></div></section>
              </div>
            </div>
          )}

          {cc && caption && <div className="lv-cc"><span>{caption}</span></div>}
          {heard && <div className="lv-heard">🎤 {heard}</div>}

          {/* ce propune profesorul (după fiecare exercițiu / test) */}
          {phase === 'propune' && proposal && (
            <ChoiceCard className="pe-choice" kicker={`🙋 ${teacher.name} propune`}
              question={null}
              options={proposal.options.map((o) => ({ id: o.key + (o.pos || ''), label: o.label, primary: o.primary, onPick: () => choose(o) }))}
              onFree={(t) => { setPanel('chat'); sendChat(t); }} freePlaceholder="Sau întreabă-mă ceva…"
              note={cur && !cur.mastered ? `${cur.label}: ${cur.done} din ${cur.nextTestAt} exerciții până la test` : null} />
          )}
          {phase === 'pregateste' && busyText && (
            <div className="lv-wait pe-wait">
              <div className="spinner" />
              <div className="lv-wait-sub">{busyText}</div>
            </div>
          )}
          {phase === 'final' && (
            <div className="lv-ended">
              <div className="lv-ended-card">
                <h2>Pe azi am terminat 👏</h2>
                <p>{positions.reduce((n, p) => n + (p.done || 0), 0)} exerciții lucrate · {mainPositions.filter((p) => p.mastered).length} din {mainPositions.length} poziții stăpânite. Progresul e salvat în Planul meu.</p>
                <div className="lv-pre-actions" style={{ justifyContent: 'center' }}>
                  <button type="button" className="lv-btn-primary" onClick={leave}>Înapoi la Planul meu</button>
                  <button type="button" className="lv-btn-soft" onClick={() => propose(proposal || st.proposal, 'Bine, mai lucrăm!')}>Mai lucrez puțin</button>
                </div>
              </div>
            </div>
          )}

          {pollScene && pollScene.poll && (
            <PollCard poll={pollScene.poll} teacherName={teacher.name} privat
              kicker={inTest ? `🧪 Test · întrebarea ${testQ?.n || 1} din ${testQ?.of || 1}` : pollKicker(pollScene, teacher.name)}
              step={!!pollScene.step} skip skipLabel={inTest ? '🤷 Nu știu — trec mai departe' : '🤷 Nu știu — arată-mi'}
              nextLabel={pollScene.step && !inTest ? 'Mai departe: pasul pe tablă →' : 'Mai departe →'}
              mine={myAnswers[pollScene.poll.id]}
              verdict={inTest ? null : verdicts[pollScene.poll.id] || null}
              explain={inTest ? null : explains[pollScene.poll.id] || null}
              onSubmit={answerPoll}
              onNext={() => playerRef.current?.pollDone(pollScene.poll.id, verdicts[pollScene.poll.id])} />
          )}
          {understand && (
            <UnderstandCard teacherName={teacher.name} altLeft={ps?.altLeft || 0}
              onYes={() => playerRef.current?.understood()}
              onAgain={() => playerRef.current?.explainAgain()}
              onAsk={() => { setPanel('chat'); setPrefill({ id: Date.now(), text: '' }); }} />
          )}
          <div className="lv-notes">
            {voiceHint && (
              <div className="lv-voice-hint" role="status">
                <span>🔈 {voiceHint}</span>
                <button type="button" onClick={() => setVoiceHint(null)} aria-label="Închide">✕</button>
              </div>
            )}
            {toast && <div className="lv-toast">{toast}</div>}
          </div>
        </main>

        {panel && (
          <aside className="lv-side">
            <div className="lv-side-tabs">
              <button type="button" className={panel === 'chat' ? 'is-on' : ''} onClick={() => setPanel('chat')}>💬 Întreabă</button>
              <button type="button" className={panel === 'plan' ? 'is-on' : ''} onClick={() => setPanel('plan')}>🗺️ Planul de examen</button>
              <button type="button" className="lv-side-x" onClick={() => setPanel(null)} aria-label="Închide">✕</button>
            </div>
            {panel === 'chat' ? (
              <LiveChat messages={messages} meId="eu" teacher={teacher} privat onSend={(t) => sendChat(t)} pendingAnswer={pendingAnswer} prefill={prefill} />
            ) : (
              <div className="pe-plan">
                <div className="pe-plan-head">
                  {exam?.label}: {teacher.name} propune ordinea din examen, dar poți alege <b>orice exercițiu, nu neapărat la rând</b>
                  {mainPositions.length < positions.length ? ' — la problemele cu a), b), c), și doar un subpunct' : ''}. Te ia de acolo.
                </div>
                {['I', 'II', 'III'].map((sub) => {
                  const list = mainPositions.filter((p) => p.sub === sub);
                  if (!list.length) return null;
                  const go = (p) => { setPanel(null); playerRef.current?.stop(); startExercise(p.pos, { lead: `Bine, lucrăm la ${spokenOf(p)}.` }); };
                  return (
                    <div key={sub} className="pe-plan-group">
                      <div className="pe-plan-sub">{sub === 'I' ? 'Subiectul I' : sub === 'II' ? 'Subiectul al II-lea' : 'Subiectul al III-lea'}</div>
                      {list.map((p) => {
                        const b = STATUS_BADGE[p.status] || STATUS_BADGE.nou;
                        const on = p.pos === curPos;
                        const subs = positions.filter((x) => x.parent === p.pos);
                        return (
                          <div key={p.pos}>
                            <button type="button" className={`pe-plan-row${on ? ' is-on' : ''}`} disabled={phase === 'pregateste'} onClick={() => go(p)}>
                              <span className="pe-plan-name">Exercițiul {p.ex}{subs.length ? ' (a, b, c)' : p.multi ? ' (a, b…)' : ''}</span>
                              <span className="pe-plan-meta">
                                {p.mastered ? '' : `${p.done}/${p.nextTestAt}`}
                                {p.lastTest ? ` · test ${p.lastTest.correct}/${p.lastTest.total}` : ''}
                              </span>
                              <span className={`pe-badge ${b.cls}`}>{b.label}</span>
                            </button>
                            {subs.length > 0 && (
                              <div className="pe-plan-subs">
                                <span>doar subpunctul:</span>
                                {subs.map((sp) => (
                                  <button key={sp.pos} type="button" disabled={phase === 'pregateste'}
                                    className={`pp-chip${sp.mastered ? ' is-ok' : sp.status === 'in_lucru' ? ' is-work' : ''}${sp.pos === curPos ? ' is-on' : ''}`}
                                    title={`${sp.label}${sp.mastered ? ' · testul trecut ✓' : sp.done ? ` · ${sp.done} ${sp.done === 1 ? 'exercițiu lucrat' : 'exerciții lucrate'}` : ''}`}
                                    onClick={() => go(sp)}>
                                    {sp.letter}){sp.mastered ? <i aria-hidden="true">✓</i> : null}
                                  </button>
                                ))}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  );
                })}
                {curPos && (
                  <div className="pe-plan-foot">
                    <button type="button" className="lv-btn-soft" disabled={phase === 'pregateste'} onClick={() => { setPanel(null); startTest(curPos); }}>🧪 Testul de verificare la {cur?.short}</button>
                  </div>
                )}
              </div>
            )}
          </aside>
        )}
      </div>

      <footer className="lv-bar">
        <div className="lv-bar-group">
          <button type="button" className={`lv-ctl${micOn ? '' : ' is-off'}`} onClick={() => setMicOn(!micOn)} title={micOn ? 'Oprește microfonul' : 'Întreabă cu vocea (devine text)'}>
            <span className="lv-ctl-ico">{micOn ? '🎤' : '🔇'}</span><span className="lv-ctl-t">{micOn ? 'Microfon' : 'Pornește'}</span>
          </button>
        </div>
        <div className="lv-bar-group">
          <button type="button" className="lv-ctl" disabled={!playing} onClick={() => playerRef.current?.prevItem()} title="Reia de la început partea curentă"><span className="lv-ctl-ico">⏮</span><span className="lv-ctl-t">Înapoi</span></button>
          {ps?.status === 'pauza' && playing
            ? <button type="button" className="lv-ctl is-accent" onClick={() => playerRef.current?.resume()}><span className="lv-ctl-ico">▶</span><span className="lv-ctl-t">Continuă</span></button>
            : <button type="button" className="lv-ctl" disabled={!playing} onClick={() => playerRef.current?.pause()} title="Profesorul se oprește"><span className="lv-ctl-ico">⏸</span><span className="lv-ctl-t">Pauză</span></button>}
          <button type="button" className="lv-ctl" disabled={!playing} onClick={() => playerRef.current?.nextItem()} title="Partea următoare (sau sfârșitul exercițiului)"><span className="lv-ctl-ico">⏭</span><span className="lv-ctl-t">Înainte</span></button>
          <button type="button" className="lv-ctl" onClick={raiseHand}><span className="lv-ctl-ico">✋</span><span className="lv-ctl-t">Mâna sus</span></button>
          <button type="button" className={`lv-ctl${panel === 'chat' ? ' is-on' : ''}`} onClick={() => setPanel(panel === 'chat' ? null : 'chat')}>
            <span className="lv-ctl-ico">💬</span><span className="lv-ctl-t">Întreabă</span>
          </button>
          <button type="button" className={`lv-ctl${panel === 'plan' ? ' is-on' : ''}`} onClick={() => setPanel(panel === 'plan' ? null : 'plan')}>
            <span className="lv-ctl-ico">🗺️</span><span className="lv-ctl-t">Plan</span>
          </button>
          <button type="button" className="lv-ctl lv-ctl-opt" onClick={() => setNotebook(true)} title="Caietul tău digital"><span className="lv-ctl-ico">✍️</span><span className="lv-ctl-t">Caiet</span></button>
          <button type="button" className={`lv-ctl lv-ctl-opt${cc ? ' is-on' : ''}`} onClick={() => setCc(!cc)} title="Subtitrări"><span className="lv-ctl-ico">CC</span><span className="lv-ctl-t">Subtitrări</span></button>
          {fsButton('lv-ctl lv-ctl-fs')}
          <div className="lv-more-wrap">
            <button type="button" className={`lv-ctl lv-ctl-more${moreOpen ? ' is-on' : ''}`} onClick={() => setMoreOpen(!moreOpen)} aria-expanded={moreOpen} aria-label="Mai mult">
              <span className="lv-ctl-ico">⋯</span><span className="lv-ctl-t">Mai mult</span>
            </button>
            {moreOpen && (
              <div className="lv-more-pop" role="menu" onClick={() => setMoreOpen(false)}>
                <button type="button" role="menuitem" onClick={() => setNotebook(true)}>✍️ Caietul meu</button>
                <button type="button" role="menuitem" onClick={() => setCc(!cc)}>{cc ? '🅲 Ascunde subtitrările' : '🅲 Arată subtitrările'}</button>
                {phase === 'exercitiu' && ex && <button type="button" role="menuitem" onClick={() => startExercise(ex.exercise.pos, { skip: ex.exercise.sid, lead: 'Bine, luăm alt exercițiu.' })}>🔄 Alt exercițiu (sar peste acesta)</button>}
                {curPos && phase !== 'test' && <button type="button" role="menuitem" onClick={() => startTest(curPos)}>🧪 Testul de verificare acum</button>}
              </div>
            )}
          </div>
          {phase === 'exercitiu' && ex && (
            <button type="button" className="lv-ctl lv-ctl-opt" onClick={() => startExercise(ex.exercise.pos, { skip: ex.exercise.sid, lead: 'Bine, luăm alt exercițiu.' })} title="Sari peste acest exercițiu — altul de pe aceeași poziție">
              <span className="lv-ctl-ico">🔄</span><span className="lv-ctl-t">Alt exercițiu</span>
            </button>
          )}
        </div>
        <div className="lv-bar-group">
          <button type="button" className="lv-leave" onClick={leave} aria-label="Părăsește"><span className="lv-leave-long">Părăsește</span><span className="lv-leave-short">Ieși</span></button>
        </div>
      </footer>

      <SpatiuDeLucru open={notebook} onClose={() => setNotebook(false)} title="Caietul meu"
        enunt={(ps?.head?.statementTry && ['item', 'sondaj'].includes(ps?.scene?.type) ? ps.head.statementTry : ps?.head?.statement) || null}
        storageKey={`pregatire:${curPos || 'x'}`} />
    </div>
  );
}
