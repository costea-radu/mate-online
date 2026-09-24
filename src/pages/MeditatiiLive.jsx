// =====================================================================
// src/pages/MeditatiiLive.jsx — LOBBY-ul meditațiilor live (/meditatii)
//
// Alegi profesorul, vezi ședințele de azi și de mâine (15–17, 17–19, 19–21),
// cu subiectul fiecăreia (EN sau BAC, explicat pe barem), câți colegi sunt
// deja înăuntru și prețul (10 lei sau inclus în abonament), apoi apeși
// „Conectează-te". Ședințele 1-la-1 pornesc oricând (60 de minute; 20 lei sau
// 8 pe lună incluse în abonament). Planul personal de până acum (plan, teme,
// recapitulări, rapoarte) a rămas neatins, în tabul „Planul meu".
// =====================================================================
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { liveApi, buyTicket } from '../lib/live/api';
import { clock } from '../lib/live/clock';
import { loadRig, initials, teacherColor } from '../lib/live/profesori';
import '../styles/live.css';

const BAC_PROFILES = [
  { id: 'mate-info', label: 'BAC M_mate-info' },
  { id: 'stiinte-naturii', label: 'BAC M_șt-nat' },
  { id: 'tehnologic', label: 'BAC M_tehnologic' },
  { id: 'pedagogic', label: 'BAC M_pedagogic' },
];

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
  const [pickOpen, setPickOpen] = useState(params.get('unu') === '1');
  const [exam, setExam] = useState('en');
  const [profile, setProfile] = useState('mate-info');
  const [subjects, setSubjects] = useState(null);
  const [subjectId, setSubjectId] = useState(null);
  const [subjErr, setSubjErr] = useState(null);

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
      if (tip === 'privat') setPickOpen(true);
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
  const teacher = data?.teachers?.find((t) => t.id === teacherId) || null;
  const me = data?.me || { loggedIn: false };
  const liveNow = useMemo(() => (data?.days || []).flatMap((d) => d.sessions).filter((s) => s.phase === 'live').length, [data]);

  async function pay(kind, sessionId = null) {
    if (!me.loggedIn) { navigate('/autentificare'); return; }
    setBusy(`pay-${sessionId || kind}`);
    try { window.location.href = await buyTicket({ kind, sessionId, teacher: teacherId, returnTo: '/meditatii' }); }
    catch (e) { setBanner({ kind: 'err', text: e.message }); setBusy(null); }
  }

  // ─── 1-la-1: subiectele cu barem ──
  useEffect(() => {
    if (!pickOpen || !me.loggedIn || !teacherId) return;
    let alive = true;
    setSubjects(null); setSubjErr(null);
    liveApi.privateSubjects(exam, teacherId, exam === 'bac' ? profile : null)
      .then((r) => { if (alive) { setSubjects(r.subjects || []); if (!r.subjects?.some((s) => s.id === subjectId)) setSubjectId(r.subjects?.[0]?.id || null); } })
      .catch((e) => alive && setSubjErr(e.message));
    return () => { alive = false; };
  }, [pickOpen, me.loggedIn, teacherId, exam, profile]); // eslint-disable-line react-hooks/exhaustive-deps

  async function startPrivate() {
    if (!subjectId) return;
    setBusy('private');
    try {
      const r = await liveApi.privateStart(teacherId, subjectId);
      navigate(`/meditatii/sala/${r.sessionId}`);
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

  const priv = me.private;
  const sessionsOf = (day) => day.sessions.filter((s) => s.teacher === teacherId);

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
            {banner.pay === 'privat' && <button type="button" className="lv-btn-primary" onClick={() => pay('privat')}>Plătește {data?.prices?.privat ?? 20} lei</button>}
            <button type="button" className="lv-btn-soft" onClick={() => { setBanner(null); clearParams(); }}>OK</button>
          </span>
        </div>
      )}

      <section className="lvl-hero">
        <div>
          <h1>Meditații live, ca pe Zoom — cu profesorul virtual</h1>
          <p>În fiecare zi, la ore fixe, profesorul explică un subiect de Evaluare Națională sau de Bacalaureat <b>strict pe baremul oficial</b>: întâi încercați singuri, apoi rezolvarea pas cu pas, apoi încă o dată, pe înțelesul tuturor. Întrebi în chat, răspunzi la grile, vezi cum au răspuns colegii. Sau pornești o ședință 1-la-1, oricând.</p>
          <div className="lvl-hero-chips">
            {liveNow > 0 && <span className="lvl-chip is-live"><span className="lv-dot-live" /> {liveNow} {liveNow === 1 ? 'ședință' : 'ședințe'} live acum</span>}
            <span className="lvl-chip">📅 zilnic {(data?.slots || []).map((s) => s.label.replace(/:00/g, '')).join(' · ') || '15–17 · 17–19 · 19–21'}</span>
            <span className="lvl-chip">📏 doar pe barem</span>
            <span className="lvl-chip">💳 {data?.prices?.grup ?? 10} lei / ședință · inclus în abonament</span>
          </div>
        </div>
        <div className="lvl-hero-mock" aria-hidden="true">
          <div className="lvl-mock-stage">
            <div className="lvl-mock-wb"><b style={{ color: '#1f5faa' }}>Subiectul I, ex. 3</b><br />{'Δ = b² − 4ac = 16'}<br />{'x₁,₂ = (−b ± √Δ) / 2a'}<br />{'⇒ x₁ = 3, x₂ = −1 (2p)'}</div>
            <div className="lvl-mock-dg"><span style={{ color: '#e8b931', fontWeight: 800 }}>ENUNȚ · 5 PUNCTE</span><br />Soluțiile ecuației x² − 2x − 3 = 0 sunt…</div>
            <div className="lvl-mock-pip">{rigs[data?.teachers?.[0]?.id]?.thumb ? <img src={rigs[data.teachers[0].id].thumb} alt="" /> : <span>PR</span>}</div>
          </div>
          <div className="lvl-mock-bar"><i /><i /><i /><i /><i className="r" /></div>
        </div>
      </section>

      {err && <div className="lvl-banner is-err"><span>{err}</span></div>}
      {!data && !err && <div style={{ display: 'flex', justifyContent: 'center', padding: 40 }}><div className="spinner" /></div>}

      {data && (<>
        <h2 className="lvl-section-title">{data.teachers.length > 1 ? '1. Alege profesorul' : '1. Profesorul tău'}</h2>
        <div className={`lvl-teachers${data.teachers.length === 1 ? ' is-single' : ''}`}>
          {data.teachers.map((t) => {
            const today = data.days[0]?.sessions.filter((s) => s.teacher === t.id) || [];
            const live = today.some((s) => s.phase === 'live');
            const rig = rigs[t.id];
            return (
              <button type="button" key={t.id} className={`lvl-teacher${t.id === teacherId ? ' is-on' : ''}`} onClick={() => setTeacherId(t.id)} disabled={data.teachers.length === 1}>
                <span className="lvl-tphoto" style={{ background: teacherColor(t) }}>
                  {rig?.thumb ? <img src={rig.thumb} alt={t.name} /> : initials(t.name)}
                  {live && <span className="lvl-live-dot" title="Predă acum" />}
                </span>
                <span>
                  <span className="lvl-tname">{t.name} <span className="lv-tag-ai">Profesor virtual · AI</span></span>
                  <span className="lvl-tbio" style={{ display: 'block' }}>{t.bio}</span>
                  <span className="lvl-ttoday" style={{ display: 'block' }}>Azi: {today.map((s) => `${s.label.split('–')[0]} ${s.exam === 'en' ? 'EN' : 'BAC'}`).join(' · ') || '—'}</span>
                </span>
              </button>
            );
          })}
        </div>

        <h2 className="lvl-section-title">2. Alege ședința și apasă „Conectează-te"</h2>
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
                      <span className={`lvl-slot-exam${s.exam === 'bac' ? ' is-bac' : ''}`}>{s.examLabel}</span>
                      <div className="lvl-slot-subj">{s.subject?.title || 'Subiectul se anunță în curând'}</div>
                      <div className="lvl-slot-meta">{s.lesson === 'gata' ? '✓ lecția e pregătită pe barem' : s.subject ? 'lecția se pregătește pe barem' : ''}</div>
                    </div>
                    <div className="lvl-slot-cta">
                      {s.access?.ok
                        ? <span className="lvl-price">{s.access.via === 'bilet' ? '✓ Ai bilet' : s.access.via === 'admin' ? '✓ Admin' : '✓ Inclus în abonament'}</span>
                        : s.phase !== 'incheiata' && <span className="lvl-price is-paid">{s.access?.price ?? data.prices.grup} lei</span>}
                      {open && (!me.loggedIn
                        ? <Link className="lv-btn-primary" to="/autentificare">Intră în cont</Link>
                        : s.access?.ok
                          ? <button type="button" className="lv-btn-primary" onClick={() => navigate(`/meditatii/sala/${s.id}`)}>Conectează-te</button>
                          : <button type="button" className="lv-btn-primary" disabled={busy === `pay-${s.id}`} onClick={() => pay('grup', s.id)}>{busy === `pay-${s.id}` ? '…' : `Plătește ${s.access?.price ?? data.prices.grup} lei`}</button>)}
                      {s.phase === 'viitoare' && (me.loggedIn && !s.access?.ok
                        ? <button type="button" className="lv-btn-soft" disabled={busy === `pay-${s.id}`} onClick={() => pay('grup', s.id)}>Rezervă · {s.access?.price ?? data.prices.grup} lei</button>
                        : <a className="lv-btn-soft" href={icsFor(s, teacher)} download={`meditatie-${s.day}-${s.slot}.ics`}>📅 În calendar</a>)}
                    </div>
                  </div>
                );
              })}
            </div>
          ))}
        </div>

        <h2 className="lvl-section-title">Sau: meditație 1-la-1, oricând</h2>
        <div className="lvl-private">
          <div>
            <h3>🎓 Doar tu și {teacher?.name || 'profesorul'} — {data.prices.privatMin} de minute</h3>
            <p>Alegi subiectul (cu barem), iar profesorul îl ia cu tine pas cu pas: se oprește la fiecare întrebare, îți explică altfel dacă nu ai înțeles și îți răspunde cu voce la orice întrebare. Poți pune pauză, poți sări la exercițiul care te interesează.</p>
            {me.loggedIn && priv && (
              priv.via === 'admin' ? <span className="lvl-quota">✓ Cont de administrator — nelimitat</span>
                : priv.included > 0 ? <span className={`lvl-quota${priv.includedLeft ? '' : ' is-paid'}`}>{priv.includedLeft ? `✓ ${priv.includedLeft} din ${priv.included} incluse luna aceasta` : `Ai folosit cele ${priv.included} incluse luna aceasta · ${data.prices.privat} lei ședința`}</span>
                  : <span className="lvl-quota is-paid">{data.prices.privat} lei ședința · sau 8 pe lună incluse în abonament</span>
            )}
            {priv?.unusedTickets > 0 && <span className="lvl-quota" style={{ marginLeft: 8 }}>🎟 {priv.unusedTickets} {priv.unusedTickets === 1 ? 'bilet' : 'bilete'} 1-la-1</span>}
          </div>
          <div>
            {!me.loggedIn
              ? <Link className="lv-btn-primary lv-btn-lg" to="/autentificare">Intră în cont</Link>
              : <button type="button" className="lv-btn-primary lv-btn-lg" onClick={() => setPickOpen(!pickOpen)}>{pickOpen ? 'Închide' : 'Alege subiectul'}</button>}
          </div>
        </div>
        {pickOpen && me.loggedIn && (
          <div className="lvl-picker">
            <div className="lvl-picker-row">
              <button type="button" className={`lvl-pill${exam === 'en' ? ' is-on' : ''}`} onClick={() => setExam('en')}>Evaluarea Națională</button>
              {BAC_PROFILES.map((p) => (
                <button type="button" key={p.id} className={`lvl-pill${exam === 'bac' && profile === p.id ? ' is-on' : ''}`} onClick={() => { setExam('bac'); setProfile(p.id); }}>{p.label}</button>
              ))}
            </div>
            {subjErr && <div className="lvl-banner is-err"><span>{subjErr}</span></div>}
            {!subjects && !subjErr && <div className="lvl-empty">Caut subiectele cu barem…</div>}
            {subjects && subjects.length === 0 && <div className="lvl-empty">Nu am încă subiecte cu barem asociat pentru această alegere. (Profesorul explică doar subiectele cu barem.)</div>}
            {subjects && subjects.length > 0 && (
              <div className="lvl-subjects">
                {subjects.map((s) => (
                  <button type="button" key={s.id} className={`lvl-subject${s.id === subjectId ? ' is-on' : ''}`} onClick={() => setSubjectId(s.id)}>
                    <span>{s.title}</span>
                    {s.ready ? <span className="lvl-ready">✓ gata de pornire</span> : s.scriptReady ? <span className="lvl-ready" style={{ color: '#8a6d1a' }}>~1 min pregătire</span> : <span className="lvl-ready" style={{ color: '#80868b' }}>2–4 min pregătire</span>}
                  </button>
                ))}
              </div>
            )}
            <div className="lv-pre-actions" style={{ marginTop: 12 }}>
              <button type="button" className="lv-btn-primary lv-btn-lg" disabled={!subjectId || busy === 'private'} onClick={startPrivate}>
                {busy === 'private' ? 'Pornesc…' : priv?.ok ? 'Începe acum' : `Începe · ${data.prices.privat} lei`}
              </button>
              <span style={{ fontSize: '.82rem', color: 'var(--text-muted)' }}>Cele {data.prices.privatMin} de minute pornesc abia când intri în sală.</span>
            </div>
          </div>
        )}

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

        <h2 className="lvl-section-title">Cum decurge o ședință</h2>
        <div className="lvl-how">
          <div><b>1. Te conectezi</b>Alegi ora și apeși „Conectează-te" — ca la Zoom sau Meet. Poți intra pe tot ecranul.</div>
          <div><b>2. Încerci singur</b>La fiecare exercițiu profesorul îți dă timp să rezolvi: răspunzi la grilă sau scrii rezultatul, apoi vezi cum au răspuns colegii.</div>
          <div><b>3. Explicația pe barem</b>Profesorul scrie pe tablă pașii oficiali și spune câte puncte valorează fiecare. Apoi încă o dată, altfel: intuitiv sau cu greșelile care costă puncte.</div>
          <div><b>4. Întrebi oricând</b>În chat sau cu microfonul (vocea ta devine text). Profesorul răspunde pe loc, iar la „Întrebări" răspunde cu voce, pentru toată clasa.</div>
        </div>
        <p className="lvl-note">
          Profesorul este <b>virtual (inteligență artificială)</b>: vocea și imaginea sunt generate, lucru semnalat pe ecran în fiecare ședință.
          Explică numai subiecte cu barem oficial asociat. Camera și microfonul tău nu ajung la profesor sau la colegi; în chat se vede doar prenumele și inițiala numelui.
          {' '}<Link to="/meditatii/demo" style={{ color: 'var(--navy)', fontWeight: 700 }}>Vezi o demonstrație a sălii →</Link>
        </p>
      </>)}
    </div>
  );
}
