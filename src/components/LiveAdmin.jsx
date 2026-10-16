// =====================================================================
// src/components/LiveAdmin.jsx — ADMIN: Meditațiile live
//
// Programul unei zile: la aceeași oră, câte o sală pe examen (EN, BAC Mate-Info,
// BAC Științele Naturii, BAC Tehnologic) — ce subiect se predă în fiecare (doar
// subiecte CU BAREM, ale examenului sălii), starea lecției (scriptul + vocea), cine
// e în sală; pregătirea/regenerarea lecțiilor, anularea unei ședințe, o notă.
// Lecțiile recente: durata, costul (text + voce), erorile, scriptul complet.
// 🎁 Meditațiile gratuite: CÂTE UNA PE EXAMEN (EN, BAC Mate-Info, BAC Științele
// Naturii, BAC Tehnologic) — lecția pe care oricine are cont o face 1-la-1 fără plată;
// alese automat până le alegi tu, pe fiecare rând (sau cu „🎁" din „Lecțiile recente").
// Subiectele din liste (și din „Ședințele zilei") sunt în ordinea de pe site: variante
// date → modele → teste de antrenament → simulări.
// ✍️ Lecțiile le scrie doar Claude Opus 5.5 (din 13 oct.; cutia doar arată modelul și
// avertizează dacă lipsește ANTHROPIC_API_KEY).
// 🖼 Desenele din PDF (Scriptul → „Refă desenele") și 🗑 versiunile vechi (după „Regenerează").
// 🔊 „Generează vocea" și în Lecțiile recente (15 oct.): o lecție „gata · vocea browserului"
// (vocea generată a eșuat — motivul e scris cu roșu) își primește vocea fără să fie regenerată.
// Pregătirea (Regenerează, Pregătește, vocea, întrebările pe pași, itemii lipsă)
// continuă singură până la „gata", cât pagina e deschisă — cu progresul vocii.
// 🧩 Itemii lipsă (ex. Subiectul III, 1 b) și c)): se scriu doar ei, ceilalți rămân.
// =====================================================================
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { liveApi } from '../lib/live/api';

const LESSON_LABEL = { nou: 'nepregătită (se scrie când intră primul elev)', script: 'scriptul e gata, urmează vocea', audio: 'vocea se generează…', gata: '✓ gata', gata_fara_voce: '✓ gata · vocea browserului', eroare: '⚠ eroare' };
const PHASE_LABEL = { viitoare: 'urmează', sala_asteptare: 'sala e deschisă', live: '🔴 LIVE', incheiata: 'încheiată', anulata: 'anulată' };

const box = { background: '#fff', borderRadius: 12, padding: '20px 24px', boxShadow: '0 1px 4px rgba(0,0,0,0.08)', marginBottom: 20 };
const btn = { padding: '6px 12px', borderRadius: 8, border: '1px solid #d0d7e2', background: '#f6f8fb', fontSize: '.82rem', cursor: 'pointer', whiteSpace: 'nowrap' };
const btnMain = { ...btn, background: 'var(--navy)', color: '#fff', borderColor: 'var(--navy)' };
const btnFree = { ...btn, background: '#fff6d6', borderColor: '#e8b931', color: '#6b4e00', fontWeight: 700 };
const th = { textAlign: 'left', fontSize: '.74rem', textTransform: 'uppercase', letterSpacing: '.04em', color: '#6b7280', padding: '6px 8px', borderBottom: '2px solid #eef1f5' };
const td = { padding: '10px 8px', borderBottom: '1px solid #eef1f5', verticalAlign: 'top', fontSize: '.88rem' };
const examChip = (exam) => ({ display: 'inline-block', padding: '2px 9px', borderRadius: 999, fontSize: '.72rem', fontWeight: 700, whiteSpace: 'nowrap', background: exam === 'bac' ? '#efe7fb' : '#e3f0fb', color: exam === 'bac' ? '#5b2a99' : '#1f5faa' });

// modelele care scriu lecțiile (api/_lib/liveLesson.js → GEN_MODEL / WRITERS)
// felurile de subiecte, în ordinea listelor (oglinda lui L.SUBJECT_KINDS, api/_lib/live.js)
const KIND_GROUPS = [
  { id: 'varianta', label: 'Variante date', short: 'Variantă' },
  { id: 'model', label: 'Modele', short: 'Model' },
  { id: 'test', label: 'Teste de antrenament', short: 'Test' },
  { id: 'simulare', label: 'Simulări', short: 'Simulare' },
  { id: 'alt', label: 'Alte subiecte', short: 'Subiect' },
  { id: 'fisa', label: 'Fișe pe exerciții', short: 'Fișă' },
];
const kindShort = (k) => KIND_GROUPS.find((x) => x.id === k)?.short || 'Subiect';

