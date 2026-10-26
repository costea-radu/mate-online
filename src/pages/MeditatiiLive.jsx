// =====================================================================
// src/pages/MeditatiiLive.jsx — LOBBY-ul meditațiilor live (/meditatii)
//
// Fără texte lungi (cererea din 17 oct. 2026: „prea multe texte — să apară când se
// selectează opțiunea descrisă de ele"). Elevul alege două lucruri:
//   1. EXAMENUL — Evaluarea Națională, BAC Mate-Info, BAC Științele Naturii, BAC
//      Tehnologic (se ține minte);
//   2. CUM LUCREAZĂ — descrierea și alegerile fiecărei opțiuni apar abia când o selectează:
//      · 👥 Ședința de grup: zilnic (implicit 17–19), în sala examenului ales — azi și
//        mâine, cu „Conectează-te" (20 lei sau inclusă în abonament);
//      · 📄 1-la-1 · un subiect întreg: variante date → modele → teste de antrenament →
//        simulări (meditația gratuită a examenului, deasupra) + exercițiul cu care începe
//        (📋, nu neapărat la rând);
//      · 🎯 1-la-1 · un singur tip de exercițiu: Subiectul și exercițiul — la BAC (S. II și
//        III) și subpunctul a), b), c) —, iar profesorul ia DOAR exerciții de acest tip, din
//        subiectele oficiale, fiecare pe baremul lui, fără să treacă la alt tip (clasa
//        Pregătirii de examen: /meditatii/pregatire?…&doar=1);
//      · 🎁 Gratuit: câte o meditație 1-la-1 pe examen, fără abonament (alese din Admin).
//   1-la-1 = 60 de minute, prelungite până termină exercițiile; 30 lei sau 8 pe lună
//   incluse în abonament.
// „💳 Prețuri" (în prezentare) deschide lista tuturor prețurilor, cu și fără abonament.
// Demonstrațiile (grup / 1-la-1, fără cont) — chiar sus. „Cum decurge o ședință" — la cerere.
// Planul personal (plan, teme, recapitulări, rapoarte): tabul „Planul meu".
// Linkuri: ?mod=grup|subiect|tip|gratuit (?unu=1 = subiect), #gratuit.
// =====================================================================
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { liveApi, buyTicket } from '../lib/live/api';
import { clock } from '../lib/live/clock';
import { loadRig, initials, teacherColor } from '../lib/live/profesori';
import ItemPicker from '../components/live/ItemPicker';
import PrepPicker from '../components/live/PrepPicker';
import PriceList from '../components/live/PriceList';
import { defaultRefs, refLabel, prepPositions } from '../lib/live/items';
import '../styles/live.css';

// examenele: sala de grup a fiecăruia (L.ROOMS) și ținta Pregătirii de examen (P.TARGETS)
const EXAMS = [
  { id: 'en', exam: 'en', profile: null, room: 'en', target: 'evaluare-nationala', label: 'Evaluarea Națională' },
  { id: 'mate-info', exam: 'bac', profile: 'mate-info', room: 'mi', target: 'bac-mate-info', label: 'BAC Mate-Info' },
  { id: 'stiinte-naturii', exam: 'bac', profile: 'stiinte-naturii', room: 'sn', target: 'bac-stiinte', label: 'BAC Științele Naturii' },
  { id: 'tehnologic', exam: 'bac', profile: 'tehnologic', room: 'teh', target: 'bac-tehnologic', label: 'BAC Tehnologic' },
];
const MODES = ['grup', 'subiect', 'tip', 'gratuit'];
// felurile de subiecte, în ordinea listei (oglinda lui L.SUBJECT_KINDS)
const KINDS = [
  { id: 'varianta', label: 'Variante date' },
  { id: 'model', label: 'Modele' },
  { id: 'test', label: 'Teste de antrenament' },
  { id: 'simulare', label: 'Simulări' },
  { id: 'alt', label: 'Alte subiecte' },
];
const FREE_EXAMS = 4;        // meditațiile gratuite: câte una pe examen (EN + cele 3 profiluri de BAC)
const EXAM_KEY = 'live:examen';
const MODE_KEY = 'live:mod';
const OLD_ROOM_KEY = 'live:sala';   // filtrul vechi pe săli („mi", „sn"…) → examenul
const store = {
  get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* fără stocare */ } },
};
function readExam() {
  const v = store.get(EXAM_KEY);
  if (EXAMS.some((x) => x.id === v)) return v;
  const old = EXAMS.find((x) => x.room === store.get(OLD_ROOM_KEY));
  return old ? old.id : 'en';
}
function readMode(params) {
  const q = params.get('mod');
  if (MODES.includes(q)) return q;
  if (params.get('unu') === '1' || params.get('tip') === 'privat') return 'subiect';
  if (typeof window !== 'undefined' && window.location.hash === '#gratuit') return 'gratuit';
  const v = store.get(MODE_KEY);
  return MODES.includes(v) ? v : 'grup';
}
const joinRo = (xs) => (xs.length > 1 ? `${xs.slice(0, -1).join(', ')} și ${xs[xs.length - 1]}` : xs[0] || '');
const hm = (iso) => new Date(iso).toLocaleTimeString('ro-RO', { hour: '2-digit', minute: '2-digit' });
function relIn(ms) {
  const m = Math.round(ms / 60000);
  if (m < 60) return `în ${m} min`;
  const h = Math.floor(m / 60), r = m % 60;
  return `în ${h} h${r ? ` ${r} min` : ''}`;
}

