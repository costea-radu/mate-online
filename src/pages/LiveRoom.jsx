// =====================================================================
// src/pages/LiveRoom.jsx — SALA LIVE (ca un apel Zoom / Google Meet)
// Ruta: /meditatii/sala/:id   (demonstrație: /meditatii/demo, /meditatii/demo-1la1)
//
//   1. „Ești gata să intri?" — previzualizarea camerei proprii, microfonul,
//      numele, cine predă, câți colegi sunt înăuntru, plata/abonamentul și
//      „Intră pe tot ecranul";
//   2. sala: camera profesorului — clasa, cu profesorul în fața tablei albe; ce
//      scrie el apare pe tablă, în spatele lui, iar exercițiul e proiectat în
//      dreapta tablei. Pe telefon (nu încap citibil deodată) butonul
//      „✎ Explicația / 📝 Exercițiul" (sau o glisare) mută camera între ele;
//      banda cu participanții, chatul, lista de participanți, subtitrările,
//      reacțiile, mâna ridicată, caietul (Spațiul de lucru), ecranul complet
//      (pe telefon: sus, în dreapta), „Părăsește";
//   3. întrebările profesorului (grilă / de completat) și „Ai înțeles?" (1-la-1) —
//      la Subiectele II și III și pe PAȘII din barem: explicația se oprește înaintea
//      rezultatelor intermediare, elevul răspunde pe ecran (cu „💡 Indiciu" și, la
//      1-la-1, „🤷 Nu știu — arată-mi"), apoi profesorul scrie pasul pe tablă;
//   4. „📋 Exerciții" (1-la-1): elevul alege ORICE exercițiu, nu neapărat la rând
//      (ex. S. I ex. 5, S. II ex. 2 b), S. III ex. 1 c)) — și la intrare („Cu ce
//      începi?") — iar după fiecare exercițiu ales, profesorul întreabă ce urmează;
//   5. prelungirea: la 1-la-1, după cele 60 de minute (la grupul ținut 1-la-1, după
//      ora de final) ședința NU se oprește cât elevul lucrează — se prelungește până
//      termină exercițiile (api/live.js → extend), fără cost în plus.
//
// Grup: lecția merge pe ceasul comun (GroupPlayer) — toți aud și văd același
// lucru. 1-la-1: lecția așteaptă elevul (PrivatePlayer); dacă a pornit înainte
// să fie gata toată vocea generată, restul se generează în fundal, începând cu
// itemul la care e elevul, iar ce nu e gata la timp se rostește cu vocea
// browserului — lecția nu se mai oprește niciodată în „vocea se pregătește".
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
import { enterFs, exitFs, toggleFs as toggleFullscreen, fsSupported, useIsFullscreen } from '../lib/live/fullscreen';
import TeacherCamera from '../components/live/TeacherCamera';
import ScenePan, { useSceneFocus, useMedia, LANDSCAPE_SHORT } from '../components/live/ScenePan';
import { sceneInset } from '../lib/live/framing';
import PreJoin from '../components/live/PreJoin';
import { WhiteboardInk, DigitalScreen } from '../components/live/Board';
import { PollCard, UnderstandCard, ChoiceCard, pollKicker } from '../components/live/PollCard';
import ItemPicker from '../components/live/ItemPicker';
import { itemsFromTimeline, defaultRefs, sceneIndexForRef, itemStatus, refLabel } from '../lib/live/items';
import { LiveChat, Participants, colorOf } from '../components/live/LiveChat';
import SpatiuDeLucru from '../components/SpatiuDeLucru';
import { startDictation, speechRecognitionSupported } from '../lib/voice';
import demoData from '../lib/live/demo.json';
import { DEMO_SCRIPT } from '../lib/live/demoScript';
import '../styles/live.css';