const MODEL_LABEL = { 'gpt-5.6-terra': 'GPT-5.6 Terra', 'gpt-5.6-sol': 'GPT-5.6 Sol', 'claude-opus-5-5': 'Claude Opus 5.5' };
const modelLabel = (id) => MODEL_LABEL[id] || id || '—';
// momentul build-ului (vite.config.js → define): ce versiune a site-ului rulează telefonul
// eslint-disable-next-line no-undef
const BUILD_TIME = typeof __BUILD_TIME__ !== 'undefined' ? new Date(__BUILD_TIME__).toLocaleString('ro-RO', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : null;
// „Claude Opus 5.5" sau, cu rezerva folosită, „Claude Opus 5.5 (5 bucăți) + GPT-5.6 Terra (1 bucată)"
function writerText(w) {
  const parts = Object.entries(w?.parts || {});
  if (parts.length < 2) return modelLabel(parts[0]?.[0] || w?.model);
  return parts.map(([m, n]) => `${modelLabel(m)} (${n} ${n === 1 ? 'bucată' : 'bucăți'})`).join(' + ');
}

function addDays(key, n) {
  const d = new Date(`${key}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export default function LiveAdmin() {
  const [day, setDay] = useState(null);
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState('');
  const [script, setScript] = useState(null);

  const load = useCallback(async (d = day) => {
    setErr('');
    try {
      const r = await liveApi.adminOverview(d || undefined);
      setData(r);
      if (!d) setDay(r.day);
    } catch (e) { setErr(e.message); }
  }, [day]);
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const slotLabel = useMemo(() => Object.fromEntries((data?.slots || []).map((s) => [s.id, s.label])), [data]);
  const subjectsFor = (s) => (s.exam === 'bac' ? (data?.subjects?.bac || []).filter((x) => !s.profile || x.profile === s.profile) : (data?.subjects?.en || []));
  // aceeași ordine ca pe site, pe feluri (optgroup-uri): variante date, modele, teste, simulări…
  const kindsOf = (list) => KIND_GROUPS.map((k) => ({ ...k, items: list.filter((x) => (x.kind || 'alt') === k.id) })).filter((g) => g.items.length);
  const teacherName = useMemo(() => Object.fromEntries((data?.teachers || []).map((t) => [t.id, t.name])), [data]);

  async function run(key, fn, okText) {
    setBusy(key); setMsg(''); setErr('');
    try { await fn(); if (okText) setMsg(okText); await load(); }
    catch (e) { setErr(e.message); }
    finally { setBusy(''); }
  }

  // Pregătirea unei lecții, CONTINUATĂ până la „gata": un apel lucrează pe server cel
  // mult ~4 minute (scriptul, apoi vocea), apoi pagina cere încă unul — cât e deschisă.
  // Închisă mai devreme: vocea continuă la primul elev care intră (sau „▶ Continuă").
  const leaving = useRef(false);
  useEffect(() => () => { leaving.current = true; }, []);
  async function prepareLoop(key, args, what) {
    setBusy(key); setMsg(''); setErr('');
    try {
      let req = args;
      let r = await liveApi.adminPrepare(req);
      for (let round = 0; round < 15 && r?.lesson && (r.lesson.busy || !['gata', 'eroare'].includes(r.lesson.status)) && !leaving.current; round++) {
        const l = r.lesson;
        // cererea a rulat (sau a creat deja versiunea nouă): de acum, doar continuarea;
        // lecția ocupată de altă cerere → aceeași cerere (ex. itemii lipsă), puțin mai târziu
        if (!l.busy || args.regenerate) req = { lessonId: l.id };
        setMsg(`${what}: ${l.busy ? 'lecția e ocupată de altă pregătire, aștept' : l.status === 'nou' ? 'se scrie textul lecției' : `vocea, ${l.done || 0}/${l.total || '?'} fraze`}… (lasă pagina deschisă — continuă singur)`);
        load();
        if (l.busy) await new Promise((ok) => setTimeout(ok, 8000));
        r = await liveApi.adminPrepare(req);
      }
      const st = r?.lesson?.status;
      if (st === 'eroare') setErr(`${what}: ${r.lesson.error || 'lecția nu s-a putut pregăti.'}`);
      // vocea a eșuat iar (cheia / cota TTS): lecția rămâne „gata" cu vocea browserului — nu e „gata."
      else if (st === 'gata' && r.lesson.noVoice && args.revoice) setErr(`${what}: vocea generată a eșuat din nou — lecția merge în continuare cu vocea browserului. Motivul e scris cu roșu la lecție (Lecțiile recente).`);
      else setMsg(st === 'gata' ? `${what}: gata.` : `${what}: a înaintat — continuă la primul elev care intră sau cu „▶ Continuă".`);
      await load();
    } catch (e) { setErr(e.message); }
    finally { setBusy(''); }
  }

  const go = (n) => { const d = addDays(day, n); setDay(d); setData(null); load(d); };

  // ─── versiunile vechi (înlocuite prin „Regenerează"): rândul + vocea și desenele din Storage ──
  async function deleteOld(lessonId = null) {
    const n = lessonId ? 1 : (data?.oldVersions?.count || 0);
    if (!n || !window.confirm(lessonId
      ? 'Ștergi această versiune veche a lecției, cu vocea și desenele ei? Sălile folosesc deja versiunea nouă.'
      : `Ștergi ${n === 1 ? 'o versiune veche' : `${n} versiuni vechi`} ale lecțiilor, cu vocea și desenele lor? Sălile folosesc deja versiunile noi.`)) return;
    setBusy(lessonId ? `del-${lessonId}` : 'del-old'); setMsg(''); setErr('');
    try {
      let deleted = 0, files = 0, r;
      do {
        r = await liveApi.adminDeleteOld(lessonId ? { lessonId } : {});
        deleted += r.deleted; files += r.files;
        if (r.left > 0) setMsg(`Se șterg versiunile vechi: ${deleted} până acum…`);
      } while (!lessonId && r.left > 0 && r.deleted > 0 && !leaving.current);
      if (r.errors?.length) setErr(`Nu s-au putut șterge toate: ${r.errors.slice(0, 3).join('; ')}`);
      setMsg(`Am șters ${deleted === 1 ? 'o versiune veche' : `${deleted} versiuni vechi`} (${files} fișiere din Storage).`);
      await load();
    } catch (e) { setErr(e.message); }
    finally { setBusy(''); }
  }

  // ─── meditațiile gratuite: câte una pe examen ──
  const free = data?.free || null;
  const canEditFree = !!free?.setup && !busy;
  // butonul „🎁" din „Lecțiile recente": devine meditația gratuită a examenului ei (o înlocuiește pe cea de acum)
  function toggleFree(subjectId, on) {
    run('free', () => liveApi.adminSetFree({ subjectId, on }), on ? 'Lecția e acum meditația gratuită a examenului ei — apare în lobby cu „Începe gratuit".' : 'Lecția nu mai e gratuită.');
  }
  function setFreeSlot(slot, value) {
    if (!value) return;
    const label = slot.label;
    if (value === 'auto') run('free', () => liveApi.adminSetFree({ type: slot.type, auto: true }), `${label}: meditația gratuită se alege automat.`);
    else if (value === 'none') run('free', () => liveApi.adminSetFree({ type: slot.type, subjectId: null }), `${label}: fără meditație gratuită.`);
    else run('free', () => liveApi.adminSetFree({ type: slot.type, subjectId: value }), `${label}: meditația gratuită a fost schimbată — apare în lobby cu „Începe gratuit".`);
  }

  // ─── cine scrie lecțiile (doar informativ: Claude Opus 5.5) ──
  const writer = data?.writer || null;

  return (
    <div>
      <div style={box}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <div>
            <h2 style={{ fontFamily: 'var(--font-display)', color: 'var(--navy)', fontSize: '1.25rem' }}>🎥 Meditații live — programul</h2>
            <div style={{ color: '#6b7280', fontSize: '.85rem', marginTop: 4 }}>
              Profesor: {(data?.teachers || []).map((t) => t.name).join(', ') || '—'} · Vocea: <b>{data ? (data.tts || 'lipsă') : '…'}</b>
              {data && !data.tts && <span style={{ color: '#b3261e' }}> — fără cheie TTS (OPENAI_API_KEY sau AZURE_SPEECH_KEY), lecțiile folosesc vocea browserului</span>}
            </div>
            {BUILD_TIME && <div style={{ color: '#9aa1ad', fontSize: '.74rem', marginTop: 2 }}>Versiunea site-ului: {BUILD_TIME}</div>}
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <button type="button" style={btn} onClick={() => go(-1)} disabled={!day}>←</button>
            <input type="date" value={day || ''} onChange={(e) => { setDay(e.target.value); setData(null); load(e.target.value); }} style={{ ...btn, background: '#fff' }} />
            <button type="button" style={btn} onClick={() => go(1)} disabled={!day}>→</button>
            <button type="button" style={btn} onClick={() => load()}>↻</button>
            <Link to="/meditatii/demo" style={{ ...btn, textDecoration: 'none', color: 'inherit' }}>Demo sală</Link>
          </div>
        </div>
        {err && <div style={{ marginTop: 12, color: '#b3261e', fontSize: '.88rem' }}>⚠ {err}</div>}
        {msg && <div style={{ marginTop: 12, color: '#137333', fontSize: '.88rem' }}>✓ {msg}</div>}
      </div>

      {writer && (
        <div style={box}>
          <h3 style={{ color: 'var(--navy)' }}>✍️ Lecțiile le scrie {modelLabel(writer.model)}</h3>
          <p style={{ color: '#6b7280', fontSize: '.84rem', margin: '6px 0 0' }}>
            O lecție se scrie o singură dată pe subiect — explicația pe barem, întrebările, explicațiile de rezervă („Explică altfel"),
            desenele din PDF — și se refolosește la toate ședințele și în Pregătirea de examen. Un apel care cade se reîncearcă; itemii
            care tot lipsesc apar în „Lecțiile recente" („🧩 Completează itemii lipsă"). Lecțiile scrise înainte (de GPT-5.6 Terra
            sau Sol) se rescriu cu „Regenerează"; versiunile vechi se șterg cu „🗑 Șterge versiunile vechi".
            {writer.fallback ? <> Rezervă (LIVE_REZERVA_MODEL): {modelLabel(writer.fallback)}.</> : null}
          </p>
          {/^claude-/.test(writer.model || '') && !writer.claudeKey && (
            <div style={{ marginTop: 10, color: '#b3261e', fontSize: '.84rem' }}>⚠ ANTHROPIC_API_KEY lipsește în Vercel — fără ea nu se poate scrie nicio lecție nouă.</div>
          )}
        </div>
      )}

      {free && (
        <div style={{ ...box, background: '#fffdf6', border: '1px solid #f1e2ac' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
            <h3 style={{ color: 'var(--navy)' }}>🎁 Meditațiile gratuite — câte una pe examen ({free.lessons.length} din {free.max})</h3>
            {free.auto && <span style={{ fontSize: '.78rem', color: '#8a6d1a' }}>„aleasă automat" = până o alegi tu; o poți schimba oricând</span>}
          </div>
          <p style={{ color: '#5f6673', fontSize: '.84rem', margin: '6px 0 12px', lineHeight: 1.55 }}>
            Pentru fiecare examen, o lecție pe care oricine are cont o face <b>1-la-1, fără abonament și fără plată</b> (nu consumă nici ședințele incluse, nici biletele).
            Apar la vedere în lobby-ul „Meditații live", cu „▶ Începe gratuit" (prima e cea a sălii alese de elev); ședința de grup din ziua în care o sală predă una dintre ele
            e și ea gratuită. Plasă anti-abuz: cel mult <b>{free.monthly}</b> ședințe gratuite pe lună de elev, iar în ele profesorul
            răspunde la <b>{free.answers}</b> întrebări în chat (LIVE_GRATUIT_LUNA, LIVE_GRATUIT_INTREBARI).
          </p>
          {!free.setup && (
            <div style={{ background: '#fff3e0', color: '#8a4b00', borderRadius: 8, padding: '8px 12px', fontSize: '.84rem', marginBottom: 12 }}>
              ⚠ Ca să le poți schimba, rulează o dată <code>supabase/setari_ordine_gratuite.sql</code> în Supabase → SQL Editor.
              Până atunci sunt gratuite cele alese automat.
            </div>
          )}
          <div style={{ display: 'grid', gap: 8 }}>
            {(free.slots || []).map((sl) => {
              const l = sl.lesson;
              const ready = sl.options.filter((o) => o.ready && o.subjectId !== l?.subjectId);
              const later = sl.options.filter((o) => !o.ready && o.subjectId !== l?.subjectId);
              return (
                <div key={sl.type} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', border: '1px solid #eee2b8', borderRadius: 10, background: '#fff', flexWrap: 'wrap' }}>
                  <span style={{ ...examChip(sl.exam), minWidth: 128, textAlign: 'center' }}>{sl.label}</span>
                  <div style={{ flex: 1, minWidth: 220 }}>
                    {l
                      ? <b style={{ color: 'var(--navy)' }}>{l.kind ? <span style={{ color: '#8a6d1a', fontWeight: 700 }}>{kindShort(l.kind)} · </span> : null}{l.title}</b>
                      : <span style={{ color: '#6b7280' }}>{sl.none ? '— fără meditație gratuită —' : 'niciun subiect cu barem încă'}</span>}
                    <div style={{ fontSize: '.76rem', color: l?.missing || l?.noBarem ? '#b3261e' : l?.ready ? '#137333' : '#8a5a00' }}>
                      {l ? (l.missing ? '⚠ subiectul nu mai există — alege altul'
                        : l.noBarem ? '⚠ subiectul nu mai are barem găsit — alege altul'
                          : l.ready ? '✓ lecția e gata' : 'lecția se scrie la prima folosire (1–3 min, o singură dată)') : ''}
                      {l && sl.auto ? <span style={{ color: '#8a6d1a' }}> · aleasă automat</span> : null}
                    </div>
                  </div>
                  {l && !l.ready && !l.missing && !l.noBarem && (
                    <button type="button" style={btnMain} disabled={!!busy} title="Scrie lecția acum (textul + vocea), ca primul elev să nu aștepte"
                      onClick={() => prepareLoop(`fprep-${sl.type}`, { subjectId: l.subjectId, teacher: data?.teachers?.[0]?.id || 'radu' }, 'Pregătirea lecției')}>
                      {busy === `fprep-${sl.type}` ? 'Se pregătește…' : 'Pregătește acum'}
                    </button>
                  )}
                  <select value="" onChange={(e) => setFreeSlot(sl, e.target.value)} disabled={!canEditFree} aria-label={`Meditația gratuită: ${sl.label}`}
                    style={{ flex: '0 1 300px', minWidth: 200, padding: 7, borderRadius: 8, border: '1px solid #d0d7e2', fontSize: '.84rem' }}>
                    <option value="">{l ? '↻ Schimbă…' : '＋ Alege…'}</option>
                    {ready.length > 0 && (
                      <optgroup label="✓ Lecții gata — pornesc imediat">
                        {ready.map((o) => <option key={o.subjectId} value={o.subjectId}>{kindShort(o.kind)} · {o.title}</option>)}
                      </optgroup>
                    )}
                    {later.length > 0 && (
                      <optgroup label="Se scriu la prima folosire (1–3 min, o dată)">
                        {later.map((o) => <option key={o.subjectId} value={o.subjectId}>{kindShort(o.kind)} · {o.title}</option>)}
                      </optgroup>
                    )}
                    <optgroup label="Altfel">
                      {!sl.auto && <option value="auto">🤖 Alege automat (cea mai potrivită lecție gata)</option>}
                      {l && <option value="none">✕ Fără meditație gratuită la acest examen</option>}
                    </optgroup>
                  </select>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div style={box}>
        <h3 style={{ color: 'var(--navy)', marginBottom: 10 }}>Ședințele zilei</h3>
        {data?.rooms?.length > 0 && (
          <div style={{ color: '#6b7280', fontSize: '.84rem', marginBottom: 10 }}>
            Subiecte cu barem, pe săli:{' '}
            {data.rooms.map((r, i) => (
              <span key={r.id} style={{ color: r.subjects ? '#374151' : '#b3261e', fontWeight: r.subjects ? 400 : 700 }}>
                {i ? ' · ' : ''}{r.label} {r.subjects}{r.subjects ? '' : ' ⚠'}
              </span>
            ))}
            {data.rooms.some((r) => !r.subjects) && <span> — sala fără subiecte așteaptă; cronul citește baremele întâi pentru ea (sau încarcă subiecte cu barem pentru acel profil).</span>}
          </div>
        )}
        {!data && !err && <div className="spinner" />}
        {data && (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr><th style={th}>Ora</th><th style={th}>Examen</th><th style={th}>Subiectul (cu barem)</th><th style={th}>Lecția</th><th style={th}>Sala</th><th style={th}>Acțiuni</th></tr></thead>
              <tbody>
                {data.sessions.map((s) => {
                  const list = subjectsFor(s);
                  const inList = s.subject && list.some((x) => x.id === s.subject.id);
                  return (
                    <tr key={s.id} style={{ opacity: s.status === 'anulata' ? 0.55 : 1 }}>
                      <td style={td}><b>{s.label || slotLabel[s.slot] || s.slot}</b><div style={{ color: '#6b7280', fontSize: '.78rem' }}>{s.room ? `Sala ${s.room.n} · ` : ''}{teacherName[s.teacher] || s.teacher}</div></td>
                      <td style={td}>{s.examLabel}</td>
                      <td style={{ ...td, minWidth: 260 }}>
                        <select value={s.subject?.id || ''} disabled={busy === `subj-${s.id}`} style={{ width: '100%', padding: 6, borderRadius: 8, border: '1px solid #d0d7e2' }}
                          onChange={(e) => run(`subj-${s.id}`, () => liveApi.adminSetSubject(s.id, { subjectId: e.target.value || null }), 'Subiectul a fost schimbat.')}>
                          <option value="">— alege automat —</option>
                          {s.subject && !inList && <option value={s.subject.id}>{s.subject.title}</option>}
                          {kindsOf(list).map((g) => (
                            <optgroup key={g.id} label={g.label}>
                              {g.items.map((x) => <option key={x.id} value={x.id}>{x.title}</option>)}
                            </optgroup>
                          ))}
                        </select>
                        <input type="text" defaultValue={s.note || ''} placeholder="Notă (opțional, doar pentru admin)" style={{ width: '100%', marginTop: 6, padding: 6, borderRadius: 8, border: '1px solid #e3e8ef', fontSize: '.8rem' }}
                          onBlur={(e) => { if ((e.target.value || '') !== (s.note || '')) run(`note-${s.id}`, () => liveApi.adminSetSubject(s.id, { note: e.target.value })); }} />
                      </td>
                      <td style={td}>{s.subject ? (LESSON_LABEL[s.lesson] || s.lesson) : '—'}</td>
                      <td style={td}>{PHASE_LABEL[s.phase] || s.phase}<div style={{ color: '#6b7280', fontSize: '.78rem' }}>{s.present} acum · {s.participants} în total</div></td>
                      <td style={{ ...td, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        {s.subject && s.lesson === 'gata_fara_voce' && data.tts && (
                          <button type="button" style={btnMain} disabled={!!busy} onClick={() => prepareLoop(`voce-${s.id}`, { subjectId: s.subject.id, teacher: s.teacher, revoice: true }, 'Vocea')}>
                            {busy === `voce-${s.id}` ? 'Se generează…' : 'Generează vocea'}
                          </button>
                        )}
                        {s.subject && s.lesson !== 'gata' && s.lesson !== 'gata_fara_voce' && (
                          <button type="button" style={btnMain} disabled={!!busy} onClick={() => prepareLoop(`prep-${s.id}`, { subjectId: s.subject.id, teacher: s.teacher }, 'Pregătirea lecției')}>
                            {busy === `prep-${s.id}` ? 'Se pregătește…' : 'Pregătește lecția'}
                          </button>
                        )}
                        <Link to={`/meditatii/sala/${s.id}`} style={{ ...btn, textDecoration: 'none', color: 'inherit' }}>Intră</Link>
                        {s.status === 'anulata'
                          ? <button type="button" style={btn} disabled={!!busy} onClick={() => run(`c-${s.id}`, () => liveApi.adminSetSubject(s.id, { cancel: false }), 'Ședința a fost reactivată.')}>Reactivează</button>
                          : s.phase !== 'incheiata' && <button type="button" style={btn} disabled={!!busy} onClick={() => { if (window.confirm('Anulezi această ședință? Elevii o vor vedea „Anulată".')) run(`c-${s.id}`, () => liveApi.adminSetSubject(s.id, { cancel: true }), 'Ședința a fost anulată.'); }}>Anulează</button>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <p style={{ color: '#6b7280', fontSize: '.8rem', marginTop: 10 }}>
              Programul și subiectele se completează singure (cron, la 15 minute): în fiecare zi, câte o ședință în fiecare sală, la aceeași oră
              (LIVE_INTERVALE, implicit 17-19; LIVE_SALI). O lecție NOUĂ se scrie abia când intră primul elev în sala de
              așteptare sau cumpără bilet (fără elevi, fără cost; LIVE_PREGATIRE_AUTO=1 le pregătește pe toate din timp). La ora de început, cu cel
              puțin 2 elevi pornește ședința comună; cu unul singur, ședința devine 1-la-1. Sunt propuse doar subiectele care au barem găsit.
            </p>
          </div>
        )}
      </div>

      {data?.lessons?.length > 0 && (
        <div style={box}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12, flexWrap: 'wrap', marginBottom: 10 }}>
            <h3 style={{ color: 'var(--navy)' }}>Lecțiile recente</h3>
            {data.oldVersions && (
              <button type="button" style={btn} disabled={!!busy || !data.oldVersions.count}
                title={'Versiunile înlocuite prin „Regenerează" nu mai sunt folosite nicăieri (sălile, Pregătirea de examen și simulările iau versiunea nouă): se șterg, cu vocea și desenele lor din Storage. Cât versiunea nouă nu e gata, cea veche rămâne.'}
                onClick={() => deleteOld()}>
                {busy === 'del-old' ? '…' : `🗑 Șterge versiunile vechi (${data.oldVersions.count})`}
              </button>
            )}
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr><th style={th}>Lecția</th><th style={th}>Starea</th><th style={th}>Durata</th><th style={th}>Cost</th><th style={th}>Actualizată</th><th style={th} /></tr></thead>
              <tbody>
                {data.lessons.map((l) => (
                  <tr key={l.id}>
                    <td style={td}>
                      <b>{l.title || '(fără titlu încă)'}</b>
                      {l.free && <span style={{ marginLeft: 6, fontSize: '.72rem', fontWeight: 700, color: '#6b4e00', background: '#fff6d6', border: '1px solid #e8b931', borderRadius: 999, padding: '1px 8px', whiteSpace: 'nowrap' }}>🎁 gratuită</span>}
                      <div style={{ color: '#6b7280', fontSize: '.78rem' }}>{teacherName[l.teacher] || l.teacher} · v{l.version}{l.writer?.model ? ` · scrisă de ${writerText(l.writer)}` : ''}</div>{l.error && <div style={{ color: '#b3261e', fontSize: '.78rem' }}>{l.error}</div>}
                      {l.superseded && <div style={{ color: '#8a5a00', fontSize: '.76rem' }}>versiune veche — înlocuită de v{l.superseded.by}{l.superseded.deletable ? '' : ', care încă nu e gata (până atunci rămâne aceasta)'}</div>}
                    </td>
                    <td style={td}>
                      {l.status === 'gata' && l.noVoice ? LESSON_LABEL.gata_fara_voce : (LESSON_LABEL[l.status] || l.status)}
                      {l.status === 'gata' && Number(l.sv || 1) < 2 && <div style={{ color: '#b3261e', fontSize: '.76rem' }}>scrisă fără paginile PDF — formulele (radicali, fracții…) pot lipsi; apasă „Regenerează"</div>}
                      {l.status === 'gata' && !Number(l.pasi) && <div style={{ color: '#8a5a00', fontSize: '.76rem' }}>fără întrebări pe pași (S. II–III) — se completează singure la prima folosire, sau apasă „➕ Întrebări pe pași"</div>}
                      {Number(l.pasi) > 0 && l.pasiInfo && <div style={{ color: '#6b7280', fontSize: '.76rem' }}>întrebări pe pași: {l.pasiInfo.ai || 0} scrise de AI, {l.pasiInfo.fromBarem || 0} din barem{l.pasiInfo.missing?.length ? ` · fără: ${l.pasiInfo.missing.join(', ')}` : ''}</div>}
                      {(l.status === 'script' || l.status === 'audio') && Number(l.total) > 0 && <div style={{ color: '#6b7280', fontSize: '.76rem' }}>vocea: {Number(l.done) || 0}/{l.total} fraze — continuă la primul elev care intră, sau apasă „▶ Continuă"</div>}
                      {l.missing?.length > 0 && <div style={{ color: '#b3261e', fontSize: '.76rem' }}>lipsesc itemii: {l.missing.join(', ')} — apasă „🧩 Completează itemii lipsă"</div>}
                      {l.itemi?.added?.length > 0 && <div style={{ color: '#6b7280', fontSize: '.76rem' }}>itemi completați: {l.itemi.added.join(', ')}</div>}
                      {l.itemi?.error && <div style={{ color: '#b3261e', fontSize: '.76rem' }}>completarea itemilor a eșuat: {l.itemi.error}</div>}
                    </td>
                    <td style={td}>{l.duration_sec ? `${Math.round(l.duration_sec / 60)} min` : '—'}</td>
                    <td style={td}>{l.cost_lei ? `${l.cost_lei} lei` : '—'}</td>
                    <td style={td}>{new Date(l.updated_at).toLocaleString('ro-RO')}</td>
                    <td style={{ ...td, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      {(l.status === 'gata' || l.free) && free && (
                        <button type="button" style={l.free ? btnFree : btn} disabled={!canEditFree}
                          title={l.free ? 'Meditația gratuită a examenului ei (1-la-1 fără plată) — apasă ca să nu mai fie gratuită' : 'Fă din această lecție meditația gratuită a examenului ei (1-la-1 fără plată, la vedere în lobby) — o înlocuiește pe cea de acum'}
                          onClick={() => toggleFree(l.subject_id, !l.free)}>
                          {l.free ? '🎁 Gratuită ✓' : '🎁 Fă-o gratuită'}
                        </button>
                      )}
                      <button type="button" style={btn} onClick={async () => { try { setScript((await liveApi.adminLesson(l.id)).lesson); } catch (e) { setErr(e.message); } }}>Scriptul</button>
                      {l.superseded?.deletable && (
                        <button type="button" style={btn} disabled={!!busy} title="Șterge această versiune veche, cu vocea și desenele ei din Storage" onClick={() => deleteOld(l.id)}>
                          {busy === `del-${l.id}` ? '…' : '🗑 Șterge'}
                        </button>
                      )}
                      {!l.superseded && (<>
                      <button type="button" style={btn} disabled={!!busy} onClick={() => { if (window.confirm('Regenerezi lecția (script + voce nouă)? Costă din nou.')) prepareLoop(`re-${l.id}`, { subjectId: l.subject_id, teacher: l.teacher, regenerate: true }, 'Regenerarea'); }}>
                        {busy === `re-${l.id}` ? '…' : 'Regenerează'}
                      </button>
                      {l.status === 'gata' && (
                        <button type="button" style={btn} disabled={!!busy}
                          title="Întrebările pe pașii din barem (Subiectele II și III): elevii răspund pe ecran înaintea fiecărui rezultat intermediar. Doar întrebările se scriu (≈ 0,5–1 leu); explicațiile și vocea rămân."
                          onClick={() => { const again = Number(l.pasi) > 0; if (!again || window.confirm('Scrii din nou întrebările pe pași (le înlocuiește pe cele de acum)?')) prepareLoop(`ps-${l.id}`, { lessonId: l.id, steps: true, force: again }, 'Întrebările pe pași'); }}>
                          {busy === `ps-${l.id}` ? '…' : Number(l.pasi) > 0 ? '↻ Întrebări pe pași' : '➕ Întrebări pe pași'}
                        </button>
                      )}
                      {l.status === 'gata' && l.noVoice && data.tts && (
                        <button type="button" style={btnMain} disabled={!!busy}
                          title={'Lecția merge acum cu vocea browserului (vocea generată a eșuat sau lipsea cheia TTS): pe iPhone și Android, fiecare frază așteaptă vocea de pe server — dacă nici ea nu vine, vorbește vocea telefonului (sau, pe unele telefoane, nu se aude nimic). Generează vocea lecției o dată, pentru toți elevii.'}
                          onClick={() => prepareLoop(`voce-${l.id}`, { lessonId: l.id, revoice: true }, 'Vocea')}>
                          {busy === `voce-${l.id}` ? 'Se generează…' : '🔊 Generează vocea'}
                        </button>
                      )}
                      {(l.status === 'script' || l.status === 'audio') && (
                        <button type="button" style={btnMain} disabled={!!busy} title={'Continuă vocea lecției până la „gata" (cât pagina e deschisă)'}
                          onClick={() => prepareLoop(`cont-${l.id}`, { lessonId: l.id }, 'Vocea')}>
                          {busy === `cont-${l.id}` ? '…' : '▶ Continuă'}
                        </button>
                      )}
                      {l.missing?.length > 0 && ['gata', 'script', 'audio'].includes(l.status) && (
                        <button type="button" style={btnMain} disabled={!!busy} title="Scrie doar itemii care lipsesc (cu modelul ales mai sus); explicațiile și vocea celorlalți rămân"
                          onClick={() => prepareLoop(`fill-${l.id}`, { lessonId: l.id, fill: true }, 'Itemii lipsă')}>
                          {busy === `fill-${l.id}` ? '…' : '🧩 Completează itemii lipsă'}
                        </button>
                      )}
                      </>)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {script && (
        <div role="dialog" aria-modal="true" onClick={() => setScript(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(10,20,40,.55)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: '#fff', borderRadius: 14, width: 'min(920px, 100%)', maxHeight: '88vh', overflow: 'auto', padding: 24 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, marginBottom: 12 }}>
              <h3 style={{ color: 'var(--navy)' }}>{script.title} · {script.duration ? `${Math.round(script.duration / 60)} min` : ''} · {script.cost_lei ? `${script.cost_lei} lei` : ''}</h3>
              <button type="button" style={btn} onClick={() => setScript(null)}>Închide</button>
            </div>
            {!script.script && <p>Scriptul nu e gata încă.</p>}
            {script.script && (
              <div style={{ fontSize: '.84rem', color: '#374151', marginBottom: 8 }}>
                {(script.script.items || []).length} itemi{script.script.writer?.model ? ` · scrisă de ${writerText(script.script.writer)}` : ''}
                {script.missing?.length > 0 ? (
                  <div style={{ marginTop: 6, color: '#b3261e' }}>
                    {script.missingChecked ? 'Lipsesc itemii' : 'Par să lipsească (față de structura oficială)'}: <b>{script.missing.join(', ')}</b>{' '}
                    <button type="button" style={btnMain} disabled={!!busy}
                      onClick={() => { const id = script.id; setScript(null); prepareLoop(`fill-${id}`, { lessonId: id, fill: true }, 'Itemii lipsă'); }}>
                      🧩 Completează itemii lipsă
                    </button>
                    {!script.missingChecked && <div style={{ color: '#6b7280', fontSize: '.78rem', marginTop: 4 }}>Butonul verifică întâi pe textul subiectului; dacă subiectul chiar nu are acei itemi, nu scrie nimic.</div>}
                  </div>
                ) : <span style={{ color: '#188038' }}> · toți itemii subiectului sunt în lecție</span>}
                {script.script.writer?.notes?.length > 0 && (
                  <details style={{ marginTop: 6 }}>
                    <summary>Jurnalul scrierii ({script.script.writer.notes.length})</summary>
                    <ul style={{ paddingLeft: 18, color: '#6b7280' }}>{script.script.writer.notes.map((n, i) => <li key={i}>{n}</li>)}</ul>
                  </details>
                )}
                {/* desenele din PDF (problemele „În figura alăturată…"), decupate o singură dată pe lecție */}
                <div style={{ marginTop: 6 }}>
                  🖼 Desenele din PDF:{' '}
                  {script.script.figErr ? <span style={{ color: '#b3261e' }}>nu s-au putut lua — {script.script.figErr}</span>
                    : script.script.figInfo ? (script.script.figInfo.found.length || script.script.figInfo.missing.length
                      ? <>{script.script.figInfo.found.length > 0 && <span style={{ color: '#188038' }}>{script.script.figInfo.found.join(', ')}</span>}
                        {script.script.figInfo.missing.length > 0 && <span style={{ color: '#8a5a00' }}>{script.script.figInfo.found.length ? ' · ' : ''}negăsite: {script.script.figInfo.missing.join(', ')}</span>}</>
                      : <span style={{ color: '#6b7280' }}>subiectul nu are probleme cu figură</span>)
                    : script.script.figv ? <span style={{ color: '#6b7280' }}>subiectul nu are probleme cu figură</span>
                    : <span style={{ color: '#6b7280' }}>încă nu — se adaugă singure la prima folosire</span>}{' '}
                  {['gata', 'script', 'audio'].includes(script.status) && (
                    <button type="button" style={btn} disabled={!!busy} title="Decupează din nou desenele din PDF-ul subiectului (gratuit, câteva secunde); explicațiile și vocea rămân"
                      onClick={() => { const id = script.id; setScript(null); prepareLoop(`fig-${id}`, { lessonId: id, figures: true }, 'Desenele din PDF'); }}>
                      {busy === `fig-${script.id}` ? '…' : '🖼 Refă desenele'}
                    </button>
                  )}
                </div>
              </div>
            )}
            {script.script && (script.script.items || []).map((it) => (
              <div key={it.ref} style={{ borderTop: '1px solid #eef1f5', padding: '10px 0' }}>
                <b>{it.title}</b> {it.points ? `· ${it.points}p` : ''} {it.tryPoll ? `· sondaj (${it.tryPoll.type}, răspuns: ${it.tryPoll.answer})` : ''}
                {it.steps?.length ? ` · ${it.steps.length} ${it.steps.length === 1 ? 'întrebare pe pas' : 'întrebări pe pași'}` : ''}
                <div style={{ color: '#374151', fontSize: '.86rem', margin: '4px 0' }}>{it.statement}</div>
                {it.figure?.url && <img src={it.figure.url} alt={`Desenul ${it.ref}`} style={{ display: 'block', maxHeight: 140, maxWidth: '60%', margin: '4px 0', border: '1px solid #eef1f5', borderRadius: 6 }} />}
                {it.steps?.length > 0 && (
                  <details style={{ fontSize: '.84rem', margin: '4px 0' }}>
                    <summary>întrebări pe pași · {it.steps.length}</summary>
                    <ol style={{ paddingLeft: 20 }}>{it.steps.map((st) => (
                      <li key={st.id || st.question}>
                        {st.part ? <b>{st.part}) </b> : null}înainte de fraza {st.at + 1}: {st.question}
                        <span style={{ color: '#188038' }}> → {st.type === 'grila' ? `${st.answer}) ${(st.options || [])['abcd'.indexOf(st.answer)] || ''}` : st.answer}</span>
                        {st.src === 'barem' ? <span style={{ color: '#6b7280' }}> (din barem)</span> : null}
                      </li>
                    ))}</ol>
                  </details>
                )}
                {Object.entries(it.modes || {}).map(([m, segs]) => (
                  <details key={m} style={{ fontSize: '.84rem', margin: '4px 0' }}>
                    <summary>{m} · {segs.length} fraze</summary>
                    <ol style={{ paddingLeft: 20 }}>{segs.map((g) => <li key={g.id}>{g.say}{g.board?.length ? <span style={{ color: '#1f5faa' }}> [tablă: {g.board.join(' | ')}]</span> : null}</li>)}</ol>
                  </details>
                ))}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