// „Adaugă în calendar" — un fișier .ics simplu (Google/Apple/Outlook îl deschid)
function icsFor(s, teacher) {
  const f = (iso) => new Date(iso).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const body = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//ExamenMate//Meditatii live//RO', 'BEGIN:VEVENT',
    `UID:${s.id}@examenmate.com`, `DTSTAMP:${f(new Date().toISOString())}`, `DTSTART:${f(s.starts_at)}`, `DTEND:${f(s.ends_at)}`,
    `SUMMARY:Meditație live — ${teacher?.name || 'profesor virtual'} (${s.examLabel})`,
    `DESCRIPTION:${(s.subject?.title || '').replace(/[,;\n]/g, ' ')} — https://examenmate.com/meditatii/sala/${s.id}`,
    `URL:https://examenmate.com/meditatii/sala/${s.id}`,
    'BEGIN:VALARM', 'TRIGGER:-PT10M', 'ACTION:DISPLAY', 'DESCRIPTION:Meditația începe în 10 minute', 'END:VALARM',
    'END:VEVENT', 'END:VCALENDAR',
  ].join('\r\n');
  return `data:text/calendar;charset=utf-8,${encodeURIComponent(body)}`;
}

export default function MeditatiiLive() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  const [teacherId, setTeacherId] = useState(null);
  const [rigs, setRigs] = useState({});
  const [banner, setBanner] = useState(null);
  const [busy, setBusy] = useState(null);
  const [examId, setExamId] = useState(readExam);                  // examenul (se ține minte)
  const [mode, setMode] = useState(() => readMode(params));        // cum lucrează (se ține minte)
  const [subjects, setSubjects] = useState(null);
  const [kinds, setKinds] = useState(KINDS);
  const [subjectId, setSubjectId] = useState(null);
  const [subjErr, setSubjErr] = useState(null);
  const [startRef, setStartRef] = useState(null);      // 1-la-1 pe subiect: exercițiul cu care începe (null = de la început)
  const [startOpen, setStartOpen] = useState(false);
  const [typePos, setTypePos] = useState(null);        // „🎯 Un singur tip": poziția aleasă („III.1.c")
  const [pricesOpen, setPricesOpen] = useState(false); // „💳 Prețuri": lista prețurilor
  const closePrices = useCallback(() => setPricesOpen(false), []);
  const E = EXAMS.find((x) => x.id === examId) || EXAMS[0];
  const pickExam = (id) => { setExamId(id); store.set(EXAM_KEY, id); setStartRef(null); setTypePos(null); };
  const pickMode = (m) => { setMode(m); if (m !== 'gratuit') store.set(MODE_KEY, m); };

  // linkurile vechi către planul personal (?tab=teme etc.) → „Planul meu"
  useEffect(() => {
    if (params.get('tab') || params.get('temaId')) navigate(`/meditatii/plan?${params.toString()}`, { replace: true });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const load = useCallback(async () => {
    try { const d = await liveApi.program(); setData(d); setErr(null); return d; }
    catch (e) { setErr(e.message); return null; }
  }, []);
  useEffect(() => { if (!loading) load(); }, [loading, user, load]);
  useEffect(() => { const t = setInterval(load, 60000); return () => clearInterval(t); }, [load]);

  useEffect(() => {
    if (!data?.teachers) return;
    if (!teacherId) setTeacherId(data.teachers[0]?.id || null);
    data.teachers.forEach((t) => loadRig(t.id).then((r) => setRigs((p) => (p[t.id] === r ? p : { ...p, [t.id]: r }))));
  }, [data?.teachers]); // eslint-disable-line react-hooks/exhaustive-deps

  // întoarcerea de la plată
  useEffect(() => {
    const plata = params.get('plata');
    if (!plata) return;
    if (plata === 'anulat') setBanner({ kind: 'info', text: 'Plata a fost anulată. Nu s-a încasat nimic.' });
    if (plata === 'ok') {
      const tip = params.get('tip'), ses = params.get('sesiune');
      setBanner({ kind: 'ok', text: tip === 'privat' ? 'Plata a reușit! Biletul pentru ședința 1-la-1 e în contul tău — alege subiectul și începe.' : 'Plata a reușit! Biletul apare în câteva secunde…', sessionId: ses || null });
      if (tip === 'privat') setMode('subiect');
      else setMode('grup');
      // webhookul Stripe poate întârzia câteva secunde → reîncărcăm de câteva ori
      let n = 0;
      const t = setInterval(async () => {
        const d = await load();
        n++;
        const s = d && ses ? d.days.flatMap((x) => x.sessions).find((x) => x.id === ses) : null;
        if ((s && s.access?.ok) || n > 8) {
          clearInterval(t);
          if (s && s.access?.ok) setBanner({ kind: 'ok', text: 'Biletul e activ ✓', sessionId: ses, ready: true });
        }
      }, 2500);
      return () => clearInterval(t);
    }
    return undefined;
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const clearParams = () => { if (params.toString()) setParams({}, { replace: true }); };
  const teacher = data?.teachers?.find((t) => t.id === teacherId) || data?.teachers?.[0] || null;
  const tName = teacher?.name || 'Prof. Tudor';
  const me = data?.me || { loggedIn: false };
  const liveNow = useMemo(() => (data?.days || []).flatMap((d) => d.sessions).filter((s) => s.phase === 'live').length, [data]);

  async function pay(kind, sessionId = null) {
    if (!me.loggedIn) { navigate('/autentificare'); return; }
    setBusy(`pay-${sessionId || kind}`);
    try { window.location.href = await buyTicket({ kind, sessionId, teacher: teacherId, returnTo: '/meditatii' }); }
    catch (e) { setBanner({ kind: 'err', text: e.message }); setBusy(null); }
  }

  // ─── 1-la-1 pe un subiect: subiectele cu barem ale examenului ales ──
  useEffect(() => {
    if (mode !== 'subiect' || !me.loggedIn || !teacherId) return undefined;
    let alive = true;
    setSubjects(null); setSubjErr(null);
    liveApi.privateSubjects(E.exam, teacherId, E.profile)
      .then((r) => {
        if (!alive) return;
        const list = r.subjects || [];
        setSubjects(list);
        if (r.kinds?.length) setKinds(r.kinds);
        // selecția implicită (și la schimbarea examenului): meditația gratuită (sus, 🎁), altfel primul subiect
        setSubjectId((cur) => (list.some((s) => s.id === cur) ? cur : (list.find((s) => s.free) || list[0])?.id || null));
      })
      .catch((e) => alive && setSubjErr(e.message));
    return () => { alive = false; };
  }, [mode, me.loggedIn, teacherId, examId]); // eslint-disable-line react-hooks/exhaustive-deps

  async function startPrivate(sid = subjectId, ref = startRef, busyKey = 'private') {
    if (!sid) return;
    if (!me.loggedIn) { navigate('/autentificare'); return; }
    setBusy(busyKey);
    try {
      const r = await liveApi.privateStart(teacherId || data?.teachers?.[0]?.id, sid);
      navigate(`/meditatii/sala/${r.sessionId}${ref ? `?ex=${encodeURIComponent(ref)}` : ''}`);
    } catch (e) {
      if (e.code === 'LIVE_PAYMENT') {
        setBusy(null);
        setBanner({ kind: 'info', text: e.message, pay: 'privat' });
        return;
      }
      setBanner({ kind: 'err', text: e.message });
      setBusy(null);
    }
  }

  // „🎯 Un singur tip de exercițiu": clasa Pregătirii de examen, pe examenul ales aici, cu
  // `doar=1` — profesorul rămâne la acest tip (și la subpunctul ales); ședința 1-la-1 pornește acolo
  function startType() {
    if (!typePos) return;
    const url = `/meditatii/pregatire?pos=${encodeURIComponent(typePos)}&examen=${encodeURIComponent(E.target)}&din=live&doar=1`;
    if (!me.loggedIn) { navigate('/autentificare'); return; }
    navigate(url);
  }

  const priv = me.private;
  // cât durează pregătirea unei lecții noi (din lecțiile scrise până acum — api/live.js → prepEta)
  const prepLabel = data?.prepEta?.label ? data.prepEta.label.replace(' minute', ' min') : 'câteva min';
  const prices = data?.prices || { grup: 20, privat: 30, privatMin: 60, privatIncluse: 8 };
  const rooms = data?.rooms || [];
  const timesLabel = (data?.intervals || []).map((i) => i.label).join(' și ') || '17:00–19:00';
  const starts = (data?.intervals?.length ? data.intervals : [{ label: '17:00–19:00' }]).map((i) => i.label.split('–')[0]);
  const whenText = starts.length === 1 ? `de la ora ${starts[0]}` : `la orele ${joinRo(starts)}`;
  const room = rooms.find((r) => r.id === E.room) || null;   // sala de grup a examenului (LIVE_SALI o poate scoate)
  const sessionsOf = (day) => day.sessions.filter((s) => s.teacher === teacherId && s.room?.id === E.room);
  // 🎁 meditațiile gratuite — câte una pe examen; cea a examenului ales e prima
  const ofExam = (f) => f.exam === E.exam && (f.exam === 'en' || f.profile === E.profile);
  const freeList = (data?.freeLessons || []).slice().sort((a, b) => Number(ofExam(b)) - Number(ofExam(a)));
  const freeN = freeList.length;
  const freeLeft = me.free ? me.free.left : null;            // null = nelogat
  const freeScope = freeN >= FREE_EXAMS ? 'pentru fiecare examen' : freeN > 0 ? `la ${joinRo(freeList.map((f) => f.examLabel))}` : '';
  const modeOn = mode === 'gratuit' && !freeN ? 'grup' : mode;
  // lista subiectelor pe feluri; meditația gratuită stă deasupra, separat (🎁)
  const selectedFree = !!subjects?.find((x) => x.id === subjectId)?.free;
  const startLabel = busy === 'private' ? 'Pornesc…'
    : selectedFree && priv?.via !== 'admin' && freeLeft !== 0 ? '🎁 Începe gratuit'
      : priv?.ok ? '▶ Începe' : `Începe · ${prices.privat} lei`;
  const freeSubject = subjects?.find((x) => x.free) || null;
  const subjectGroups = kinds.map((k) => ({ ...k, items: (subjects || []).filter((x) => (x.kind || 'alt') === k.id && x !== freeSubject) }))
    .filter((g) => g.items.length);
  const renderSubject = (x) => (
    <button type="button" key={x.id} role="option" aria-selected={x.id === subjectId} className={`lvl-subject${x.id === subjectId ? ' is-on' : ''}${x.free ? ' is-free' : ''}`} onClick={() => setSubjectId(x.id)}>
      <span>{x.free && <span className="lvl-free-tag">🎁 gratuit</span>}{x.title}</span>
      {x.ready ? <span className="lvl-ready">✓ gata de pornire</span> : x.scriptReady ? <span className="lvl-ready" style={{ color: '#8a6d1a' }}>~1 min pregătire</span> : <span className="lvl-ready" style={{ color: '#80868b' }} title="Lecția se scrie o singură dată pe subiect, când o pornești — te anunțăm când e gata">{prepLabel} pregătire</span>}
    </button>
  );
  // „🎯 Un singur tip": pozițiile examenului (la BAC, S. II și III și pe subpuncte)
  const typePositions = useMemo(() => prepPositions(E.exam), [E.exam]);
  const typeSel = typePositions.find((p) => p.pos === typePos) || null;
  // dreptul la 1-la-1 (subiect întreg / un singur tip), pe scurt
  const quota = me.loggedIn && priv ? (
    priv.via === 'admin' ? <span className="lvl-quota">✓ Cont de administrator — nelimitat</span>
      : priv.included > 0 ? <span className={`lvl-quota${priv.includedLeft ? '' : ' is-paid'}`}>{priv.includedLeft ? `✓ ${priv.includedLeft} din ${priv.included} incluse luna aceasta` : `Ai folosit cele ${priv.included} incluse luna aceasta · ${prices.privat} lei ședința`}</span>
        : <span className="lvl-quota is-paid">{prices.privat} lei ședința · sau {prices.privatIncluse} pe lună incluse în abonament</span>
  ) : null;
  const tickets = priv?.unusedTickets > 0 ? <span className="lvl-quota" style={{ marginLeft: 8 }}>🎟 {priv.unusedTickets} {priv.unusedTickets === 1 ? 'bilet' : 'bilete'} 1-la-1</span> : null;

  const MODE_INFO = {
    grup: { ico: '👥', title: 'Ședință de grup', sub: `zilnic, ${starts.length === 1 ? `ora ${starts[0]}` : joinRo(starts)}` },
    subiect: { ico: '📄', title: '1-la-1: un subiect întreg', sub: 'oricând' },
    tip: { ico: '🎯', title: '1-la-1: un singur tip de exercițiu', sub: E.exam === 'bac' ? 'ex. S. III ex. 1 c)' : 'ex. S. III ex. 2' },
    gratuit: { ico: '🎁', title: 'Gratuit', sub: 'o meditație pe examen' },
  };

  return (
    <div className="lvl">
      <div className="lvl-tabs">
        <span className="lvl-tab is-on">🎥 Meditații live</span>
        <Link to="/meditatii/plan" className="lvl-tab">📚 Planul meu</Link>
        {me.admin && <Link to="/admin?tab=live" className="lvl-tab">⚙ Programul (admin)</Link>}
      </div>

      {banner && (
        <div className={`lvl-banner is-${banner.kind}`}>
          <span>{banner.text}</span>
          <span style={{ display: 'flex', gap: 8 }}>
            {banner.ready && banner.sessionId && <button type="button" className="lv-btn-primary" onClick={() => navigate(`/meditatii/sala/${banner.sessionId}`)}>Intră acum</button>}
            {banner.pay === 'privat' && <button type="button" className="lv-btn-primary" onClick={() => pay('privat')}>Plătește {prices.privat} lei</button>}
            <button type="button" className="lv-btn-soft" onClick={() => { setBanner(null); clearParams(); }}>OK</button>
          </span>
        </div>
      )}

      <section className="lvl-hero">
        <div>
          <h1>Meditații live — cu profesorul virtual</h1>
          <p className="lvl-hero-sub">{tName} <span className="lv-tag-ai">Profesor virtual · AI</span> — explică <b>strict pe baremul oficial</b>.</p>
          <div className="lvl-hero-cta">
            <Link to="/meditatii/demo" className="lvl-demo-btn">
              <span className="lvl-demo-play" aria-hidden="true">▶</span>
              <span><b>Vezi demo-ul</b><small>o meditație de grup · 2 minute · fără cont</small></span>
            </Link>
            <Link to="/meditatii/demo-1la1" className="lvl-demo-btn is-soft">
              <span className="lvl-demo-play" aria-hidden="true">▶</span>
              <span><b>Demo 1-la-1</b><small>doar tu și profesorul</small></span>
            </Link>
          </div>
          <div className="lvl-hero-chips">
            {liveNow > 0 && <span className="lvl-chip is-live"><span className="lv-dot-live" /> {liveNow} {liveNow === 1 ? 'ședință' : 'ședințe'} live acum</span>}
            {freeN > 0 && (
              <button type="button" className="lvl-chip is-free"
                onClick={() => { pickMode('gratuit'); setTimeout(() => document.getElementById('lvl-panel')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60); }}>
                🎁 {freeN > 1 ? 'câte o meditație gratuită pe examen' : 'o meditație gratuită'}
              </button>
            )}
            <span className="lvl-chip">📅 zilnic {timesLabel}</span>
            <button type="button" className="lvl-chip is-btn" onClick={() => setPricesOpen(true)} aria-haspopup="dialog">💳 Prețuri</button>
          </div>
        </div>
        <Link to="/meditatii/demo" className="lvl-hero-mock" title="Vezi demo-ul sălii">
          <span className="lvl-mock-play" aria-hidden="true">▶ Demo</span>
          <div className="lvl-mock-stage">
            <div className="lvl-mock-wb"><b style={{ color: '#1f5faa' }}>Subiectul I, ex. 3</b><br />{'Δ = b² − 4ac = 16'}<br />{'x₁,₂ = (−b ± √Δ) / 2a'}<br />{'⇒ x₁ = 3, x₂ = −1 (2p)'}</div>
            <div className="lvl-mock-dg"><span style={{ color: '#e8b931', fontWeight: 800 }}>ENUNȚ · 5 PUNCTE</span><br />Soluțiile ecuației x² − 2x − 3 = 0 sunt…</div>
            <div className="lvl-mock-pip">{rigs[data?.teachers?.[0]?.id]?.thumb ? <img src={rigs[data.teachers[0].id].thumb} alt="" /> : <span>{initials(data?.teachers?.[0]?.name || 'Prof. Tudor')}</span>}</div>
          </div>
          <div className="lvl-mock-bar"><i /><i /><i /><i /><i className="r" /></div>
        </Link>
      </section>

      {pricesOpen && (
        <PriceList prices={data?.prices} timesLabel={timesLabel} roomsCount={rooms.length || 4} freeCount={freeN} freeScope={freeScope}
          me={data ? me : null} onClose={closePrices} />
      )}

      {err && <div className="lvl-banner is-err"><span>{err}</span></div>}
      {!data && !err && <div style={{ display: 'flex', justifyContent: 'center', padding: 40 }}><div className="spinner" /></div>}

      {data && (<>
        {/* mai mulți profesori (LIVE_PROFESORI): alegerea lui; cu unul singur, nimic de ales */}
        {data.teachers.length > 1 && (
          <div className="lvl-teachers">
            {data.teachers.map((t) => (
              <button type="button" key={t.id} className={`lvl-teacher${t.id === teacherId ? ' is-on' : ''}`} onClick={() => setTeacherId(t.id)}>
                <span className="lvl-tphoto" style={{ background: teacherColor(t) }}>{rigs[t.id]?.thumb ? <img src={rigs[t.id].thumb} alt={t.name} /> : initials(t.name)}</span>
                <span className="lvl-tname">{t.name} <span className="lv-tag-ai">Profesor virtual · AI</span></span>
              </button>
            ))}
          </div>
        )}

        <div className="lvl-choose">
          <div className="lvl-choose-row">
            <span className="lvl-choose-label" id="lvl-exam-l">Examenul tău</span>
            <div className="lvl-rooms" role="group" aria-labelledby="lvl-exam-l">
              {EXAMS.map((x) => (
                <button type="button" key={x.id} className={`lvl-pill${x.id === examId ? ' is-on' : ''}`} aria-pressed={x.id === examId} onClick={() => pickExam(x.id)}>{x.label}</button>
              ))}
            </div>
          </div>
          <div className="lvl-choose-row">
            <span className="lvl-choose-label" id="lvl-mode-l">Cum lucrezi</span>
            <div className="lvl-modes" role="tablist" aria-labelledby="lvl-mode-l">
              {MODES.filter((m) => m !== 'gratuit' || freeN > 0).map((m) => (
                <button type="button" key={m} role="tab" id={`lvl-tab-${m}`} aria-selected={modeOn === m} aria-controls="lvl-panel"
                  className={`lvl-mode${modeOn === m ? ' is-on' : ''}${m === 'gratuit' ? ' is-free' : ''}`} onClick={() => pickMode(m)}>
                  <span className="lvl-mode-ico" aria-hidden="true">{MODE_INFO[m].ico}</span>
                  <span><b>{MODE_INFO[m].title}</b><small>{MODE_INFO[m].sub}</small></span>
                </button>
              ))}
            </div>
          </div>
        </div>

        <section className="lvl-panel" id="lvl-panel" role="tabpanel" aria-labelledby={`lvl-tab-${modeOn}`}>
          {/* ─── 👥 ȘEDINȚA DE GRUP: sala examenului ales, azi și mâine ─── */}
          {modeOn === 'grup' && (<>
            <p className="lvl-panel-desc">
              Zilnic, {whenText}, {tName} rezolvă un subiect întreg de {E.label}, strict pe barem: încerci singur, răspunzi pe ecran la fiecare pas din barem, întrebi în chat.
              Dacă ești singurul elev, ședința devine 1-la-1, fără cost în plus.
            </p>
            <div className="lvl-panel-price">{prices.grup} lei ședința · inclusă în abonament</div>
            {!room ? <div className="lvl-empty">Pentru {E.label} nu există ședințe de grup — alege „1-la-1".</div> : (
              <div className="lvl-days">
                {data.days.map((d) => (
                  <div key={d.day} className="lvl-day">
                    <h3>{d.label}</h3>
                    {sessionsOf(d).length === 0 && <div className="lvl-empty">Nicio ședință.</div>}
                    {sessionsOf(d).map((s) => {
                      const startsIn = new Date(s.starts_at).getTime() - clock.now();
                      const open = s.phase === 'live' || s.phase === 'sala_asteptare';
                      return (
                        <div key={s.id} className={`lvl-slot${s.phase === 'live' ? ' is-live' : ''}${s.phase === 'incheiata' || s.phase === 'anulata' ? ' is-past' : ''}`}>
                          <div>
                            <div className="lvl-slot-time">{s.label}</div>
                            <div className={`lvl-slot-state${s.phase === 'live' ? ' is-live' : ''}`}>
                              {s.phase === 'live' && <><span className="lv-dot-live" /> LIVE · {s.present} {s.present === 1 ? 'elev' : 'elevi'}</>}
                              {s.phase === 'sala_asteptare' && `Sala e deschisă · ${relIn(startsIn)}`}
                              {s.phase === 'viitoare' && relIn(startsIn)}
                              {s.phase === 'incheiata' && 'Încheiată'}
                              {s.phase === 'anulata' && 'Anulată'}
                            </div>
                          </div>
                          <div>
                            {s.free && <span className="lvl-free-tag">🎁 meditație gratuită</span>}
                            <div className="lvl-slot-subj">{s.subject?.title || 'Subiectul se anunță în curând'}</div>
                            {s.lesson === 'gata' && <div className="lvl-slot-meta">✓ lecția e pregătită pe barem</div>}
                          </div>
                          <div className="lvl-slot-cta">
                            {s.access?.ok
                              ? <span className="lvl-price">{s.access.via === 'gratuit' ? '🎁 Gratuit' : s.access.via === 'bilet' ? '✓ Ai bilet' : s.access.via === 'admin' ? '✓ Admin' : '✓ Inclus în abonament'}</span>
                              : s.phase !== 'incheiata' && (s.free
                                ? <span className="lvl-price is-free">🎁 Gratuit</span>
                                : <span className="lvl-price is-paid">{s.access?.price ?? prices.grup} lei</span>)}
                            {open && (!me.loggedIn
                              ? <Link className="lv-btn-primary" to="/autentificare">Intră în cont</Link>
                              : s.access?.ok
                                ? <button type="button" className="lv-btn-primary" onClick={() => navigate(`/meditatii/sala/${s.id}`)}>Conectează-te</button>
                                : <button type="button" className="lv-btn-primary" disabled={busy === `pay-${s.id}`} onClick={() => pay('grup', s.id)}>{busy === `pay-${s.id}` ? '…' : `Plătește ${s.access?.price ?? prices.grup} lei`}</button>)}
                            {s.phase === 'viitoare' && (me.loggedIn && !s.access?.ok
                              ? <button type="button" className="lv-btn-soft" disabled={busy === `pay-${s.id}`} onClick={() => pay('grup', s.id)}>Rezervă · {s.access?.price ?? prices.grup} lei</button>
                              : <a className="lv-btn-soft" href={icsFor(s, teacher)} download={`meditatie-${s.day}-${s.slot}.ics`}>📅 În calendar</a>)}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ))}
              </div>
            )}
          </>)}

          {/* ─── 📄 1-LA-1 PE UN SUBIECT ÎNTREG ─── */}
          {modeOn === 'subiect' && (<>
            <p className="lvl-panel-desc">
              Doar tu și {tName}, oricând: alegi un subiect de {E.label} cu barem și, dacă vrei, exercițiul cu care începi.
              {' '}{prices.privatMin} de minute, prelungite până termini exercițiile — fără cost în plus.
            </p>
            <div className="lvl-panel-price">{quota}{tickets}</div>
            {!me.loggedIn ? <Link className="lv-btn-primary lv-btn-lg" to="/autentificare">Intră în cont ca să alegi subiectul</Link> : (<>
              {subjErr && <div className="lvl-banner is-err"><span>{subjErr}</span></div>}
              {!subjects && !subjErr && <div className="lvl-empty">Caut subiectele cu barem…</div>}
              {subjects && subjects.length === 0 && <div className="lvl-empty">Nu am încă subiecte cu barem pentru {E.label}. (Profesorul explică doar subiectele cu barem.)</div>}
              {subjects && subjects.length > 0 && (
                <div className="lvl-subjects" role="listbox" aria-label="Subiectul">
                  {freeSubject && (
                    <div className="lvl-subj-group is-free" role="group" aria-label="Meditația gratuită">
                      <div className="lvl-subj-head">🎁 Meditația gratuită{freeLeft === 0 && priv?.via !== 'admin' ? ' (ai folosit-o luna aceasta)' : ''}</div>
                      {renderSubject(freeSubject)}
                    </div>
                  )}
                  {subjectGroups.map((g) => (
                    <div key={g.id} className="lvl-subj-group" role="group" aria-label={g.label}>
                      <div className="lvl-subj-head">{g.label}<span>{g.items.length}</span></div>
                      {g.items.map(renderSubject)}
                    </div>
                  ))}
                </div>
              )}
              {subjects && subjects.length > 0 && (
                <div className="lvl-startpick">
                  <button type="button" className="lv-pre-pick-toggle" onClick={() => setStartOpen(!startOpen)} aria-expanded={startOpen}>
                    <span>📋 Cu ce exercițiu începi? <b>{startRef ? refLabel(startRef) : 'De la început, în ordine'}</b></span>
                    <span aria-hidden="true">{startOpen ? '▴' : '▾'}</span>
                  </button>
                  {startOpen && (
                    <ItemPicker items={defaultRefs(E.exam)} compact selectedRef={startRef} allowAll onAll={() => setStartRef(null)} onPick={(it) => setStartRef(it.ref)}
                      note="Orice exercițiu, nu neapărat la rând. După el, profesorul te întreabă ce urmează." />
                  )}
                </div>
              )}
              <div className="lv-pre-actions" style={{ marginTop: 12 }}>
                <button type="button" className="lv-btn-primary lv-btn-lg" disabled={!subjectId || busy === 'private'} onClick={() => startPrivate()}>{startLabel}</button>
              </div>
            </>)}
          </>)}

          {/* ─── 🎯 1-LA-1 PE UN SINGUR TIP DE EXERCIȚIU (din toate subiectele oficiale) ─── */}
          {modeOn === 'tip' && (<>
            <p className="lvl-panel-desc">
              {tName} îți dă doar exercițiul ales — din toate subiectele oficiale de {E.label}, fiecare explicat pe baremul lui.
              Când termini unul, primești altul de același tip{E.exam === 'bac' ? ' și poți alege iar subpunctul (a, b sau c)' : ''}; nu trece la alt tip de exercițiu.
              {' '}{prices.privatMin} de minute, prelungite până termini.
            </p>
            <div className="lvl-panel-price">{quota}{tickets}</div>
            <div className="lvl-type-pick">
              <div className="lvl-startpick-title">
                Alege exercițiul{E.exam === 'bac' ? ' — la Subiectele II și III, „Ex." = toată problema, a) / b) / c) = doar subpunctul' : ''}:
              </div>
              <PrepPicker positions={typePositions} selected={typePos} compact onPick={(p) => setTypePos(p.pos === typePos ? null : p.pos)} />
              {E.exam === 'en' && typeSel?.sub === 'III' && <div className="lvl-type-note">La Evaluarea Națională, problemele de la Subiectul al III-lea se lucrează întregi (a și b).</div>}
            </div>
            <div className="lv-pre-actions" style={{ marginTop: 12 }}>
              {!me.loggedIn
                ? <Link className="lv-btn-primary lv-btn-lg" to="/autentificare">Intră în cont și începe</Link>
                : <button type="button" className="lv-btn-primary lv-btn-lg" disabled={!typeSel} onClick={startType}>{typeSel ? `▶ Începe: ${typeSel.short}` : 'Alege exercițiul'}</button>}
            </div>
          </>)}

          {/* ─── 🎁 GRATUIT: câte o meditație 1-la-1 pe examen ─── */}
          {modeOn === 'gratuit' && freeN > 0 && (<>
            <p className="lvl-panel-desc">
              Câte o lecție completă {freeScope}, 1-la-1 cu {tName}, pe baremul oficial — <b>fără abonament și fără card</b>; ai nevoie doar de un cont.
            </p>
            <div className="lvl-free-list" id="gratuit">
              {freeList.map((f) => {
                const key = `free-${f.subjectId}`;
                const label = freeLeft === 0 ? (priv?.ok ? 'Începe' : `Începe · ${prices.privat} lei`) : '▶ Începe gratuit';
                return (
                  <div key={f.subjectId} className={`lvl-free-card${ofExam(f) ? ' is-mine' : ''}`}>
                    <span className={`lvl-slot-exam${f.exam === 'bac' ? ' is-bac' : ''}`}>{f.examLabel}</span>
                    <div className="lvl-free-title">{f.title}</div>
                    <div className="lvl-free-meta">{f.ready ? '✓ gata de pornire' : `se pregătește când pornești (${prepLabel}; te anunțăm când e gata)`}</div>
                    {!me.loggedIn
                      ? <Link className="lv-btn-primary" to="/autentificare">Intră în cont și începe</Link>
                      : <button type="button" className="lv-btn-primary" disabled={!!busy} onClick={() => startPrivate(f.subjectId, null, key)}>{busy === key ? 'Pornesc…' : label}</button>}
                  </div>
                );
              })}
            </div>
            {me.loggedIn && freeLeft === 0 && (
              <p className="lvl-free-note">Ai făcut deja cele {me.free.monthly} meditații gratuite din luna aceasta; de luna viitoare le poți face din nou.</p>
            )}
          </>)}
        </section>

        {me.privateSessions?.length > 0 && (<>
          <h2 className="lvl-section-title">Ședințele mele 1-la-1</h2>
          <div className="lvl-mine">
            {me.privateSessions.map((s) => (
              <div key={s.id} className="lvl-mine-row">
                <span><b>{data.teachers.find((t) => t.id === s.teacher)?.name || s.teacher}</b> · {s.subject?.title} · {new Date(s.created_at).toLocaleDateString('ro-RO')} {hm(s.created_at)}</span>
                {s.phase !== 'incheiata' && s.status !== 'incheiata'
                  ? <button type="button" className="lv-btn-primary" onClick={() => navigate(`/meditatii/sala/${s.id}`)}>{s.started ? 'Reia' : 'Intră'}</button>
                  : <span style={{ color: 'var(--text-muted)' }}>încheiată</span>}
              </div>
            ))}
          </div>
        </>)}

        {/* cum decurge o ședință — doar la cerere */}
        <details className="lvl-how-wrap">
          <summary>ℹ️ Cum decurge o ședință</summary>
          <div className="lvl-how">
            <div><b>1. Te conectezi</b>Apeși „Conectează-te" (grup) sau „Începe" (1-la-1). Poți intra pe tot ecranul.</div>
            <div><b>2. Încerci singur</b>La fiecare exercițiu profesorul îți dă timp să rezolvi: răspunzi la grilă sau scrii rezultatul.</div>
            <div><b>3. Explicația pe barem</b>Pe tablă, pașii din barem și câte puncte valorează fiecare. La Subiectele II și III calculezi tu fiecare pas, apoi el îl scrie.</div>
            <div><b>4. Întrebi oricând</b>În chat sau cu microfonul (vocea ta devine text). Profesorul răspunde pe loc, tot pe barem.</div>
          </div>
        </details>
        <p className="lvl-note">
          Profesorul este <b>virtual (inteligență artificială)</b>: vocea și imaginea sunt generate. Camera și microfonul tău nu ajung la profesor sau la colegi.
        </p>
      </>)}
    </div>
  );
}
