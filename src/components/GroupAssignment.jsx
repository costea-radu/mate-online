// =====================================================================
// src/components/GroupAssignment.jsx — „Test pe grupă: teste diferite"
//
// Profesorul construiește un test pe grupă din butoane pliabile (rolldown):
//   0) grupa de elevi
//   1) categoria testului (clasa sau examenul)
//   2) formatul (interactiv sau PDF)
//   3) numărul de teste + locul de unde vin (generate de el, din Biblioteca
//      utilizatorilor sau din site — „Examene" și „Clase")
//   4) alegerea testelor: automat, prin bifare, sau mixt (propunerea automată
//      se poate debifa / completa) — lista arată TOATE testele, fără plafon
//   5) timpul de lucru: de la 10 minute la 3 ore (ore + minute), sau fără
//      limită. Cronometrul pornește când elevul apasă „Începe testul" și, la
//      zero, testul se închide singur.
// Rezultatul e UN SINGUR LINK: fiecare elev care îl deschide primește ALT
// test din bazin, iar la testele următoare primește, pe cât posibil, un test
// pe care nu l-a mai primit.
//
// Lângă linkul creat: câmpul de DENUMIRE și butonul „💬 Trimite pe mesageria
// grupei". Mai jos: „📨 Testele pe grupă trimise" (rolldown) și, lângă el,
// „🏆 Clasament — doar testele primite" (clasamentul general, cu tot ce a
// rezolvat elevul, rămâne în „Grupe / Rezultate elevi").
//
// TEMELE cu exerciții bifate sunt altceva: butonul „📝 Dă temă" de lângă grupă
// și de lângă fiecare elev (src/components/TemaPicker.jsx).
//
// Doar pentru ADMIN: comutatorul „testele premium se trimit gratuit".
// Montat în „Contul meu" (src/pages/Profile.jsx) și în „Asistent AI"
// (src/pages/ProfesorVirtual.jsx, după „Testele și exercițiile mele").
// =====================================================================
import { useCallback, useEffect, useMemo, useState } from 'react';
import { aiClient } from '../lib/aiClient';
import { useAuth } from '../context/AuthContext';
import { CATEGORIES } from '../lib/contentMeta';
import { fmtDurata } from '../lib/testMode';

const SOURCES = [
  { id: 'personal', label: '🧩 Testele generate de mine', hint: 'din „Testele și exercițiile mele"' },
  { id: 'public', label: '🏛️ Biblioteca utilizatorilor', hint: 'teste publicate de profesori' },
  { id: 'site', label: '📚 Testele din site', hint: '„Examene" și „Clase"' },
];
const FORMATS = [
  { id: 'interactive', label: '🧩 Interactiv', hint: 'se rezolvă în site, scorul se salvează automat' },
  { id: 'pdf', label: '📄 PDF', hint: 'se deschide în vizualizator, cu Prof. Virtual alături' },
];
const EXAM_CATS = ['evaluare-nationala', 'bacalaureat'];

// Timpul de lucru: de la 10 minute la 3 ore. Butoanele rapide acoperă duratele
// obișnuite; oricare altă combinație se face din selectoarele de ore și minute.
const TIMP_MIN = 10;
const TIMP_MAX = 180;
const TIMPI = [10, 20, 30, 40, 50, 60, 90, 120, 150, 180];

// câte teste se desenează deodată în lista de bifat (restul, la cerere)
const PAS_LISTA = 200;
// câte teste încap într-un bazin (aceeași limită ca pe server, MAX_POOL)
const MAX_BAZIN = 60;

// ─── Pas pliabil (rolldown) ─────────────────────────────────────────────────
function Step({ n, title, summary, open, onToggle, children, done }) {
  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 12, marginBottom: 10, background: '#fff', overflow: 'hidden' }}>
      <button type="button" onClick={onToggle} aria-expanded={open}
        style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', background: 'none', border: 'none', padding: '11px 13px', cursor: 'pointer', textAlign: 'left' }}>
        <span aria-hidden="true" style={{ fontSize: '.75rem', color: 'var(--gold)', transform: open ? 'rotate(90deg)' : 'none', transition: 'transform .15s' }}>▶</span>
        <span style={{
          width: 22, height: 22, borderRadius: '50%', flexShrink: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          fontSize: '.72rem', fontWeight: 800,
          background: done ? '#27ae60' : 'var(--cream)', color: done ? '#fff' : 'var(--navy)',
          border: done ? 'none' : '1px solid var(--border)',
        }}>{done ? '✓' : n}</span>
        <span style={{ fontWeight: 700, color: 'var(--navy)', fontSize: '.9rem' }}>{title}</span>
        {!open && summary && <span style={{ fontSize: '.78rem', color: 'var(--text-muted)', marginLeft: 'auto', textAlign: 'right' }}>{summary}</span>}
      </button>
      <div style={{ display: open ? 'block' : 'none', padding: '2px 13px 14px 45px' }}>{children}</div>
    </div>
  );
}

