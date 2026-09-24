// =====================================================================
// src/pages/LiveRoom.jsx — SALA LIVE (ca un apel Zoom / Google Meet)
// Ruta: /meditatii/sala/:id   (demonstrație: /meditatii/demo, /meditatii/demo-1la1)
//
//   1. „Ești gata să intri?" — previzualizarea camerei proprii, microfonul,
//      numele, cine predă, câți colegi sunt înăuntru, plata/abonamentul și
//      „Intră pe tot ecranul";
//   2. sala: camera profesorului (clasa cu tabla albă, catedra și tabla
//      digitală) sau vizualizarea „Tablă" (ca un ecran partajat), banda cu
//      participanții, chatul, lista de participanți, subtitrările, reacțiile,
//      mâna ridicată, caietul (Spațiul de lucru), ecranul complet, „Părăsește";
//   3. întrebările profesorului (grilă / de completat) și „Ai înțeles?" (1-la-1).
//
// Grup: lecția merge pe ceasul comun (GroupPlayer) — toți aud și văd același
// lucru. 1-la-1: lecția așteaptă elevul (PrivatePlayer).
// =====================================================================
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { liveApi, buyTicket } from '../lib/live/api';
import { clock } from '../lib/live/clock';
import { AudioEngine } from '../lib/live/audio';
import { GroupPlayer, PrivatePlayer } from '../lib/live/player';
import { joinLiveChannel } from '../lib/live/realtime';
import { loadRig, initials } from '../lib/live/profesori';
import { fmtClock } from '../lib/live/timeline';
import TeacherCamera from '../components/live/TeacherCamera';
import PreJoin from '../components/live/PreJoin';
import { WhiteboardInk, DigitalScreen, MathHtml } from '../components/live/Board';
import { PollCard, UnderstandCard } from '../components/live/PollCard';
import { LiveChat, Participants, colorOf } from '../components/live/LiveChat';
import SpatiuDeLucru from '../components/SpatiuDeLucru';
import { startDictation, speechRecognitionSupported } from '../lib/voice';
import demoData from '../lib/live/demo.json';
import '../styles/live.css';

const REACTIONS = ['👍', '👏', '❤️', '😂', '😮', '🎉'];

// ─── ecran complet (Fullscreen API, cu prefixul Safari) ───────────────────────
const fsElement = () => document.fullscreenElement || document.webkitFullscreenElement || null;
function enterFs(el) {
  const f = el && (el.requestFullscreen || el.webkitRequestFullscreen);
  if (!f) return false;
  try { const p = f.call(el, { navigationUI: 'hide' }); if (p && p.catch) p.catch(() => {}); return true; } catch { return false; }
}
function exitFs() {
  const f = document.exitFullscreen || document.webkitExitFullscreen;
  if (f && fsElement()) { try { const p = f.call(document); if (p && p.catch) p.catch(() => {}); } catch { /* ignore */ } }
}

// ─── demonstrația (fără server) ───────────────────────────────────────────────
function demoInfo(privat) {
  const now = new Date();
  return {
    demo: true,
    session: {
      id: privat ? 'demo-1la1' : 'demo', kind: privat ? 'privat' : 'grup', teacher: 'radu', slot: '17',
      examLabel: 'Evaluarea Națională', exam: 'en', phase: 'live',
      starts_at: now.toISOString(), ends_at: new Date(now.getTime() + 3600000).toISOString(),
      subject: { id: 'demo', title: 'Demonstrație — doi itemi pe barem' }, startedAt: null,
    },
    teacher: { id: 'radu', name: 'Prof. Radu', gender: 'm', color: '#1f6dab', bio: '' },
    me: { id: 'eu', name: 'Tu (demo)' }, access: 'abonament', messages: [], myAnswers: {},
    timeline: privat ? demoData.privat : demoData.grup, lesson: { status: 'gata', playable: true },
    now: now.toISOString(), noVoice: true,
  };
}