const REACTIONS = ['👍', '👏', '❤️', '😂', '😮', '🎉'];

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
    teacher: { id: 'radu', name: 'Prof. Tudor', gender: 'm', color: '#1f6dab', bio: '' },
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
  const isFullscreen = useIsFullscreen();
  const canFs = fsSupported();
  const [timeline, setTimeline] = useState(null);
  const [startedAt, setStartedAt] = useState(null);
  const [lesson, setLesson] = useState(null);
  const [messages, setMessages] = useState([]);
  const [people, setPeople] = useState([]);
  const [present, setPresent] = useState(0);
  const [ps, setPs] = useState(null);                // starea playerului
  const [panel, setPanel] = useState(() => (typeof window !== 'undefined' && window.innerWidth >= 1100 ? 'chat' : null));
  const [narrow, setNarrow] = useState(false);       // telefon: camera se mută între tablă și exercițiu
  const [moreOpen, setMoreOpen] = useState(false);   // telefon: „⋯ Mai mult" (caiet, subtitrări, reacții, cameră)
  const [results, setResults] = useState({});
  const [myAnswers, setMyAnswers] = useState({});
  const [verdicts, setVerdicts] = useState({});
  const [explains, setExplains] = useState({});      // 1-la-1: de unde vine răspunsul corect
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
  const [soundBlocked, setSoundBlocked] = useState(false);   // contextul audio oprit de browser
  // „📋 Exerciții": exercițiul cu care începe elevul (ales la intrare sau din lobby: ?ex=II.2.b)
  const [startRef, setStartRef] = useState(() => {
    try { const v = new URLSearchParams(window.location.search).get('ex'); return v && /^I{1,3}\.\d(\.[a-d])?$/i.test(v) ? v.toUpperCase().replace(/\.([A-D])$/, (m, l) => `.${l.toLowerCase()}`) : null; } catch { return null; }
  });
  const [visited, setVisited] = useState(() => new Set());
  // prelungirea: sfârșitul de acum (server), sfârșitul inițial (60 min / ora), plafonul atins
  const [ext, setExt] = useState({ ends: null, base: null, capped: false, cap: null });
  const [continueOk, setContinueOk] = useState(false);

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
  // O singură vizualizare: CLASA, cu profesorul în fața tablei (scrisul pe tabla din
  // spatele lui, exercițiul proiectat în dreapta ei). Fără portret (rig.json lipsă)
  // rămâne, ca rezervă, tabla desenată separat (ca un ecran partajat).
  const view = rig ? 'camera' : rigLoaded ? 'tabla' : 'camera';

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
      let asking = false;   // o singură cerere pe drum (playerul reîntreabă la ~1,5 s cât așteaptă vocea)
      const p = new PrivatePlayer({
        engine, onState: setPs,
        onSceneChange: (index) => { if (!demo && !individual) liveApi.privateState(sessionId, { scene: index }).catch(() => {}); },
        onNeedAudio: async () => {
          if (demo || asking) return;
          asking = true;
          try { const t = await liveApi.timeline(sessionId); if (t.timeline) { p.setTimeline(t.timeline); setTimeline(t.timeline); } } catch { /* reîncercăm */ }
          finally { asking = false; }
        },
      });
      playerRef.current = p;
      p.setTimeline(timeline);
      const resumeScene = info?.session?.state?.scene;
      const start = startRef ? sceneIndexForRef(timeline, startRef) : null;
      if (start && start.index >= 0) {
        // elevul a ales cu ce începe: de acolo, iar după exercițiu profesorul întreabă ce urmează
        p.resumeAt(start.index);
        p.setPickMode(true);
        if (!start.exact) flash(`${refLabel(startRef)} nu e în lecția acestui subiect — încep cu ${refLabel(start.ref)}.`);
      } else if (resumeScene) p.resumeAt(resumeScene);
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

  // exercițiile prin care a trecut elevul (pentru „📋 Exerciții")
  const curItem = ps?.scene?.item ?? null;
  useEffect(() => {
    if (curItem == null) return;
    setVisited((v) => (v.has(curItem) ? v : new Set([...v, curItem])));
  }, [curItem]);

  // 1-la-1 pornit cu vocea generată doar pentru început (intro + primii itemi):
  // restul vocii se generează ÎN FUNDAL cât elevul lucrează, întâi de la itemul la
  // care a ajuns (dacă a sărit înainte cu ⏭), apoi restul. Fără asta, lecția se
  // oprea la primul segment fără voce („Profesorul își aranjează notițele…").
  const hasTimeline = !!timeline;
  const tlNoVoice = !!timeline?.noVoice;
  const lessonReady = lesson?.status === 'gata';
  useEffect(() => {
    if (demo || !privat || !joined || !hasTimeline || tlNoVoice || lessonReady) return undefined;
    let alive = true, timer = null;
    const step = async () => {
      try {
        const sc = playerRef.current?.scene;
        const r = await liveApi.prepare(sessionId, { budgetMs: 45000, fromRef: sc?.ref || null });
        if (!alive) return;
        if (r?.lesson) setLesson((l) => ({ ...(l || {}), ...r.lesson }));
        const t = await liveApi.timeline(sessionId);
        if (!alive) return;
        if (t.timeline) { playerRef.current?.setTimeline(t.timeline); setTimeline(t.timeline); }
        if (t.lesson?.status === 'gata' || t.noVoice) { setLesson((l) => ({ ...(l || {}), ...(t.lesson || {}), status: 'gata' })); return; }
      } catch { /* reîncercăm */ }
      if (alive) timer = setTimeout(step, 4000);
    };
    timer = setTimeout(step, 1200);
    return () => { alive = false; clearTimeout(timer); };
  }, [demo, privat, joined, hasTimeline, tlNoVoice, lessonReady, sessionId]);

  // lecția vorbește cu vocea browserului: dacă browserul n-are o voce românească, spunem de ce tace
  useEffect(() => {
    if (!joined || !timeline?.noVoice) return undefined;
    let hide = null;
    const t = setTimeout(() => {
      const v = engine.voiceStatus();
      if (v.status === 'ok') return;
      setVoiceHint(v.status === 'fara'
        ? 'Browserul acesta nu poate citi cu voce tare — urmărește subtitrările. Pentru voce, deschide sala în Chrome sau Microsoft Edge.'
        : 'Browserul tău nu are o voce în limba română, așa că profesorul vorbește prin subtitrări. Pentru voce: deschide sala în Microsoft Edge (voce naturală, gratuită) sau adaugă vocea română în Windows (Setări → Oră și limbă → Vorbire).');
      // se închide și singur: pe telefon acoperea exercițiul proiectat
      hide = setTimeout(() => setVoiceHint(null), 15000);
    }, 1800);
    return () => { clearTimeout(t); clearTimeout(hide); };
  }, [joined, timeline?.noVoice, engine]);

  // vocea generată (Web Audio) oprită de browser — ex. pe iPhone după un apel, după
  // ecranul blocat sau dacă „Participă acum" n-a putut porni sunetul: un buton
  // „🔊 Pornește sunetul" (orice atingere pe pagină îl reia, de fapt — vezi audio.js)
  useEffect(() => {
    if (!joined || !hasTimeline || tlNoVoice) { setSoundBlocked(false); return undefined; }
    const t = setInterval(() => setSoundBlocked(engine.audioBlocked()), 1500);
    return () => clearInterval(t);
  }, [joined, hasTimeline, tlNoVoice, engine]);

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
    engine.setRecording(true);          // Safari: sesiunea audio „play-and-record" cât ascultă microfonul
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
    return () => { alive = false; rec?.stop(); chanRef.current?.update({ mic: false }); engine.setRecording(false); };
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
  const choosing = privat && ps?.status === 'alege';           // exercițiul ales s-a terminat: ce urmează?
  const pollScene = scene?.type === 'sondaj' && !choosing ? scene : null;
  // pe telefon: unde se uită camera (tabla cu explicația / exercițiul proiectat)
  const cam = useSceneFocus(ps);
  const landscapeShort = useMedia(LANDSCAPE_SHORT);
  async function answerPoll(answer) {
    const poll = pollScene?.poll;
    if (!poll) return;
    if (demo) {
      const key = demoKey(poll.id);
      const correct = answer !== '?' && (poll.type === 'grila' ? answer === key.answer : demoSame(answer, key.answer));
      setMyAnswers((m) => ({ ...m, [poll.id]: { answer, correct } }));
      const fake = { total: 6, correct: 4, correctPct: 67, pct: poll.type === 'grila' ? { a: 17, b: 67, c: 16 } : {}, byOption: {} };
      setResults((r) => ({ ...r, [poll.id]: fake }));
      if (privat) {
        setVerdicts((v) => ({ ...v, [poll.id]: { correct, answer: key.answer } }));
        if (key.explain) setExplains((x) => ({ ...x, [poll.id]: key.explain }));
      }
      return;
    }
    const r = await liveApi.pollAnswer(sessionId, poll.id, answer);
    setMyAnswers((m) => ({ ...m, [poll.id]: { answer, correct: r.correct } }));
    if (r.results) setResults((x) => ({ ...x, [poll.id]: r.results }));
    if (privat) {
      setVerdicts((v) => ({ ...v, [poll.id]: { correct: r.correct, answer: r.answer } }));
      if (r.explain) setExplains((x) => ({ ...x, [poll.id]: r.explain }));
    }
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
  const toggleFs = () => toggleFullscreen(roomRef.current);

  // sfârșitul ședinței: când lecția s-a terminat (grup: cronologia comună; 1-la-1: ultimul
  // exercițiu sau „Încheie"). La 1-la-1, cele 60 de minute NU mai opresc elevul care încă
  // lucrează: ședința se prelungește până termină exercițiile (plafon: LIVE_PRELUNGIRE_MAX).
  useEffect(() => { if (ps?.phase === 'final') setEnded(true); }, [ps?.phase]);
  const [, force] = useState(0);
  useEffect(() => { const t = setInterval(() => force((n) => n + 1), 1000); return () => clearInterval(t); }, []);
  const baseEnd = ext.base || privEnds;                       // sfârșitul inițial (60 min / ora)
  const privLeft = baseEnd ? Math.max(0, (baseEnd - clock.now()) / 1000) : null;
  const overtime = privat && !!baseEnd && clock.now() >= baseEnd;
  const endsAtMs = info?.session?.ends_at ? Date.parse(info.session.ends_at) : null;
  const canContinue = ended && !privat && !demo && info?.session?.kind === 'grup' && (continueOk || (!!endsAtMs && clock.now() < endsAtMs - 3 * 60000));

  // cererea de prelungire: la fiecare minut cât elevul lucrează 1-la-1 (serverul mută
  // sfârșitul doar când mai sunt sub 5 minute), plus o dată la sfârșitul lecției comune
  const extendNow = useCallback(async () => {
    if (demo) return null;
    try {
      const r = await liveApi.extend(sessionId);
      setExt({ ends: r.ends_at ? Date.parse(r.ends_at) : null, base: r.base_end ? Date.parse(r.base_end) : null, cap: r.cap ? Date.parse(r.cap) : null, capped: r.ok === false && r.reason === 'plafon' });
      return r;
    } catch { return null; }
  }, [demo, sessionId]);
  useEffect(() => {
    if (!joined || demo || !privat || ended || !hasTimeline) return undefined;
    extendNow();
    const t = setInterval(extendNow, 60000);
    return () => clearInterval(t);
  }, [joined, demo, privat, ended, hasTimeline, extendNow]);
  // a trecut ora / cele 60 de minute: o singură dată, profesorul spune că mergem mai departe
  const overNotified = useRef(false);
  useEffect(() => {
    if (!overtime || overNotified.current || ended) return;
    overNotified.current = true;
    flash(info?.session?.kind === 'privat'
      ? 'Au trecut cele 60 de minute — continuăm până termini exercițiile, fără cost în plus.'
      : 'Ora s-a terminat — continuăm 1-la-1 până termini exercițiile, fără cost în plus.');
  }, [overtime, ended, flash, info?.session?.kind]);
  // plafonul prelungirii atins (ex. tab uitat deschis): abia atunci se încheie ședința
  useEffect(() => {
    if (privat && joined && !ended && ext.capped && ext.ends && clock.now() >= ext.ends) { playerRef.current?.stop(); setEnded(true); }
  });
  // lecția comună s-a terminat: cerem prelungirea, ca elevul să poată continua 1-la-1 și după oră
  useEffect(() => {
    if (!ended || privat || demo || info?.session?.kind !== 'grup') return undefined;
    const t = setTimeout(async () => {
      const r = await extendNow();
      if (r && r.ok && r.ends_at && Date.parse(r.ends_at) - clock.now() > 60000) setContinueOk(true);
    }, 6000);
    return () => clearTimeout(t);
  }, [ended, privat, demo, info?.session?.kind, extendNow]);

  // „📋 Exerciții": itemii lecției (sau structura examenului, cât lecția încă se pregătește)
  const lessonItems = useMemo(() => itemsFromTimeline(timeline), [timeline]);
  const pickItems = lessonItems.length ? lessonItems : defaultRefs(info?.session?.exam);
  const statusByItem = useMemo(() => itemStatus(timeline, myAnswers, visited), [timeline, myAnswers, visited]);
  function pickItem(it) {
    const p = playerRef.current;
    if (!privat || !(p instanceof PrivatePlayer) || it.item == null) return;
    p.setPickMode(true);
    p.gotoItem(it.item);
    if (typeof window !== 'undefined' && window.innerWidth < 1100) setPanel(null);   // pe telefon, panoul acoperă scena
    flash(`Lucrăm la ${refLabel(it.ref)}.`);
  }

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
          waitingText={waitingText} camOn={camOn} setCamOn={setCamOn} micOn={micOn} setMicOn={setMicOn} fullscreen={wantFs} setFullscreen={setWantFs}
          pickItems={privat ? pickItems : null} startRef={startRef} setStartRef={setStartRef} privMinutes={info.privMinutes || 60} />
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
  // pe telefon, camera lasă loc butonului de sus și cardului cu întrebarea
  const camInset = narrow ? sceneInset({ landscape: landscapeShort, card: !!(pollScene?.poll || understand) }) : null;

  const fsButton = (cls) => (canFs ? (
    <button type="button" className={cls} onClick={toggleFs} title={isFullscreen ? 'Ieși din ecranul complet' : 'Ecran complet'} aria-label={isFullscreen ? 'Ieși din ecranul complet' : 'Ecran complet'}>
      <span className="lv-ctl-ico">{isFullscreen ? '🗗' : '⛶'}</span><span className="lv-ctl-t">{isFullscreen ? 'Ieși' : 'Ecran complet'}</span>
    </button>
  ) : null);

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
          {privat && overtime
            ? <span className="lv-timer is-over" title="Ședința s-a prelungit: continuăm până termini exercițiile, fără cost în plus">⏱ +{fmtClock((clock.now() - baseEnd) / 1000)} prelungire</span>
            : <span className="lv-timer" title={privat ? 'Timp rămas (apoi se prelungește până termini exercițiile)' : 'Durata ședinței'}>{privat ? `⏳ ${fmtClock(privLeft ?? 3600)}` : `⏱ ${fmtClock(elapsed)}`}</span>}
          <span className="lv-count" title="Participanți">👥 {privat ? 2 : Math.max(present, people.length) + 1}</span>
          {/* pe telefon, ecranul complet stă aici (bara de jos nu are loc pentru el) */}
          {fsButton('lv-top-fs')}
        </div>
      </header>

      <div className="lv-body">
        {/* ── scena ── */}
        <main className={`lv-stage${narrow && view === 'camera' ? ' has-pan' : ''}${pollScene?.poll || understand ? ' has-card' : ''}`}>
          {view === 'camera' ? (
            <>
              {rig && (
                <TeacherCamera teacher={teacher} rig={rig} engine={engine} variant="big" board={board} screen={screenProps}
                  thinking={pendingAnswer} chatCount={messages.length}
                  focus={cam.focus} inset={camInset} onLayout={(l) => setNarrow(!!l.narrow)} onSwipe={cam.set} />
              )}
              {narrow && rig && <ScenePan focus={cam.focus} onChange={cam.set} />}
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
              kicker={pollKicker(pollScene, teacher?.name)} step={!!pollScene.step} skip={privat}
              total={pollScene.dur} left={ps?.remaining || 0} mine={myAnswers[pollScene.poll.id]}
              answeredCount={results[pollScene.poll.id]?.total || 0}
              verdict={verdicts[pollScene.poll.id] || null}
              explain={privat ? explains[pollScene.poll.id] || null : null}
              nextLabel={pollScene.step ? 'Mai departe: pasul pe tablă →' : 'Mai departe →'}
              onSubmit={answerPoll}
              onNext={() => playerRef.current?.pollDone(pollScene.poll.id, verdicts[pollScene.poll.id])} />
          )}
          {choosing && (
            <ChoiceCard kicker={`🙋 ${teacher?.name || 'Profesorul'} întreabă`} question="Gata și acest exercițiu. Ce lucrăm acum?"
              options={[
                ...(ps?.nextHead ? [{ id: 'next', label: `▶ Mai departe: ${refLabel(ps.nextHead.ref)}`, primary: true, onPick: () => playerRef.current?.continueNext() }] : []),
                { id: 'pick', label: '📋 Aleg alt exercițiu', primary: !ps?.nextHead, onPick: () => setPanel('items') },
                { id: 'order', label: '⏩ Continuă în ordine, fără să mă mai întrebi', onPick: () => { playerRef.current?.setPickMode(false); playerRef.current?.continueNext(); } },
                { id: 'end', label: '🏁 Ajunge pentru azi', onPick: () => leave(true) },
              ]}
              note={overtime ? '⏱ Ședința e prelungită cât lucrezi — fără cost în plus.' : null} />
          )}
          {understand && (
            <UnderstandCard teacherName={teacher?.name} altLeft={ps?.altLeft || 0}
              onYes={() => playerRef.current?.understood()}
              onAgain={() => playerRef.current?.explainAgain()}
              onAsk={() => { setPanel('chat'); setPrefill({ id: Date.now(), text: '' }); }} />
          )}
          {/* mesajele de sus, unul sub altul (nu se mai acoperă): îndemnul despre voce, „vocea se pregătește", mesajul scurt */}
          <div className="lv-notes">
            {voiceHint && (
              <div className="lv-voice-hint" role="status">
                <span>🔈 {voiceHint}</span>
                <button type="button" onClick={() => setVoiceHint(null)} aria-label="Închide">✕</button>
              </div>
            )}
            {soundBlocked && (
              <div className="lv-voice-hint is-sound" role="status">
                <span>🔇 Browserul a oprit sunetul sălii.</span>
                <button type="button" className="lv-sound-on" onClick={() => { engine.unlock(); setSoundBlocked(false); }}>🔊 Pornește sunetul</button>
              </div>
            )}
            {privat && ps?.status === 'incarca' && <div className="lv-toast">Profesorul își aranjează notițele… (vocea se pregătește)</div>}
            {toast && <div className="lv-toast">{toast}</div>}
          </div>

          <div className="lv-floaters" aria-hidden="true">
            {floaters.map((f) => <div key={f.id} className="lv-floater" style={{ left: `${f.x}%` }}><span>{f.e}</span><small>{f.name}</small></div>)}
          </div>
          {ended && (
            <div className="lv-ended">
              <div className="lv-ended-card">
                <h2>{canContinue ? 'Lecția comună s-a încheiat 👏' : 'Ședința s-a încheiat 👏'}</h2>
                <p>{summaryLine(myAnswers)}</p>
                {canContinue && (
                  <p className="lv-ended-more">
                    Poți continua <b>1-la-1</b> cu {teacher?.name || 'profesorul'}, fără cost în plus, <b>până termini exercițiile</b>
                    {endsAtMs && clock.now() < endsAtMs ? ` (chiar dacă trece de ${hhmm(endsAtMs)})` : ''} — alegi orice exercițiu (📋 Exerciții), ceri „Explică altfel" sau îl întrebi orice în chat.
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
              <button type="button" className={panel === 'items' ? 'is-on' : ''} onClick={() => setPanel('items')}>📋 Exerciții</button>
              {!privat && <button type="button" className={panel === 'people' ? 'is-on' : ''} onClick={() => setPanel('people')}>👥 Participanți{handsUp ? ` · ✋${handsUp}` : ''}</button>}
              <button type="button" className="lv-side-x" onClick={() => setPanel(null)} aria-label="Închide">✕</button>
            </div>
            {panel === 'chat'
              ? <LiveChat messages={messages} meId={info.me?.id} teacher={teacher} privat={privat} onSend={sendChat} pendingAnswer={pendingAnswer} prefill={prefill} disabled={ended} />
              : panel === 'items' ? (
                <div className="lv-ip-panel">
                  <div className="lv-ip-intro">
                    {privat
                      ? <>Alege <b>orice exercițiu</b>, nu neapărat la rând — {teacher?.name || 'profesorul'} îl ia cu tine pe barem, apoi te întreabă ce urmează.</>
                      : <>În ședința comună, {teacher?.name || 'profesorul'} merge în ordine pentru toată clasa. Ca să alegi tu exercițiile, intră la o ședință <b>1-la-1</b>{canContinue ? ' (sau „Continuă 1-la-1")' : ''}.</>}
                  </div>
                  <ItemPicker items={lessonItems} current={curItem} status={statusByItem} onPick={pickItem} disabled={!privat || ended || !lessonItems.length} />
                </div>
              )
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
            <button type="button" className={`lv-ctl lv-ctl-items${panel === 'items' ? ' is-on' : ''}`} onClick={() => setPanel(panel === 'items' ? null : 'items')} title="Alege orice exercițiu, nu neapărat la rând">
              <span className="lv-ctl-ico">📋</span><span className="lv-ctl-t">Exerciții</span>
            </button>
          </>)}
          <div className="lv-react-wrap lv-ctl-opt">
            <button type="button" className="lv-ctl" onClick={() => setReactOpen(!reactOpen)}><span className="lv-ctl-ico">😀</span><span className="lv-ctl-t">Reacții</span></button>
            {reactOpen && <div className="lv-react-pop">{REACTIONS.map((e) => <button key={e} type="button" onClick={() => react(e)}>{e}</button>)}</div>}
          </div>
          <button type="button" className={`lv-ctl${hand ? ' is-accent' : ''}${privat ? ' lv-ctl-hand' : ''}`} onClick={toggleHand}><span className="lv-ctl-ico">✋</span><span className="lv-ctl-t">{hand ? 'Coboară' : 'Mâna sus'}</span></button>
          <button type="button" className={`lv-ctl${panel === 'chat' ? ' is-on' : ''}`} onClick={() => setPanel(panel === 'chat' ? null : 'chat')}>
            <span className="lv-ctl-ico">💬</span><span className="lv-ctl-t">Chat</span>
          </button>
          {!privat && (
            <button type="button" className={`lv-ctl${panel === 'people' ? ' is-on' : ''}`} onClick={() => setPanel(panel === 'people' ? null : 'people')}>
              <span className="lv-ctl-ico">👥</span><span className="lv-ctl-t">Participanți</span>
            </button>
          )}
          <button type="button" className="lv-ctl lv-ctl-opt" onClick={() => setNotebook(true)} title="Caietul tău digital"><span className="lv-ctl-ico">✍️</span><span className="lv-ctl-t">Caiet</span></button>
          <button type="button" className={`lv-ctl lv-ctl-opt${cc ? ' is-on' : ''}`} onClick={() => setCc(!cc)} title="Subtitrări"><span className="lv-ctl-ico">CC</span><span className="lv-ctl-t">Subtitrări</span></button>
          {fsButton('lv-ctl lv-ctl-fs')}
          {/* telefon: ce nu încape în bară stă în „⋯" */}
          <div className="lv-more-wrap">
            <button type="button" className={`lv-ctl lv-ctl-more${moreOpen ? ' is-on' : ''}`} onClick={() => setMoreOpen(!moreOpen)} aria-expanded={moreOpen} aria-label="Mai mult">
              <span className="lv-ctl-ico">⋯</span><span className="lv-ctl-t">Mai mult</span>
            </button>
            {moreOpen && (
              <div className="lv-more-pop" role="menu" onClick={() => setMoreOpen(false)}>
                {privat && <button type="button" role="menuitem" onClick={toggleHand}>{hand ? '✋ Coboară mâna' : '✋ Mâna sus (pauză + întrebare)'}</button>}
                {!privat && <button type="button" role="menuitem" onClick={() => setPanel('items')}>📋 Exercițiile subiectului</button>}
                <button type="button" role="menuitem" onClick={() => setNotebook(true)}>✍️ Caietul meu</button>
                <button type="button" role="menuitem" onClick={() => setCc(!cc)}>{cc ? '🅲 Ascunde subtitrările' : '🅲 Arată subtitrările'}</button>
                <button type="button" role="menuitem" onClick={() => setCamOn(!camOn)}>{camOn ? '🚫 Oprește camera mea' : '📷 Pornește camera mea'}</button>
                <div className="lv-more-react" onClick={(e) => e.stopPropagation()}>
                  {REACTIONS.map((e) => <button key={e} type="button" onClick={() => { react(e); setMoreOpen(false); }} aria-label={`Reacție ${e}`}>{e}</button>)}
                </div>
              </div>
            )}
          </div>
        </div>
        <div className="lv-bar-group">
          <button type="button" className="lv-leave" onClick={() => leave(false)} aria-label="Părăsește"><span className="lv-leave-long">Părăsește</span><span className="lv-leave-short">Ieși</span></button>
        </div>
      </footer>

      <SpatiuDeLucru open={notebook} onClose={() => setNotebook(false)} title="Caietul meu"
        enunt={(ps?.head?.statementTry && ['item', 'sondaj'].includes(ps?.scene?.type) ? ps.head.statementTry : ps?.head?.statement) || null} storageKey={`live:${sessionId}`} />
    </div>
  );
}

function lessonWaitText(lesson, teacher) {
  if (!lesson) return 'Pregătesc sala…';
  if (lesson.error && lesson.status === 'eroare') return `Lecția nu s-a putut pregăti: ${lesson.error}`;
  if (lesson.phase === 'pasi') return `${teacher?.name || 'Profesorul'} pregătește întrebările pentru pașii din barem (Subiectele II și III), ca să lucrezi tu fiecare pas — o singură dată pe subiect, cam un minut.`;
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

// demonstrația verifică răspunsurile în browser, cu cheile din scriptul ei
function demoKey(pollId) {
  for (const it of DEMO_SCRIPT.items) {
    for (const p of [it.tryPoll, ...(it.steps || []), it.check]) if (p && p.id === pollId) return { answer: p.answer, explain: p.explain || null };
  }
  return { answer: '', explain: null };
}
// „x² + 2x + 1" = „x^2+2x+1" (demonstrația: fără serverul care verifică matematic)
const demoNorm = (s) => String(s || '').toLowerCase().replace(/\$/g, '').replace(/²/g, '^2').replace(/³/g, '^3').replace(/\\cdot|·|\*/g, '').replace(/,/g, '.').replace(/\s+/g, '');
const demoSame = (a, b) => demoNorm(a) === demoNorm(b);