const chip = (active) => ({
  padding: '7px 12px', borderRadius: 999, cursor: 'pointer', fontSize: '.82rem', fontWeight: 600,
  border: `1.5px solid ${active ? 'var(--navy)' : 'var(--border)'}`,
  background: active ? 'var(--navy)' : '#fff', color: active ? '#fff' : 'var(--navy)',
});
const selStyle = { border: '1px solid var(--border)', borderRadius: 8, padding: '8px 10px', fontSize: '.85rem', color: 'var(--text)', background: '#fff', maxWidth: '100%' };

export default function GroupAssignment({ compact = false }) {
  const { isAdmin } = useAuth();

  const [step, setStep] = useState(0);            // pasul deschis
  const [groups, setGroups] = useState(null);     // { groups, ungrouped, total }
  const [groupId, setGroupId] = useState('');     // '' = toți elevii mei
  const [category, setCategory] = useState('');
  const [format, setFormat] = useState('interactive');
  const [sources, setSources] = useState(['site']);
  const [poolSize, setPoolSize] = useState(10);
  const [mode, setMode] = useState('auto');       // auto | manual (mixt = manual pornit din propunere)
  const [premiumFree, setPremiumFree] = useState(false);
  const [title, setTitle] = useState('');
  const [timeLimit, setTimeLimit] = useState(0);  // minute; 0 = fără limită de timp

  const [catalog, setCatalog] = useState([]);     // testele bifabile
  const [catLoading, setCatLoading] = useState(false);
  const [q, setQ] = useState('');
  const [checked, setChecked] = useState([]);     // [{source, refId, title, isFree}]
  // Lista de bifat NU mai are plafon: se încarcă toate testele. Ca pagina să
  // rămână sprintenă când sunt mii, se desenează în tranșe, cu „arată încă".
  const [vizibile, setVizibile] = useState(PAS_LISTA);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [created, setCreated] = useState(null);   // { url, title, poolSize }
  const [copied, setCopied] = useState(false);
  const [sent, setSent] = useState(null);         // testele pe grupă trimise
  const [openReport, setOpenReport] = useState(null);
  const [linkName, setLinkName] = useState('');   // denumirea linkului creat
  const [renaming, setRenaming] = useState(false);
  const [chatBusy, setChatBusy] = useState(false);
  const [chatSent, setChatSent] = useState(false);
  const [showSent, setShowSent] = useState(false);       // rolldown „Testele trimise"
  const [showRank, setShowRank] = useState(false);       // rolldown „Clasament teste primite"
  const [rank, setRank] = useState(null);

  // ── date ──────────────────────────────────────────────────────────────────
  useEffect(() => { aiClient.groupAssignmentGroups().then(setGroups).catch((e) => setError(e.message)); }, []);
  const loadSent = useCallback(() => {
    aiClient.groupAssignmentsMine().then((r) => setSent(r.assignments || [])).catch(() => setSent([]));
  }, []);
  useEffect(() => { loadSent(); }, [loadSent]);

  // clasamentul DOAR cu testele pe grupă primite (cel general e în „Grupe / Rezultate elevi")
  const loadRank = useCallback(() => {
    aiClient.groupAssignmentLeaderboard().then(setRank).catch(() => setRank({ rows: [], tests: 0 }));
  }, []);
  useEffect(() => { loadRank(); }, [loadRank]);

  // catalogul se reîncarcă la schimbarea sursei/categoriei/formatului
  const loadCatalog = useCallback(async () => {
    setCatLoading(true);
    try {
      const lists = await Promise.all(sources.map((s) =>
        aiClient.groupAssignmentCatalog({ source: s, category: category || null, format })
          .then((r) => r.items || []).catch(() => [])));
      setCatalog(lists.flat());
    } finally { setCatLoading(false); }
  }, [sources, category, format]);
  useEffect(() => { if (step === 4) loadCatalog(); }, [step, loadCatalog]);

  // bifele care nu mai există în catalogul curent se curăță singure
  useEffect(() => {
    if (!catalog.length) return;
    const ok = new Set(catalog.map((i) => `${i.source}:${i.refId}`));
    setChecked((c) => c.filter((x) => ok.has(`${x.source}:${x.refId}`)));
  }, [catalog]);

  const groupName = groupId ? (groups?.groups || []).find((g) => g.id === groupId)?.name : null;
  const nStudents = groupId
    ? ((groups?.groups || []).find((g) => g.id === groupId)?.students ?? 0)
    : (groups?.total ?? 0);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return needle ? catalog.filter((i) => (i.title || '').toLowerCase().includes(needle)) : catalog;
  }, [catalog, q]);

  useEffect(() => { setVizibile(PAS_LISTA); }, [q, catalog]);

  const isChecked = (i) => checked.some((c) => c.source === i.source && c.refId === i.refId);
  function toggleItem(i) {
    setChecked((c) => (isChecked(i)
      ? c.filter((x) => !(x.source === i.source && x.refId === i.refId))
      : [...c, { source: i.source, refId: i.refId, title: i.title, isFree: i.isFree }]));
  }
  function toggleSource(id) {
    setSources((s) => (s.includes(id) ? (s.length > 1 ? s.filter((x) => x !== id) : s) : [...s, id]));
  }
  // „mixt": pornim de la propunerea automată, apoi profesorul debifează/adaugă
  function proposeAuto() {
    const pick = filtered.slice(0, Math.max(1, Math.min(poolSize, filtered.length)));
    setChecked(pick.map((i) => ({ source: i.source, refId: i.refId, title: i.title, isFree: i.isFree })));
    setMode('manual');
  }

  async function submit() {
    setBusy(true); setError(null);
    try {
      const r = await aiClient.groupAssignmentCreate({
        groupId: groupId || null, category: category || null, format,
        pickMode: mode, sources, poolSize: Number(poolSize) || 10,
        items: mode === 'manual' ? checked.map((c) => ({ source: c.source, refId: c.refId })) : [],
        title: title || null, premiumFree: isAdmin ? premiumFree : false,
        timeLimitMin: timeLimit || null,
      });
      setCreated({ ...r, full: `${window.location.origin}${r.url}` });
      setLinkName(r.title || '');
      setChatSent(false);
      loadSent();
      loadRank();
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }

  async function copyLink() {
    try { await navigator.clipboard.writeText(created.full); setCopied(true); setTimeout(() => setCopied(false), 2000); }
    catch { /* selectare manuală */ }
  }

  // a) denumirea linkului creat de profesor
  async function saveLinkName() {
    const t = linkName.trim();
    if (!t || !created || t === created.title) return;
    setRenaming(true); setError(null);
    try {
      await aiClient.groupAssignmentRename({ id: created.id, title: t });
      setCreated((c) => ({ ...c, title: t }));
      loadSent();
    } catch (e) { setError(e.message); }
    finally { setRenaming(false); }
  }

  // b) trimiterea linkului pe canalul grupei din mesagerie
  async function sendLinkToChat(a) {
    setChatBusy(true); setError(null);
    try {
      const { threads } = await aiClient.chatThreads();
      const gid = a.groupId || groupId || null;
      const t = (threads || []).find((x) => x.kind === 'group' && (!gid || x.groupId === gid))
        || (threads || []).find((x) => x.kind === 'group');
      if (!t) throw new Error('Nu ai încă o conversație de grupă. Fă o grupă cu elevi în „Grupe / Rezultate elevi".');
      await aiClient.chatSend({
        threadId: t.id, body: 'V-am trimis un test pe grupă — fiecare primește alt test:',
        attachment: { type: 'test', url: a.url, title: a.title || 'Test pe grupă' },
      });
      setChatSent(true);
    } catch (e) { setError(e.message); }
    finally { setChatBusy(false); }
  }

  function reset() {
    setCreated(null); setChecked([]); setMode('auto'); setTitle(''); setStep(0);
    setLinkName(''); setChatSent(false); setTimeLimit(0);
  }

  async function removeSent(id) {
    if (!window.confirm('Ștergi testul pe grupă? Linkul nu va mai funcționa, iar repartizările se șterg.')) return;
    try { await aiClient.groupAssignmentDelete({ id }); setSent((s) => (s || []).filter((x) => x.id !== id)); }
    catch (e) { setError(e.message); }
  }

  async function renameSent(a) {
    const t = window.prompt('Denumirea testului:', a.title);
    if (!t || !t.trim() || t.trim() === a.title) return;
    try {
      await aiClient.groupAssignmentRename({ id: a.id, title: t.trim() });
      setSent((s) => (s || []).map((x) => (x.id === a.id ? { ...x, title: t.trim() } : x)));
    } catch (e) { setError(e.message); }
  }

  const catLabel = category ? (CATEGORIES.find((c) => c.value === category)?.label || category) : 'toate categoriile';
  const srcLabel = sources.map((s) => SOURCES.find((x) => x.id === s)?.label.replace(/^\S+\s/, '')).join(' + ');

  // ── linkul creat ──────────────────────────────────────────────────────────
  if (created) {
    return (
      <div>
        <div style={{ padding: 16, background: 'rgba(39,174,96,.08)', border: '1px solid rgba(39,174,96,.35)', borderRadius: 12 }}>
          <div style={{ fontWeight: 700, color: '#1e7e34', marginBottom: 4 }}>
            ✅ Testul pe grupă a fost creat — {created.poolSize} teste în bazin
            {created.timeLimitMin ? ` · ⏳ ${fmtDurata(created.timeLimitMin)} de lucru` : ''}
          </div>
          <p style={{ fontSize: '.83rem', color: 'var(--text-muted)', marginBottom: 10 }}>
            Trimite <strong>acest singur link</strong> {groupName ? <>grupei <strong>{groupName}</strong></> : 'elevilor tăi'}.
            Fiecare elev care îl deschide primește <strong>alt test</strong> decât colegii lui.
            {created.timeLimitMin
              ? <> Are <strong>{fmtDurata(created.timeLimitMin)}</strong> de lucru din momentul în care apasă „Începe testul"; la zero, testul se închide singur.</>
              : null}
            {' '}Elevii asociați au primit deja și o notificare în cont.
          </p>

          {/* a) denumirea linkului — se poate schimba oricând, linkul rămâne */}
          <label style={{ display: 'block', fontSize: '.78rem', fontWeight: 700, color: 'var(--navy)', marginBottom: 4 }}>
            Denumirea testului
          </label>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
            <input value={linkName} onChange={(e) => setLinkName(e.target.value)} maxLength={120}
              placeholder="ex. Test recapitulativ — clasa a VIII-a"
              style={{ ...selStyle, flex: '1 1 240px' }} />
            <button className="btn btn-sm btn-outline" onClick={saveLinkName}
              disabled={renaming || !linkName.trim() || linkName.trim() === created.title}>
              {renaming ? 'Se salvează…' : linkName.trim() === created.title ? '✓ Salvat' : 'Salvează denumirea'}
            </button>
          </div>

          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <input readOnly value={created.full} onFocus={(e) => e.target.select()}
              style={{ flex: '1 1 240px', minWidth: 0, border: '1px solid var(--border)', borderRadius: 8, padding: '9px 11px', fontSize: '.82rem', fontFamily: 'monospace', background: 'var(--cream)' }} />
            <button className="btn btn-sm btn-primary" onClick={copyLink}>{copied ? '✓ Copiat' : 'Copiază linkul'}</button>
            <a className="btn btn-sm btn-outline" href={`https://wa.me/?text=${encodeURIComponent(`Test nou pe ExamenMate: ${created.full}`)}`} target="_blank" rel="noopener noreferrer">WhatsApp</a>
            <a className="btn btn-sm btn-outline" href={`mailto:?subject=${encodeURIComponent('Test nou — ExamenMate')}&body=${encodeURIComponent(`Rezolvă testul de aici: ${created.full}`)}`}>E-mail</a>
          </div>

          {/* b) trimiterea linkului pe mesageria grupei */}
          <div style={{ marginTop: 12, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <button className="btn btn-sm btn-outline" onClick={() => sendLinkToChat(created)} disabled={chatBusy || chatSent}>
              {chatSent ? '✓ Trimis pe mesagerie' : chatBusy ? 'Se trimite…' : '💬 Trimite pe mesageria grupei'}
            </button>
            <button className="btn btn-sm btn-outline" onClick={reset}>➕ Trimite alt test</button>
            <button className="btn btn-sm btn-outline" onClick={() => setOpenReport(created.id)}>📊 Vezi cine ce test a primit</button>
          </div>
          {error && <div style={{ marginTop: 8, fontSize: '.8rem', color: '#b71c1c' }}>⚠️ {error}</div>}
        </div>
        {openReport && <Report id={openReport} onClose={() => setOpenReport(null)} />}
      </div>
    );
  }

  // ── formularul ────────────────────────────────────────────────────────────
  return (
    <div>
      {!compact && (
        <p style={{ fontSize: '.86rem', color: 'var(--text-muted)', marginBottom: 14 }}>
          Un singur link pentru toată grupa — dar <strong>fiecare elev primește alt test</strong>.
          La testele următoare din aceeași grupă, fiecare elev primește pe cât posibil un test pe care nu l-a mai
          primit, până se epuizează testele din bazin; apoi se reia.
        </p>
      )}

      {/* 0 · Grupa */}
      <Step n={0} title="Alege grupa de elevi" open={step === 0} onToggle={() => setStep(step === 0 ? -1 : 0)}
        done={!!groups} summary={groupName ? `${groupName} · ${nStudents} elevi` : `Toți elevii mei · ${nStudents}`}>
        {!groups ? <div style={{ fontSize: '.84rem', color: 'var(--text-muted)' }}>Se încarcă grupele…</div> : (
          <>
            <select value={groupId} onChange={(e) => setGroupId(e.target.value)} style={{ ...selStyle, minWidth: 240 }}>
              <option value="">Toți elevii mei ({groups.total})</option>
              {(groups.groups || []).map((g) => <option key={g.id} value={g.id}>{g.name} ({g.students} elevi)</option>)}
            </select>
            {(groups.groups || []).length === 0 && (
              <div style={{ fontSize: '.78rem', color: 'var(--text-muted)', marginTop: 8 }}>
                Nu ai încă grupe. Le creezi în „Rezultate elevi" → <strong>Grupe</strong>. Până atunci, testul merge la toți elevii asociați.
              </div>
            )}
            {nStudents === 0 && (
              <div style={{ fontSize: '.78rem', color: '#b26a00', marginTop: 8 }}>
                ⚠️ Grupa nu are elevi — linkul va funcționa abia după ce adaugi elevi în ea.
              </div>
            )}
          </>
        )}
      </Step>

      {/* 1 · Categoria */}
      <Step n={1} title="Alege categoria testului: clasa sau examenul" open={step === 1} onToggle={() => setStep(step === 1 ? -1 : 1)}
        done={!!category} summary={catLabel}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div>
            <div style={{ fontSize: '.75rem', fontWeight: 700, color: 'var(--text-muted)', marginBottom: 5 }}>EXAMENE</div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {CATEGORIES.filter((c) => EXAM_CATS.includes(c.value)).map((c) => (
                <button key={c.value} type="button" style={chip(category === c.value)} onClick={() => setCategory(c.value)}>{c.label}</button>
              ))}
            </div>
          </div>
          <div>
            <div style={{ fontSize: '.75rem', fontWeight: 700, color: 'var(--text-muted)', marginBottom: 5 }}>CLASE</div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {CATEGORIES.filter((c) => c.value.startsWith('clasa-')).map((c) => (
                <button key={c.value} type="button" style={chip(category === c.value)} onClick={() => setCategory(c.value)}>{c.label}</button>
              ))}
              <button type="button" style={chip(category === '')} onClick={() => setCategory('')}>Toate</button>
            </div>
          </div>
        </div>
      </Step>

      {/* 2 · Formatul */}
      <Step n={2} title="Alege formatul testului" open={step === 2} onToggle={() => setStep(step === 2 ? -1 : 2)}
        done summary={FORMATS.find((f) => f.id === format)?.label}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {FORMATS.map((f) => (
            <button key={f.id} type="button" style={chip(format === f.id)} onClick={() => setFormat(f.id)} title={f.hint}>{f.label}</button>
          ))}
        </div>
        <div style={{ fontSize: '.76rem', color: 'var(--text-muted)', marginTop: 8 }}>{FORMATS.find((f) => f.id === format)?.hint}</div>
      </Step>

      {/* 3 · Numărul și locul testelor */}
      <Step n={3} title="Alege numărul de teste și de unde vin" open={step === 3} onToggle={() => setStep(step === 3 ? -1 : 3)}
        done summary={`${poolSize} teste · ${srcLabel}`}>
        <label style={{ display: 'block', fontSize: '.8rem', fontWeight: 600, color: 'var(--navy)', marginBottom: 6 }}>
          Câte teste intră în bazin
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 4 }}>
            <input type="number" min={1} max={60} value={poolSize}
              onChange={(e) => setPoolSize(Math.max(1, Math.min(60, parseInt(e.target.value, 10) || 1)))}
              style={{ ...selStyle, width: 90 }} />
            <span style={{ fontSize: '.76rem', color: 'var(--text-muted)', fontWeight: 400 }}>
              fiecare elev primește 1 test din bazin{nStudents > 0 && poolSize < nStudents ? ` — ai ${nStudents} elevi, deci unele teste se vor repeta` : ''}
            </span>
          </div>
        </label>
        <div style={{ fontSize: '.8rem', fontWeight: 600, color: 'var(--navy)', margin: '12px 0 6px' }}>De unde se iau testele</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {SOURCES.map((s) => (
            <label key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '.84rem', cursor: 'pointer' }}>
              <input type="checkbox" checked={sources.includes(s.id)} onChange={() => toggleSource(s.id)} />
              <span style={{ color: 'var(--navy)', fontWeight: 600 }}>{s.label}</span>
              <span style={{ color: 'var(--text-muted)', fontSize: '.76rem' }}>— {s.hint}</span>
            </label>
          ))}
        </div>
      </Step>

      {/* 4 · Alegerea testelor */}
      <Step n={4} title="Alege testele: automat, prin bifare, sau mixt" open={step === 4} onToggle={() => setStep(step === 4 ? -1 : 4)}
        done summary={mode === 'auto' ? 'automat' : `${checked.length} teste bifate`}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
          <button type="button" style={chip(mode === 'auto')} onClick={() => setMode('auto')}>🎲 Automat din categorie</button>
          <button type="button" style={chip(mode === 'manual')} onClick={() => setMode('manual')}>☑️ Testele bifate de mine</button>
          <button type="button" style={{ ...chip(false), borderStyle: 'dashed' }} onClick={proposeAuto} disabled={!filtered.length}
            title="Bifează automat testele, apoi le poți debifa sau adăuga altele">🔀 Mixt: propune automat, apoi ajustez</button>
        </div>

        {mode === 'auto' ? (
          <div style={{ fontSize: '.82rem', color: 'var(--text-muted)', background: 'var(--cream)', borderRadius: 8, padding: '9px 11px' }}>
            La creare, sistemul alege singur <strong>{poolSize}</strong> teste {format === 'pdf' ? 'PDF' : 'interactive'} din <strong>{catLabel}</strong> ({srcLabel}).
          </div>
        ) : (
          <>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 8 }}>
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Caută după titlu…" style={{ ...selStyle, flex: '1 1 180px' }} />
              <span style={{ fontSize: '.78rem', color: 'var(--text-muted)' }}>
                {checked.length} bifate / {filtered.length} disponibile
                {catalog.length !== filtered.length ? ` (din ${catalog.length} încărcate)` : ''}
              </span>
              {checked.length > 0 && <button type="button" className="btn btn-sm" style={{ color: '#c0392b' }} onClick={() => setChecked([])}>Golește</button>}
            </div>
            {checked.length > MAX_BAZIN && (
              <div style={{ fontSize: '.78rem', color: '#b26a00', marginBottom: 8 }}>
                ⚠️ Într-un bazin intră cel mult <strong>{MAX_BAZIN}</strong> teste — se iau primele {MAX_BAZIN} bifate.
                Restul le poți trimite cu un al doilea test pe grupă.
              </div>
            )}
            <div style={{ maxHeight: 340, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 8 }}>
              {catLoading ? (
                <div style={{ padding: 16, textAlign: 'center' }}><div className="spinner" /></div>
              ) : !filtered.length ? (
                <div style={{ padding: 14, fontSize: '.83rem', color: 'var(--text-muted)' }}>
                  Nu există teste {format === 'pdf' ? 'PDF' : 'interactive'} pentru criteriile alese. Schimbă categoria, formatul sau sursele de la pasul 3.
                </div>
              ) : (
                <>
                  {filtered.slice(0, vizibile).map((i) => (
                    <label key={`${i.source}:${i.refId}`}
                      style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '7px 10px', borderBottom: '1px solid var(--border)', cursor: 'pointer', background: isChecked(i) ? 'rgba(232,185,49,.10)' : '#fff' }}>
                      <input type="checkbox" checked={isChecked(i)} onChange={() => toggleItem(i)} />
                      <span style={{ flex: 1, minWidth: 0, fontSize: '.83rem', color: 'var(--navy)' }}>{i.title}</span>
                      <span style={{ fontSize: '.7rem', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                        {i.source === 'site' ? '📚 site' : i.source === 'personal' ? '🧩 al meu' : '🏛️ bibliotecă'}
                        {i.isFree === false ? ' · ⭐' : ''}
                      </span>
                    </label>
                  ))}
                  {filtered.length > vizibile && (
                    <button type="button" onClick={() => setVizibile((v) => v + PAS_LISTA)}
                      style={{ width: '100%', padding: '9px 10px', background: 'var(--cream)', border: 'none', borderTop: '1px solid var(--border)', cursor: 'pointer', fontFamily: 'var(--font-body)', fontWeight: 700, fontSize: '.8rem', color: 'var(--navy)' }}>
                      ▾ Arată încă {Math.min(PAS_LISTA, filtered.length - vizibile)} (mai sunt {filtered.length - vizibile})
                    </button>
                  )}
                </>
              )}
            </div>
            <div style={{ fontSize: '.74rem', color: 'var(--text-muted)', marginTop: 6 }}>
              Lista aduce <strong>toate</strong> testele din sursele alese — caută după titlu ca s-o îngustezi.
            </div>
          </>
        )}
      </Step>

      {/* 5 · Timpul de lucru */}
      <Step n={5} title="Alege timpul de lucru: ore și minute" open={step === 5} onToggle={() => setStep(step === 5 ? -1 : 5)}
        done summary={timeLimit ? fmtDurata(timeLimit) : 'fără limită de timp'}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
          {TIMPI.map((m) => (
            <button key={m} type="button" style={chip(timeLimit === m)} onClick={() => setTimeLimit(m)}>
              {fmtDurata(m)}
            </button>
          ))}
          <button type="button" style={{ ...chip(timeLimit === 0), borderStyle: 'dashed' }} onClick={() => setTimeLimit(0)}>
            ∞ Fără limită
          </button>
        </div>

        {/* orice altă durată, din ore + minute (10 minute … 3 ore) */}
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
          <span style={{ fontSize: '.8rem', fontWeight: 600, color: 'var(--navy)' }}>Sau alege exact:</span>
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: '.82rem', color: 'var(--text)' }}>
            <select
              value={Math.floor((timeLimit || 0) / 60)}
              onChange={(e) => {
                const h = parseInt(e.target.value, 10) || 0;
                const m = (timeLimit || 0) % 60;
                setTimeLimit(Math.min(TIMP_MAX, Math.max(TIMP_MIN, h * 60 + m)));
              }}
              style={{ ...selStyle, padding: '6px 8px' }}
            >
              {[0, 1, 2, 3].map((h) => <option key={h} value={h}>{h}</option>)}
            </select>
            ore
          </label>
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: '.82rem', color: 'var(--text)' }}>
            <select
              value={(timeLimit || 0) % 60}
              onChange={(e) => {
                const m = parseInt(e.target.value, 10) || 0;
                const h = Math.floor((timeLimit || 0) / 60);
                setTimeLimit(Math.min(TIMP_MAX, Math.max(TIMP_MIN, h * 60 + m)));
              }}
              style={{ ...selStyle, padding: '6px 8px' }}
            >
              {[0, 10, 15, 20, 30, 40, 45, 50].map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
            minute
          </label>
          {timeLimit > 0 && (
            <span style={{ fontSize: '.8rem', fontWeight: 700, color: 'var(--navy)', background: 'rgba(232,185,49,.18)', border: '1px solid var(--gold)', borderRadius: 20, padding: '3px 10px' }}>
              ⏳ {fmtDurata(timeLimit)}
            </span>
          )}
        </div>

        <div style={{ fontSize: '.76rem', color: 'var(--text-muted)', marginTop: 10, lineHeight: 1.5 }}>
          {timeLimit > 0 ? (
            <>
              Cronometrul pornește când elevul apasă <strong>„▶ Începe testul"</strong> și se vede tot timpul, în test.
              La zero, testul se închide singur, iar ce a apucat să trimită ajunge la tine. Dacă închide pagina și
              revine, timpul curge mai departe — nu o ia de la capăt.
            </>
          ) : (
            <>Fără limită de timp: elevul lucrează cât are nevoie și apasă singur „am terminat". Se poate alege între {TIMP_MIN} minute și 3 ore.</>
          )}
        </div>
      </Step>

      {/* Titlu + opțiunea de admin */}
      <div style={{ marginTop: 14, display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
        <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120}
          placeholder={`Denumirea testului (opțional) — ex. „Test recapitulativ ${catLabel}"`}
          style={{ ...selStyle, flex: '1 1 260px' }} />
      </div>

      {isAdmin && (
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10, padding: '9px 11px', borderRadius: 8, background: 'rgba(232,185,49,.12)', border: '1px solid var(--gold)', fontSize: '.83rem', cursor: 'pointer' }}>
          <input type="checkbox" checked={premiumFree} onChange={(e) => setPremiumFree(e.target.checked)} />
          <span style={{ color: 'var(--navy)' }}>
            <strong>Admin:</strong> trimite testele ⭐ premium <strong>gratuit</strong> — elevii le pot rezolva fără abonament (doar prin acest link).
          </span>
        </label>
      )}

      {error && <div style={{ marginTop: 10, fontSize: '.83rem', color: '#b71c1c' }}>⚠️ {error}</div>}

      <div style={{ marginTop: 14, display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
        <button className="btn btn-primary" disabled={busy || (mode === 'manual' && !checked.length)} onClick={submit}>
          {busy ? 'Se creează…' : '🔗 Creează linkul testului'}
        </button>
        <span style={{ fontSize: '.78rem', color: 'var(--text-muted)' }}>
          {groupName || 'Toți elevii mei'} · {catLabel} · {format === 'pdf' ? 'PDF' : 'interactiv'} · {mode === 'auto' ? `${poolSize} teste automat` : `${checked.length} teste bifate`} · {timeLimit ? `⏳ ${fmtDurata(timeLimit)}` : 'fără limită de timp'}
        </span>
      </div>

      {/* Testele deja trimise (rolldown) + clasamentul testelor primite, alături */}
      {sent && sent.length > 0 && (
        <div style={{ marginTop: 24, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 12, alignItems: 'start' }}>
          {/* stânga: testele trimise */}
          <div style={{ background: '#f7f9fc', borderRadius: 12, overflow: 'hidden' }}>
            <button type="button" onClick={() => setShowSent((v) => !v)} aria-expanded={showSent}
              style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, padding: '12px 14px', background: 'transparent', border: 'none', cursor: 'pointer', fontFamily: 'var(--font-body)', textAlign: 'left' }}>
              <strong style={{ color: 'var(--navy)', fontSize: '.9rem' }}>
                📨 Testele pe grupă trimise
                <span style={{ fontWeight: 500, color: 'var(--text-muted)', marginLeft: 6 }}>({sent.length})</span>
              </strong>
              <span style={{ color: 'var(--text-muted)', fontSize: '.8rem' }}>{showSent ? '▾ ascunde' : '▸ vezi'}</span>
            </button>
            {showSent && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '0 12px 12px' }}>
                {sent.map((a) => (
                  <div key={a.id} style={{ background: '#fff', borderRadius: 10, padding: '9px 12px', display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                    <div style={{ flex: '1 1 180px', minWidth: 0 }}>
                      <div style={{ fontWeight: 600, color: 'var(--navy)', fontSize: '.87rem' }}>{a.title}</div>
                      <div style={{ fontSize: '.73rem', color: 'var(--text-muted)' }}>
                        {a.group_name || 'toți elevii'} · {a.pool_size} teste · {a.format === 'pdf' ? 'PDF' : 'interactiv'} ·
                        {' '}{a.time_limit_min ? `⏳ ${fmtDurata(a.time_limit_min)} · ` : ''}
                        {new Date(a.created_at).toLocaleDateString('ro-RO')}
                        {a.premium_free ? ' · ⭐ premium gratuit' : ''}
                      </div>
                    </div>
                    <div style={{ fontSize: '.75rem', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                      {a.opened} deschise · {a.solved} rezolvate{a.avgPercent != null ? ` · medie ${a.avgPercent}%` : ''}
                    </div>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      <button className="btn btn-sm btn-outline" onClick={() => setOpenReport(openReport === a.id ? null : a.id)}>
                        {openReport === a.id ? '✕ Închide' : '📊 Raport'}
                      </button>
                      <button className="btn btn-sm btn-outline" title="Schimbă denumirea" onClick={() => renameSent(a)}>✎</button>
                      <button className="btn btn-sm btn-outline" title="Copiază linkul" onClick={() => navigator.clipboard?.writeText(`${window.location.origin}${a.url}`)}>🔗</button>
                      <button className="btn btn-sm btn-outline" title="Trimite pe mesageria grupei" onClick={() => sendLinkToChat(a)}>💬</button>
                      <button className="btn btn-sm" style={{ color: '#c0392b' }} onClick={() => removeSent(a.id)}>🗑</button>
                    </div>
                    {openReport === a.id && <div style={{ flexBasis: '100%' }}><Report id={a.id} /></div>}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* dreapta: clasamentul DOAR cu testele primite */}
          <div style={{ background: 'var(--cream)', borderRadius: 12, overflow: 'hidden' }}>
            <button type="button" onClick={() => setShowRank((v) => !v)} aria-expanded={showRank}
              style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, padding: '12px 14px', background: 'transparent', border: 'none', cursor: 'pointer', fontFamily: 'var(--font-body)', textAlign: 'left' }}>
              <strong style={{ color: 'var(--navy)', fontSize: '.9rem' }}>
                🏆 Clasament — doar testele primite
                {rank?.rows?.length ? <span style={{ fontWeight: 500, color: 'var(--text-muted)', marginLeft: 6 }}>({rank.rows.length})</span> : null}
              </strong>
              <span style={{ color: 'var(--text-muted)', fontSize: '.8rem' }}>{showRank ? '▾ ascunde' : '▸ vezi'}</span>
            </button>
            {showRank && (
              <div style={{ padding: '0 14px 14px' }}>
                <p style={{ fontSize: '.74rem', color: 'var(--text-muted)', marginBottom: 8 }}>
                  Numai testele repartizate prin linkurile de mai sus. Clasamentul general, cu tot ce a rezolvat
                  elevul pe platformă, rămâne în „Grupe / Rezultate elevi".
                </p>
                {!rank ? (
                  <div style={{ padding: 10, textAlign: 'center' }}><div className="spinner" /></div>
                ) : !rank.rows.length ? (
                  <div style={{ fontSize: '.82rem', color: 'var(--text-muted)' }}>
                    Niciun elev nu a deschis încă un test pe grupă.
                  </div>
                ) : (
                  <ol style={{ margin: 0, padding: 0, listStyle: 'none', display: 'grid', gap: 5 }}>
                    {rank.rows.slice(0, 20).map((s, i) => (
                      <li key={s.studentId} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, fontSize: '.84rem' }}>
                        <span style={{ color: 'var(--text)', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          <span style={{ display: 'inline-block', width: 22, fontWeight: 700 }}>
                            {i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}.`}
                          </span>
                          {s.name}
                          <span style={{ color: 'var(--text-muted)', fontSize: '.72rem' }}> · {s.solved}/{s.received} rezolvate</span>
                        </span>
                        <span style={{ fontWeight: 700, whiteSpace: 'nowrap', color: s.avg == null ? 'var(--text-muted)' : s.avg >= 80 ? '#2e7d32' : s.avg >= 50 ? '#e65100' : '#c62828' }}>
                          {s.avg != null ? `${s.avg}%` : '—'}
                        </span>
                      </li>
                    ))}
                  </ol>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Raportul unei teme: cine ce test a primit și ce scor a luat ────────────
function Report({ id, onClose }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  useEffect(() => { aiClient.groupAssignmentReport({ id }).then(setData).catch((e) => setError(e.message)); }, [id]);

  if (error) return <div style={{ fontSize: '.82rem', color: '#b71c1c', marginTop: 10 }}>⚠️ {error}</div>;
  if (!data) return <div style={{ padding: 14, textAlign: 'center' }}><div className="spinner" /></div>;

  const td = { padding: '6px 8px', fontSize: '.8rem', borderBottom: '1px solid var(--border)' };
  const color = (p) => (p == null ? 'var(--text-muted)' : p >= 80 ? '#2e7d32' : p >= 50 ? '#e65100' : '#c62828');

  return (
    <div style={{ marginTop: 12, background: '#fff', border: '1px solid var(--border)', borderRadius: 10, padding: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, gap: 10, flexWrap: 'wrap' }}>
        <strong style={{ color: 'var(--navy)', fontSize: '.88rem' }}>
          {data.assignment?.title}
          {data.assignment?.timeLimitMin
            ? <span style={{ fontWeight: 600, color: 'var(--text-muted)', marginLeft: 8 }}>⏳ {fmtDurata(data.assignment.timeLimitMin)}</span>
            : null}
        </strong>
        {onClose && <button className="btn btn-sm btn-outline" onClick={onClose}>✕ Închide</button>}
      </div>
      {!data.rows?.length ? (
        <div style={{ fontSize: '.82rem', color: 'var(--text-muted)' }}>Nu sunt elevi în grupă (sau nimeni nu a deschis încă linkul).</div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 460 }}>
            <thead>
              <tr style={{ textAlign: 'left', color: 'var(--text-muted)', fontSize: '.72rem', textTransform: 'uppercase' }}>
                <th style={td}>Elev</th><th style={td}>Testul primit</th><th style={td}>Stare</th><th style={td}>Scor</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((r) => (
                <tr key={r.studentId}>
                  <td style={{ ...td, fontWeight: 600, color: 'var(--navy)' }}>{r.name}{r.outsideGroup ? ' *' : ''}</td>
                  <td style={td}>{r.test || <span style={{ color: 'var(--text-muted)' }}>— nu a deschis linkul</span>}</td>
                  <td style={td}>
                    {r.timedOut ? '⏰ timp expirat' : r.completedAt ? '✅ rezolvat' : r.openedAt ? '👀 deschis' : '—'}
                  </td>
                  <td style={{ ...td, fontWeight: 700, color: color(r.percent) }}>
                    {r.percent != null ? `${r.percent}%` : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {data.rows.some((r) => r.outsideGroup) && (
            <div style={{ fontSize: '.72rem', color: 'var(--text-muted)', marginTop: 6 }}>* elev din afara grupei curente</div>
          )}
        </div>
      )}
    </div>
  );
}