export default function LiveRoom({ demo = null }) {
  const { id: routeId } = useParams();
  const navigate = useNavigate();
  const { user, loading: authLoading } = useAuth();
  const sessionId = demo ? (demo === 'privat' ? 'demo-1la1' : 'demo') : routeId;

  const [info, setInfo] = useState(null);
  const [fatal, setFatal] = useState(null);
  const [payInfo, setPayInfo] = useState(null);     // { price } — trebuie plătit
  const [paying, setPaying] = useState(false);
  const [joined, setJoined] = useState(false);
  const [camOn, setCamOn] = useState(false);
  const [micOn, setMicOn] = useState(false);
  const [wantFs, setWantFs] = useState(() => typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [timeline, setTimeline] = useState(null);
  const [startedAt, setStartedAt] = useState(null);
  const [lesson, setLesson] = useState(null);
  const [messages, setMessages] = useState([]);
  const [people, setPeople] = useState([]);
  const [present, setPresent] = useState(0);
  const [ps, setPs] = useState(null);                // starea playerului
  const [panel, setPanel] = useState(() => (typeof window !== 'undefined' && window.innerWidth >= 1100 ? 'chat' : null));
  const [view, setView] = useState(null);            // 'camera' | 'tabla'
  const [results, setResults] = useState({});
  const [myAnswers, setMyAnswers] = useState({});
  const [verdicts, setVerdicts] = useState({});
  const [hand, setHand] = useState(false);
  const [cc, setCc] = useState(true);
  const [rig, setRig] = useState(null);
  const [floaters, setFloaters] = useState([]);
  const [pendingAnswer, setPendingAnswer] = useState(false);
  const [rtStatus, setRtStatus] = useState('');
  const [notebook, setNotebook] = useState(false);
  const [reactOpen, setReactOpen] = useState(false);
  const [toast, setToast] = useState(null);
  const [prefill, setPrefill] = useState(null);
  const [heard, setHeard] = useState('');
  const [ended, setEnded] = useState(false);
  const [privEnds, setPrivEnds] = useState(null);
  const [mode, setMode] = useState(null);             // 'individual' = ședința de grup ținută 1-la-1
  const [modeWhy, setModeWhy] = useState(null);       // 'singur' (un singur elev la început) | 'dupa' (după lecția comună)
  const [voiceHint, setVoiceHint] = useState(null);

  const roomRef = useRef(null);
  const engineRef = useRef(null);
  const playerRef = useRef(null);
  const chanRef = useRef(null);
  const selfVideoRef = useRef(null);
  const seenReact = useRef(new Map());
  const joinedAtRef = useRef(Date.now());
  const fromItemsRef = useRef(false);                // „Continuă 1-la-1" după lecția comună: direct la itemi
  const modeRef = useRef(null);                      // modul curent, citit în callback-uri (fără efecte în setState)
  // 1-la-1: ședința privată SAU cea de grup la care elevul a rămas singur la început
  const individual = info?.session?.kind === 'grup' && mode === 'individual';
  const privat = info?.session?.kind === 'privat' || individual;
  const teacher = info?.teacher;

  if (!engineRef.current && typeof window !== 'undefined') engineRef.current = new AudioEngine();
  const engine = engineRef.current;

  const flash = useCallback((t) => { setToast(t); setTimeout(() => setToast((x) => (x === t ? null : x)), 3500); }, []);

  // ─── 1. informațiile ședinței (și dreptul de acces) ────────────────────────
  const load = useCallback(async () => {
    if (demo) {
      const d = demoInfo(demo === 'privat');
      setInfo(d); setTimeline(d.timeline); setLesson(d.lesson);
      return;
    }
    try {
      const r = await liveApi.join(sessionId);
      setInfo(r); setPayInfo(null);
      setMessages(r.messages || []);
      setMyAnswers(r.myAnswers || {});
      setLesson(r.lesson || null);
      if (r.timeline) setTimeline(r.timeline);
      setStartedAt(r.session?.startedAt || null);
      modeRef.current = r.session?.mode || null;
      setMode(r.session?.mode || null);
      setModeWhy(r.session?.modeWhy || null);
    } catch (e) {
      if (e.code === 'LIVE_PAYMENT' && e.data?.session) { setInfo(e.data); setPayInfo({ price: e.data.price }); return; }
      if (e.status === 401) { setFatal('Intră în cont ca să participi la meditație.'); return; }
      setFatal(e.message || 'Nu am putut intra în ședință.');
    }
  }, [demo, sessionId]);

  useEffect(() => { if (demo || (!authLoading && user)) load(); else if (!authLoading && !user) setFatal('Intră în cont ca să participi la meditație.'); }, [demo, authLoading, user, load]);
  const [rigLoaded, setRigLoaded] = useState(false);
  useEffect(() => { if (info?.session?.teacher) loadRig(info.session.teacher).then((r) => { setRig(r); setRigLoaded(true); }); }, [info?.session?.teacher]);
  // vizualizarea implicită: camera (cu portret, pe ecran lat) sau tabla (ca un ecran partajat)
  useEffect(() => {
    if (view || !rigLoaded) return;
    const wide = window.innerWidth >= 900 && window.innerHeight >= 500;
    setView(rig && wide ? 'camera' : 'tabla');
  }, [rig, rigLoaded, view]);
  const [screenOpen, setScreenOpen] = useState(null);   // null = automat (după scenă)

  // ─── 2. pregătirea lecției (dacă nu e gata), cât timp elevul așteaptă ──────
  useEffect(() => {
    if (demo || !info?.session || timeline || payInfo) return undefined;
    if (!info.session.subject) return undefined;
    let alive = true, timer = null;
    const step = async () => {
      try {
        const r = await liveApi.prepare(sessionId);
        if (!alive) return;
        setLesson(r.lesson);
        if (r.lesson?.playable || r.lesson?.status === 'gata') {
          const t = await liveApi.timeline(sessionId);
          if (!alive) return;
          if (t.timeline) { modeRef.current = t.mode || null; setMode(t.mode || null); setModeWhy(t.modeWhy || null); setTimeline(t.timeline); setStartedAt(t.startedAt || null); return; }
        }
      } catch (e) {
        if (!alive) return;
        setLesson((l) => ({ ...(l || {}), error: e.message }));
      }
      if (alive) timer = setTimeout(step, privat ? 4000 : 15000);
    };
    step();
    return () => { alive = false; clearTimeout(timer); };
  }, [demo, info?.session, timeline, payInfo, privat, sessionId]);

  // grup: ceasul comun pornește când începe ora (serverul fixează startedAt)
  const applyTimeline = useCallback((r) => {
    if (r.mode === 'individual') {
      if (modeRef.current !== 'individual') {
        modeRef.current = 'individual';
        const who = teacher?.name || 'profesorul';
        flash(r.modeWhy === 'dupa'
          ? `Continuăm 1-la-1: ${who} e doar al tău până la sfârșitul orei, fără cost în plus.`
          : `Ești singurul elev la această oră — ${who} îți ține ședința 1-la-1, fără cost în plus.`);
      }
      setMode('individual');
      setModeWhy(r.modeWhy || null);
      if (r.timeline) setTimeline(r.timeline);
      return;
    }
    if (r.startedAt) { setStartedAt(r.startedAt); if (r.timeline) setTimeline(r.timeline); }
  }, [flash, teacher?.name]);
  useEffect(() => {
    if (demo || privat || !timeline || startedAt || !joined) return undefined;
    const t = setInterval(async () => {
      try { applyTimeline(await liveApi.timeline(sessionId)); } catch { /* reîncercăm */ }
    }, 5000);
    return () => clearInterval(t);
  }, [demo, privat, timeline, startedAt, joined, sessionId, applyTimeline]);

  // ─── 3. intrarea propriu-zisă ──────────────────────────────────────────────
  function onJoin() {
    engine.unlock();                                   // sunetul, din gestul elevului
    if (wantFs && roomRef.current) enterFs(roomRef.current);
    joinedAtRef.current = Date.now();
    setJoined(true);
    if (demo && demo !== 'privat') setStartedAt(new Date(clock.now() + 2500).toISOString());
  }

  async function onPay() {
    setPaying(true);
    try { window.location.href = await buyTicket({ kind: 'grup', sessionId, returnTo: '/meditatii' }); }
    catch (e) { flash(e.message); setPaying(false); }
  }

  useEffect(() => {
    const onFs = () => setIsFullscreen(!!fsElement());
    document.addEventListener('fullscreenchange', onFs);
    document.addEventListener('webkitfullscreenchange', onFs);
    return () => { document.removeEventListener('fullscreenchange', onFs); document.removeEventListener('webkitfullscreenchange', onFs); };
  }, []);

  // ─── 4. playerul ───────────────────────────────────────────────────────────
  useEffect(() => {
    if (!joined || !timeline) return undefined;
    // s-a schimbat modul (grup → 1-la-1): playerul vechi se oprește
    if (playerRef.current && (privat ? !(playerRef.current instanceof PrivatePlayer) : !(playerRef.current instanceof GroupPlayer))) {
      playerRef.current.stop(); playerRef.current = null;
    }
    if (!privat) {
      if (!playerRef.current) playerRef.current = new GroupPlayer({ engine, onState: setPs, startsAt: info?.session?.starts_at || null });
      playerRef.current.setTimeline(timeline, startedAt);
      playerRef.current.start();
      return undefined;
    }
    if (!playerRef.current) {
      const p = new PrivatePlayer({
        engine, onState: setPs,
        onSceneChange: (index) => { if (!demo && !individual) liveApi.privateState(sessionId, { scene: index }).catch(() => {}); },
        onNeedAudio: async () => {
          if (demo) return;
          try { const t = await liveApi.timeline(sessionId); if (t.timeline) { p.setTimeline(t.timeline); setTimeline(t.timeline); } } catch { /* reîncercăm */ }
        },
      });
      playerRef.current = p;
      p.setTimeline(timeline);
      const resumeScene = info?.session?.state?.scene;
      if (resumeScene) p.resumeAt(resumeScene);
      else if (fromItemsRef.current) {
        // lecția comună tocmai s-a terminat: fără „Bună ziua" din nou — de la primul item
        fromItemsRef.current = false;
        const first = timeline.scenes.findIndex((x) => x.item != null);
        if (first > 0) p.resumeAt(first);
      }
      (async () => {
        if (individual) setPrivEnds(Date.parse(info.session.ends_at));    // ședința de grup: până la sfârșitul orei
        else if (!demo) {
          try { const b = await liveApi.privateBegin(sessionId); setPrivEnds(b.ends_at ? Date.parse(b.ends_at) : null); }
          catch (e) { flash(e.message); if (e.code === 'LIVE_PAYMENT') { setJoined(false); setPayInfo({ price: e.data?.price || 20 }); return; } }
        } else setPrivEnds(clock.now() + 60 * 60000);
        p.start();
      })();
    } else {
      playerRef.current.setTimeline(timeline);
    }
    return undefined;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [joined, timeline, startedAt, privat]);

  useEffect(() => () => { playerRef.current?.stop(); engine?.close(); }, [engine]);

  // lecția vorbește cu vocea browserului: dacă browserul n-are o voce românească, spunem de ce tace
  useEffect(() => {
    if (!joined || !timeline?.noVoice) return undefined;
    const t = setTimeout(() => {
      const v = engine.voiceStatus();
      if (v.status === 'ok') return;
      setVoiceHint(v.status === 'fara'
        ? 'Browserul acesta nu poate citi cu voce tare — urmărește subtitrările. Pentru voce, deschide sala în Chrome sau Microsoft Edge.'
        : 'Browserul tău nu are o voce în limba română, așa că profesorul vorbește prin subtitrări. Pentru voce: deschide sala în Microsoft Edge (voce naturală, gratuită) sau adaugă vocea română în Windows (Setări → Oră și limbă → Vorbire).');
    }, 1800);
    return () => clearTimeout(t);
  }, [joined, timeline?.noVoice, engine]);

  // răspunsurile rostite ale profesorului (grup: în „Întrebări")
  useEffect(() => { if (!privat && playerRef.current instanceof GroupPlayer) playerRef.current.setAnswers(messages); }, [messages, privat, ps?.phase]);

  // ─── 5. timp real: prezența, chatul, rezultatele ───────────────────────────
  const addMessages = useCallback((list) => {
    setMessages((prev) => {
      const byId = new Map(prev.map((m) => [m.id, m]));
      for (const m of list) if (m && m.id != null) byId.set(m.id, { ...byId.get(m.id), ...m });
      return [...byId.values()].sort((a, b) => a.id - b.id).slice(-200);
    });
  }, []);

  useEffect(() => {
    if (!joined || demo || !info?.me) return undefined;
    const ch = joinLiveChannel({
      sessionId, me: info.me,
      onPresence: (list) => { setPeople(list); },
      onChat: (msg) => addMessages([msg]),
      onPoll: ({ pollId, results: r }) => setResults((p) => ({ ...p, [pollId]: r })),
      onSession: async () => { try { applyTimeline(await liveApi.timeline(sessionId)); } catch { /* ignore */ } },
      onStatus: setRtStatus,
    });
    chanRef.current = ch;
    return () => { ch.leave(); chanRef.current = null; };
  }, [joined, demo, info?.me, sessionId, addMessages, applyTimeline]);

  // demo: câțiva colegi „de probă", ca să se vadă cum arată sala
  useEffect(() => {
    if (!demo || !joined || privat) return;
    const names = ['Ioana M.', 'Andrei P.', 'Maria C.', 'Vlad T.', 'Elena D.'];
    setPeople([{ id: 'eu', name: 'Tu (demo)', joined: 0 }, ...names.map((n, i) => ({ id: 'd' + i, name: n, joined: i + 1, hand: i === 3 }))]);
  }, [demo, joined, privat]);

  // plasă de siguranță: mesajele noi, rar (des când timpul real nu merge)
  useEffect(() => {
    if (!joined || demo) return undefined;
    const every = rtStatus === 'SUBSCRIBED' ? 25000 : 6000;
    const t = setInterval(async () => {
      const last = messages.length ? messages[messages.length - 1].id : 0;
      try { const r = await liveApi.messages(sessionId, last > 0 ? last : 0); addMessages(r.messages || []); } catch { /* ignore */ }
    }, every);
    return () => clearInterval(t);
  }, [joined, demo, rtStatus, messages, sessionId, addMessages]);

  // prezența (câți sunt în sală) + timpul petrecut, o dată pe minut
  useEffect(() => {
    if (!joined || demo) return undefined;
    let last = Date.now();
    const beat = async () => {
      const secs = Math.round((Date.now() - last) / 1000); last = Date.now();
      try { const r = await liveApi.heartbeat(sessionId, secs); setPresent(r.present || 0); } catch { /* ignore */ }
    };
    beat();
    const t = setInterval(beat, 60000);
    return () => clearInterval(t);
  }, [joined, demo, sessionId]);

  // reacțiile colegilor (din prezență) → emoji care urcă peste scenă
  useEffect(() => {
    for (const p of people) {
      const r = p.reaction;
      if (!r || !r.at || p.id === info?.me?.id) continue;
      if (seenReact.current.get(p.id) === r.at) continue;
      seenReact.current.set(p.id, r.at);
      if (Date.now() - r.at < 8000) spawnFloater(r.e, p.name);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [people]);

  function spawnFloater(e, name) {
    const id = Math.random().toString(36).slice(2);
    setFloaters((f) => [...f.slice(-14), { id, e, name, x: 8 + Math.random() * 30 }]);
    setTimeout(() => setFloaters((f) => f.filter((x) => x.id !== id)), 4200);
  }

  // ─── 6. camera și microfonul elevului (locale) ─────────────────────────────
  useEffect(() => {
    if (!joined || !camOn) return undefined;
    let stream = null, alive = true;
    navigator.mediaDevices?.getUserMedia?.({ video: { width: 480, height: 270, facingMode: 'user' }, audio: false })
      .then((s) => { if (!alive) { s.getTracks().forEach((t) => t.stop()); return; } stream = s; if (selfVideoRef.current) selfVideoRef.current.srcObject = s; })
      .catch(() => { setCamOn(false); flash('Nu am acces la cameră.'); });
    chanRef.current?.update({ cam: true });
    return () => { alive = false; stream?.getTracks().forEach((t) => t.stop()); chanRef.current?.update({ cam: false }); };
  }, [joined, camOn, flash]);

  useEffect(() => {
    if (!joined || !micOn) { setHeard(''); return undefined; }
    if (!speechRecognitionSupported()) { flash('Browserul acesta nu recunoaște vorbirea — scrie întrebarea în chat.'); setMicOn(false); return undefined; }
    let alive = true, rec = null;
    chanRef.current?.update({ mic: true });
    const listen = () => {
      if (!alive) return;
      rec = startDictation({
        onResult: (text, final) => {
          setHeard(text);
          if (final && text.trim().length > 3) { sendChat(text.trim(), { toTeacher: false, voice: true }); setHeard(''); }
        },
        onError: () => {},
        onEnd: () => { if (alive) setTimeout(listen, 250); },
      });
    };
    listen();
    return () => { alive = false; rec?.stop(); chanRef.current?.update({ mic: false }); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [joined, micOn]);

  // ─── 7. chatul ─────────────────────────────────────────────────────────────
  async function sendChat(text, { toTeacher = false } = {}) {
    const item = ps?.scene?.item ?? null;
    if (demo) {
      const mine = { id: Date.now(), author: 'Tu', role: 'elev', text, at: new Date().toISOString(), mine: true, private: toTeacher };
      addMessages([mine]);
      setPendingAnswer(true);
      setTimeout(() => {
        const ans = { id: Date.now() + 1, author: teacher?.name, role: 'profesor', text: 'În demonstrație nu răspund cu adevărat — în ședințele live îți răspund pe baza baremului, imediat.', at: new Date().toISOString(), private: toTeacher, dur: 5 };
        addMessages([ans]);
        setPendingAnswer(false);
        if (privat) playerRef.current?.playAnswer(ans);
      }, 1400);
      return;
    }
    const expectsAnswer = privat || toTeacher || /\?|^(de ce|cum|cât|cat|care|ce |nu (am )?înțeleg|nu inteleg|explic)/i.test(text);
    if (expectsAnswer) setPendingAnswer(true);
    try {
      const r = await liveApi.chat(sessionId, text, { toTeacher, item });
      addMessages([r.message, ...(r.answer ? [r.answer] : [])].filter(Boolean));
      if (r.answer && privat) playerRef.current?.playAnswer(r.answer);
      else if (r.answer && !privat && !r.answer.private && r.answer.audio) flash('Profesorul ți-a răspuns în chat — răspunsul se aude și la „Întrebări".');
    } finally { setPendingAnswer(false); }
  }

  // ─── 8. întrebările profesorului ───────────────────────────────────────────
  const scene = ps?.scene;
  const pollScene = scene?.type === 'sondaj' ? scene : null;
  async function answerPoll(answer) {
    const poll = pollScene?.poll;
    if (!poll) return;
    if (demo) {
      const key = demoAnswerKey(poll.id);
      const correct = poll.type === 'grila' ? answer === key : answer.replace(/\s/g, '') === key;
      setMyAnswers((m) => ({ ...m, [poll.id]: { answer, correct } }));
      const fake = { total: 6, correct: 4, correctPct: 67, pct: poll.type === 'grila' ? { a: 17, b: 67, c: 16 } : {}, byOption: {} };
      setResults((r) => ({ ...r, [poll.id]: fake }));
      if (privat) setVerdicts((v) => ({ ...v, [poll.id]: { correct, answer: key } }));
      return;
    }
    const r = await liveApi.pollAnswer(sessionId, poll.id, answer);
    setMyAnswers((m) => ({ ...m, [poll.id]: { answer, correct: r.correct } }));
    if (r.results) setResults((x) => ({ ...x, [poll.id]: r.results }));
    if (privat) setVerdicts((v) => ({ ...v, [poll.id]: { correct: r.correct, answer: r.answer } }));
  }
  // la „Rezultate", aducem cifrele finale (dacă nu au venit în timp real)
  useEffect(() => {
    if (demo || scene?.type !== 'rezultate' || !scene.poll) return;
    const id = scene.poll.id;
    liveApi.pollResults(sessionId, id, scene.poll.type).then((r) => setResults((x) => ({ ...x, [id]: r.results }))).catch(() => {});
  }, [demo, scene?.type, scene?.poll?.id, sessionId]); // eslint-disable-line react-hooks/exhaustive-deps

  // ─── 9. comenzile ──────────────────────────────────────────────────────────
  function toggleHand() {
    const h = !hand;
    setHand(h);
    chanRef.current?.update({ hand: h });
    if (h && privat) { playerRef.current?.pause(); setPanel('chat'); setPrefill({ id: Date.now(), text: '' }); flash('Profesorul s-a oprit — scrie-i întrebarea.'); }
    else if (h) flash('Ai ridicat mâna ✋ — scrie întrebarea în chat; profesorul răspunde la „Întrebări".');
  }
  function react(e) {
    setReactOpen(false);
    spawnFloater(e, 'Tu');
    chanRef.current?.update({ reaction: { e, at: Date.now() } });
  }
  async function leave(end = false) {
    const secs = Math.round((Date.now() - joinedAtRef.current) / 1000) % 90;
    playerRef.current?.stop();
    exitFs();
    if (!demo) liveApi.leave(sessionId, { seconds: secs, end }).catch(() => {});
    navigate('/meditatii', { replace: true });
  }
  // lecția comună s-a terminat înainte de sfârșitul orei → elevul continuă 1-la-1
  // (fără cost în plus): reia orice item, întreabă orice, până la ora de final
  const [continuing, setContinuing] = useState(false);
  async function continuePersonal() {
    if (continuing) return;
    setContinuing(true);
    try {
      for (let i = 0; i < 4; i++) {
        const r = await liveApi.timeline(sessionId);
        if (r.mode === 'individual' && r.timeline) {
          fromItemsRef.current = true;
          setEnded(false);
          applyTimeline(r);
          return;
        }
        await new Promise((ok) => setTimeout(ok, 2500));          // serverul confirmă sfârșitul lecției comune
      }
      flash('Nu se poate continua acum — încearcă din nou în câteva secunde.');
    } catch (e) { flash(e.message); }
    finally { setContinuing(false); }
  }
  function toggleFs() { if (fsElement()) exitFs(); else enterFs(roomRef.current); }

  // sfârșitul ședinței (grup: cronologia s-a terminat; 1-la-1: au trecut cele 60 de minute)
  useEffect(() => { if (ps?.phase === 'final') setEnded(true); }, [ps?.phase]);
  const [, force] = useState(0);
  useEffect(() => { const t = setInterval(() => force((n) => n + 1), 1000); return () => clearInterval(t); }, []);
  const privLeft = privEnds ? Math.max(0, (privEnds - clock.now()) / 1000) : null;
  const endsAtMs = info?.session?.ends_at ? Date.parse(info.session.ends_at) : null;
  const canContinue = ended && !privat && !demo && info?.session?.kind === 'grup' && !!endsAtMs && clock.now() < endsAtMs - 3 * 60000;
  useEffect(() => { if (privat && privLeft === 0 && joined) { playerRef.current?.stop(); setEnded(true); } }, [privat, privLeft, joined]);

  // ─── randare ───────────────────────────────────────────────────────────────
  if (fatal) {
    return (
      <div className="lv-fatal">
        <div className="lv-fatal-card">
          <h1>🎥 Meditații live</h1>
          <p>{fatal}</p>
          <div className="lv-pre-actions">
            {!user && !demo ? <Link className="lv-btn-primary" to="/autentificare">Intră în cont</Link> : null}
            <Link className="lv-btn-soft" to="/meditatii">Înapoi la program</Link>
          </div>
        </div>
      </div>
    );
  }
  if (!info) return <div className="lv-fatal"><div className="spinner" /></div>;

  const waitingText = !timeline && info.session?.subject
    ? lessonWaitText(lesson, teacher)
    : !info.session?.subject ? 'Profesorul nu are încă un subiect cu barem pentru această ședință. Revino puțin mai târziu.' : null;

  if (!joined) {
    return (
      <div className="lv-room is-pre" ref={roomRef}>
        <PreJoin info={info} teacher={teacher} rigThumb={rig?.thumb || null} present={present || 0} personal={individual ? (modeWhy || 'singur') : null}
          access={payInfo ? 'plata' : info.access} price={payInfo?.price} onJoin={onJoin} onPay={onPay} paying={paying}
          waitingText={waitingText} camOn={camOn} setCamOn={setCamOn} micOn={micOn} setMicOn={setMicOn} fullscreen={wantFs} setFullscreen={setWantFs} />
      </div>
    );
  }

  const s = info.session;
  const elapsed = ps?.pos != null && ps.pos > 0 ? ps.pos : 0;
  const speakingNow = engine?.speaking();
  const covered = timeline ? { covered: timeline.covered ?? null, total: timeline.total ?? null } : null;
  const screenProps = { state: ps, results, myAnswers, title: s.subject?.title, examLabel: s.examLabel, teacherName: teacher?.name, covered: covered?.covered != null ? covered : null };
  const board = ps?.board || null;
  const understand = privat && scene?.type === 'intrebare_intelegere' && ps?.status === 'asteapta' && !ps?.inserted;
  const others = people.filter((p) => p.id !== info.me?.id);
  const handsUp = others.filter((p) => p.hand).length;

  return (
    <div className={`lv-room view-${view}${panel ? ' has-panel' : ''}${isFullscreen ? ' is-fs' : ''}`} ref={roomRef}>
      {/* ── bara de sus ── */}
      <header className="lv-top">
        <div className="lv-top-left">
          <span className="lv-lock" title="Ședință privată ExamenMate">🔒</span>
          <span className="lv-top-title">{privat ? 'Meditație 1-la-1' : 'Meditație live'} · {teacher?.name}</span>
          <span className="lv-top-sub">{s.examLabel}{s.subject?.title ? ` · ${s.subject.title}` : ''}</span>
        </div>
        <div className="lv-top-right">
          {!privat && ps?.phase === 'live' && <span className="lv-live-pill"><span className="lv-dot-live" /> LIVE</span>}
          <span className="lv-timer" title={privat ? 'Timp rămas' : 'Durata ședinței'}>{privat ? `⏳ ${fmtClock(privLeft ?? 3600)}` : `⏱ ${fmtClock(elapsed)}`}</span>
          <span className="lv-count" title="Participanți">👥 {privat ? 2 : Math.max(present, people.length) + 1}</span>
          <button type="button" className="lv-top-btn" onClick={() => setView(view === 'camera' ? 'tabla' : 'camera')} title="Schimbă vizualizarea">
            {view === 'camera' ? '🧑‍🏫 Camera' : '📋 Tabla'}
          </button>
        </div>
      </header>

      <div className="lv-body">
        {/* ── scena ── */}
        <main className="lv-stage">
          {view === 'camera' && rig ? (
            <>
              <TeacherCamera teacher={teacher} rig={rig} engine={engine} variant="big" board={board} screen={screenProps}
                thinking={pendingAnswer} chatCount={messages.length} />
              {(screenOpen ?? (!!rig.screenFloat || ps?.scene?.type === 'video')) ? (
                <div className={`lv-float-screen is-${rig.screenFloat === 'dreapta' ? 'right' : 'left'}`} aria-label="Tabla digitală">
                  <div className="lv-float-head"><span>🖥️ Tabla digitală</span><button type="button" onClick={() => setScreenOpen(false)} aria-label="Ascunde">—</button></div>
                  <div className="lv-digital-frame"><DigitalScreen {...screenProps} /></div>
                </div>
              ) : (
                <button type="button" className={`lv-float-show is-${rig.screenFloat === 'dreapta' ? 'right' : 'left'}`} onClick={() => setScreenOpen(true)}>🖥️ Tabla digitală</button>
              )}
            </>
          ) : (
            <div className="lv-share">
              <div className="lv-share-bar">
                <span>🧑‍🏫 {teacher?.name} prezintă</span>
                {board?.title && <b>{board.title}</b>}
              </div>
              <div className="lv-share-grid">
                <section className="lv-wb" aria-label="Tabla albă">
                  <div className="lv-wb-frame">
                    {board ? <WhiteboardInk board={board} /> : <div className="lv-wb-empty">{ps?.phase === 'asteptare' ? 'Tabla e curată — începem imediat.' : '✎'}</div>}
                    <div className="lv-wb-tray" />
                  </div>
                </section>
                <section className="lv-digital" aria-label="Tabla digitală">
                  <div className="lv-digital-frame"><DigitalScreen {...screenProps} /></div>
                </section>
              </div>
              <div className="lv-pip">
                <TeacherCamera teacher={teacher} rig={rig} engine={engine} variant="pip" showBoards={false}
                  board={board} state={ps} thinking={pendingAnswer} chatCount={messages.length} />
              </div>
            </div>
          )}

          {/* așteptarea (înainte de început / lecția încă se pregătește) */}
          {(!timeline || ps?.phase === 'asteptare') && (
            <div className="lv-wait">
              {!timeline ? <>
                <div className="lv-wait-title">{teacher?.name} își pregătește lecția</div>
                <div className="lv-wait-sub">{waitingText}</div>
              </> : <>
                <div className="lv-wait-title">{(ps?.startsIn || 0) > 0 ? `Ședința începe în ${fmtClock(ps.startsIn)}` : 'Ședința începe…'}</div>
                <div className="lv-wait-sub">Ești în sala de așteptare. Dacă la ora de început ești singurul elev, {teacher?.name || 'profesorul'} îți ține ședința 1-la-1.</div>
              </>}
            </div>
          )}

          {cc && ps?.caption && <div className="lv-cc"><span>{ps.caption}</span></div>}
          {heard && <div className="lv-heard">🎤 {heard}</div>}

          {pollScene && pollScene.poll && (
            <PollCard poll={pollScene.poll} teacherName={teacher?.name} privat={privat}
              total={pollScene.dur} left={ps?.remaining || 0} mine={myAnswers[pollScene.poll.id]}
              answeredCount={results[pollScene.poll.id]?.total || 0}
              verdict={verdicts[pollScene.poll.id] || null}
              onSubmit={answerPoll}
              onNext={() => playerRef.current?.pollDone(pollScene.poll.id, verdicts[pollScene.poll.id])} />
          )}
          {understand && (
            <UnderstandCard teacherName={teacher?.name} altLeft={ps?.altLeft || 0}
              onYes={() => playerRef.current?.understood()}
              onAgain={() => playerRef.current?.explainAgain()}
              onAsk={() => { setPanel('chat'); setPrefill({ id: Date.now(), text: '' }); }} />
          )}
          {privat && ps?.status === 'incarca' && <div className="lv-toast">Profesorul își aranjează notițele… (vocea se pregătește)</div>}
          {voiceHint && (
            <div className="lv-voice-hint" role="status">
              <span>🔈 {voiceHint}</span>
              <button type="button" onClick={() => setVoiceHint(null)} aria-label="Închide">✕</button>
            </div>
          )}

          <div className="lv-floaters" aria-hidden="true">
            {floaters.map((f) => <div key={f.id} className="lv-floater" style={{ left: `${f.x}%` }}><span>{f.e}</span><small>{f.name}</small></div>)}
          </div>
          {toast && <div className="lv-toast">{toast}</div>}
          {ended && (
            <div className="lv-ended">
              <div className="lv-ended-card">
                <h2>{canContinue ? 'Lecția comună s-a încheiat 👏' : 'Ședința s-a încheiat 👏'}</h2>
                <p>{summaryLine(myAnswers)}</p>
                {canContinue && (
                  <p className="lv-ended-more">
                    Ora nu s-a terminat: până la {hhmm(endsAtMs)} poți continua <b>1-la-1</b> cu {teacher?.name || 'profesorul'},
                    fără cost în plus — reia orice item (⏮ ⏭), cere „Explică altfel" sau întreabă-l orice în chat.
                  </p>
                )}
                <div className="lv-pre-actions">
                  {canContinue && (
                    <button type="button" className="lv-btn-primary" onClick={continuePersonal} disabled={continuing}>
                      {continuing ? 'Se pregătește…' : 'Continuă 1-la-1'}
                    </button>
                  )}
                  <button type="button" className={canContinue ? 'lv-btn-soft' : 'lv-btn-primary'} onClick={() => leave(true)}>Înapoi la program</button>
                  {!privat && !canContinue && <Link className="lv-btn-soft" to="/meditatii?unu=1">Ședință 1-la-1 pe același subiect</Link>}
                </div>
              </div>
            </div>
          )}
        </main>

        {/* ── panoul lateral: chat / participanți ── */}
        {panel && (
          <aside className="lv-side">
            <div className="lv-side-tabs">
              <button type="button" className={panel === 'chat' ? 'is-on' : ''} onClick={() => setPanel('chat')}>💬 Chat</button>
              {!privat && <button type="button" className={panel === 'people' ? 'is-on' : ''} onClick={() => setPanel('people')}>👥 Participanți{handsUp ? ` · ✋${handsUp}` : ''}</button>}
              <button type="button" className="lv-side-x" onClick={() => setPanel(null)} aria-label="Închide">✕</button>
            </div>
            {panel === 'chat'
              ? <LiveChat messages={messages} meId={info.me?.id} teacher={teacher} privat={privat} onSend={sendChat} pendingAnswer={pendingAnswer} prefill={prefill} disabled={ended} />
              : <Participants teacher={teacher} speaking={speakingNow} people={people.length ? people : [{ id: info.me?.id, name: info.me?.name, hand, cam: camOn, mic: micOn }]} meId={info.me?.id} />}
          </aside>
        )}
      </div>

      {/* ── banda cu participanții ── */}
      {!privat && (
        <div className="lv-strip">
          <div className="lv-tile is-me">
            {camOn ? <video ref={selfVideoRef} autoPlay playsInline muted className="lv-mirror" /> : <span className="lv-av" style={{ background: '#5f6368' }}>{initials(info.me?.name)}</span>}
            <span className="lv-tile-name">{hand ? '✋ ' : ''}Tu{camOn ? ' · doar tu te vezi' : ''}</span>
            {!micOn && <span className="lv-tile-mute">🔇</span>}
          </div>
          {others.slice(0, 8).map((p) => (
            <div key={p.id} className="lv-tile">
              <span className="lv-av" style={{ background: colorOf(p.id) }}>{initials(p.name)}</span>
              <span className="lv-tile-name">{p.hand ? '✋ ' : ''}{p.name}</span>
              {!p.mic && <span className="lv-tile-mute">🔇</span>}
            </div>
          ))}
          {others.length > 8 && <div className="lv-tile is-more">+{others.length - 8}</div>}
        </div>
      )}
      {privat && camOn && (
        <div className="lv-self-float"><video ref={selfVideoRef} autoPlay playsInline muted className="lv-mirror" /><span>Tu</span></div>
      )}

      {/* ── bara de control ── */}
      <footer className="lv-bar">
        <div className="lv-bar-group">
          <button type="button" className={`lv-ctl${micOn ? '' : ' is-off'}`} onClick={() => setMicOn(!micOn)} title={micOn ? 'Oprește microfonul' : 'Vorbește cu profesorul (vocea devine text)'}>
            <span className="lv-ctl-ico">{micOn ? '🎤' : '🔇'}</span><span className="lv-ctl-t">{micOn ? 'Microfon' : 'Pornește'}</span>
          </button>
          <button type="button" className={`lv-ctl${camOn ? '' : ' is-off'}`} onClick={() => setCamOn(!camOn)} title="Camera ta — doar tu te vezi">
            <span className="lv-ctl-ico">{camOn ? '📷' : '🚫'}</span><span className="lv-ctl-t">Cameră</span>
          </button>
        </div>
        <div className="lv-bar-group">
          {privat && (<>
            <button type="button" className="lv-ctl" onClick={() => playerRef.current?.prevItem()} title="Itemul anterior"><span className="lv-ctl-ico">⏮</span><span className="lv-ctl-t">Înapoi</span></button>
            {ps?.status === 'pauza'
              ? <button type="button" className="lv-ctl is-accent" onClick={() => playerRef.current?.resume()}><span className="lv-ctl-ico">▶</span><span className="lv-ctl-t">Continuă</span></button>
              : <button type="button" className="lv-ctl" onClick={() => playerRef.current?.pause()} title="Profesorul se oprește"><span className="lv-ctl-ico">⏸</span><span className="lv-ctl-t">Pauză</span></button>}
            <button type="button" className="lv-ctl" onClick={() => playerRef.current?.nextItem()} title="Itemul următor"><span className="lv-ctl-ico">⏭</span><span className="lv-ctl-t">Înainte</span></button>
          </>)}
          <div className="lv-react-wrap">
            <button type="button" className="lv-ctl" onClick={() => setReactOpen(!reactOpen)}><span className="lv-ctl-ico">😀</span><span className="lv-ctl-t">Reacții</span></button>
            {reactOpen && <div className="lv-react-pop">{REACTIONS.map((e) => <button key={e} type="button" onClick={() => react(e)}>{e}</button>)}</div>}
          </div>
          <button type="button" className={`lv-ctl${hand ? ' is-accent' : ''}`} onClick={toggleHand}><span className="lv-ctl-ico">✋</span><span className="lv-ctl-t">{hand ? 'Coboară' : 'Mâna sus'}</span></button>
          <button type="button" className={`lv-ctl${panel === 'chat' ? ' is-on' : ''}`} onClick={() => setPanel(panel === 'chat' ? null : 'chat')}>
            <span className="lv-ctl-ico">💬</span><span className="lv-ctl-t">Chat</span>
          </button>
          {!privat && (
            <button type="button" className={`lv-ctl${panel === 'people' ? ' is-on' : ''}`} onClick={() => setPanel(panel === 'people' ? null : 'people')}>
              <span className="lv-ctl-ico">👥</span><span className="lv-ctl-t">Participanți</span>
            </button>
          )}
          <button type="button" className="lv-ctl" onClick={() => setNotebook(true)} title="Caietul tău digital"><span className="lv-ctl-ico">✍️</span><span className="lv-ctl-t">Caiet</span></button>
          <button type="button" className={`lv-ctl${cc ? ' is-on' : ''}`} onClick={() => setCc(!cc)} title="Subtitrări"><span className="lv-ctl-ico">CC</span><span className="lv-ctl-t">Subtitrări</span></button>
          <button type="button" className="lv-ctl" onClick={toggleFs} title="Ecran complet"><span className="lv-ctl-ico">{isFullscreen ? '🗗' : '⛶'}</span><span className="lv-ctl-t">{isFullscreen ? 'Ieși' : 'Ecran complet'}</span></button>
        </div>
        <div className="lv-bar-group">
          <button type="button" className="lv-leave" onClick={() => leave(false)}>Părăsește</button>
        </div>
      </footer>

      <SpatiuDeLucru open={notebook} onClose={() => setNotebook(false)} title="Caietul meu"
        enunt={ps?.head?.statement || null} storageKey={`live:${sessionId}`} />
    </div>
  );
}

function lessonWaitText(lesson, teacher) {
  if (!lesson) return 'Pregătesc sala…';
  if (lesson.error && lesson.status === 'eroare') return `Lecția nu s-a putut pregăti: ${lesson.error}`;
  if (lesson.status === 'nou') return `${teacher?.name || 'Profesorul'} citește subiectul și baremul oficial și își scrie explicațiile… (1–3 minute)`;
  if (lesson.status === 'script' || lesson.status === 'audio') {
    const pct = lesson.total ? Math.round((100 * (lesson.done || 0)) / lesson.total) : 0;
    return `Explicațiile sunt gata; se înregistrează vocea — ${pct}%.`;
  }
  return 'Aproape gata…';
}

function summaryLine(answers) {
  const list = Object.values(answers || {});
  if (!list.length) return 'Mulțumim că ai fost cu noi! Refă mâine exercițiile la care ai ezitat.';
  const ok = list.filter((a) => a.correct).length;
  return `Ai răspuns corect la ${ok} din ${list.length} întrebări ale profesorului. ${ok === list.length ? 'Excelent!' : 'Refă mâine exercițiile la care ai greșit — așa se fixează.'}`;
}

// ora României (programul ședințelor e în ora României)
function hhmm(ms) {
  try { return new Date(ms).toLocaleTimeString('ro-RO', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Bucharest' }); }
  catch { const d = new Date(ms); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; }
}

function demoAnswerKey(pollId) {
  return pollId === 'd-p1' ? 'b' : '1';
}

