// =====================================================================
// src/components/TemaPicker.jsx — butonul „📝 Dă temă" + fereastra lui
//
// Apare în „Contul meu" → Grupe / Rezultate elevi:
//   • lângă GRUPĂ  → tema merge la toți elevii grupei;
//   • lângă ELEV   → tema merge doar elevului acela.
//
// Fereastra arată lista de teste și exerciții cu BIFARE și un buton de
// CĂUTARE. Toți elevii vizați primesc ACELAȘI set — cel bifat aici.
// (La „Test pe grupă" e invers: fiecare elev primește alt test din bazin.)
//
// După trimitere: linkul temei, un câmp pentru DENUMIRE și butonul
// „💬 Trimite pe mesageria grupei".
// =====================================================================
import { useCallback, useEffect, useMemo, useState } from 'react';
import { aiClient } from '../lib/aiClient';
import { CATEGORIES } from '../lib/contentMeta';

const SOURCES = [
  { id: 'site', label: '📚 Testele din site', hint: '„Examene" și „Clase"' },
  { id: 'personal', label: '🧩 Testele generate de mine', hint: 'din „Testele și exercițiile mele"' },
  { id: 'public', label: '🏛️ Biblioteca utilizatorilor', hint: 'teste publicate de profesori' },
];
const FORMATS = [
  { id: '', label: 'Toate' },
  { id: 'interactive', label: '🧩 Interactive' },
  { id: 'pdf', label: '📄 PDF' },
];

const inp = { border: '1px solid var(--border)', borderRadius: 8, padding: '8px 10px', fontSize: '.85rem', fontFamily: 'var(--font-body)', background: '#fff', color: 'var(--text)' };
const chip = (active) => ({
  padding: '6px 12px', borderRadius: 999, cursor: 'pointer', fontSize: '.8rem', fontWeight: 600,
  border: `1.5px solid ${active ? 'var(--navy)' : 'var(--border)'}`,
  background: active ? 'var(--navy)' : '#fff', color: active ? '#fff' : 'var(--navy)',
});

// ─── Butonul mic, de pus lângă grupă / elev ─────────────────────────────────
export function DaTemaButton({ groupId = null, groupName = null, studentId = null, studentName = null, onDone, small = false }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button" onClick={(e) => { e.stopPropagation(); setOpen(true); }}
        title={studentId ? `Dă temă elevului ${studentName || ''}` : `Dă temă grupei ${groupName || ''}`}
        style={{
          padding: small ? '5px 10px' : '6px 12px', borderRadius: 20, cursor: 'pointer',
          border: '1.5px solid var(--gold)', background: 'rgba(232,185,49,.14)', color: 'var(--navy)',
          fontWeight: 700, fontSize: small ? '.76rem' : '.8rem', whiteSpace: 'nowrap',
          fontFamily: 'var(--font-body)',
        }}
      >
        📝 Dă temă
      </button>
      {open && (
        <TemaPicker
          groupId={groupId} groupName={groupName}
          studentId={studentId} studentName={studentName}
          onClose={() => setOpen(false)} onDone={onDone}
        />
      )}
    </>
  );
}

// ─── Fereastra de alegere a exercițiilor ────────────────────────────────────
export default function TemaPicker({ groupId, groupName, studentId, studentName, onClose, onDone }) {
  const [sources, setSources] = useState(['site']);
  const [category, setCategory] = useState('');
  const [format, setFormat] = useState('');
  const [q, setQ] = useState('');
  const [applied, setApplied] = useState('');       // căutarea confirmată cu butonul
  const [items, setItems] = useState(null);
  const [loading, setLoading] = useState(false);
  const [checked, setChecked] = useState([]);
  const [title, setTitle] = useState('');
  const [note, setNote] = useState('');
  const [dueAt, setDueAt] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [created, setCreated] = useState(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const r = await aiClient.homeworkCatalog({ sources, category: category || null, format: format || null, q: applied });
      setItems(r.items || []);
    } catch (e) { setError(e.message); setItems([]); }
    finally { setLoading(false); }
  }, [sources, category, format, applied]);

  useEffect(() => { load(); }, [load]);

  const isChecked = (i) => checked.some((c) => c.source === i.source && c.refId === i.refId);
  function toggle(i) {
    setChecked((c) => (isChecked(i)
      ? c.filter((x) => !(x.source === i.source && x.refId === i.refId))
      : [...c, { source: i.source, refId: i.refId, title: i.title }]));
  }
  function toggleSource(id) {
    setSources((s) => (s.includes(id) ? (s.length > 1 ? s.filter((x) => x !== id) : s) : [...s, id]));
  }

  const target = studentId ? `elevului ${studentName || ''}`.trim() : `grupei ${groupName || 'alese'}`;

  async function submit() {
    if (!checked.length) return;
    setBusy(true); setError(null);
    try {
      const r = await aiClient.homeworkCreate({
        groupId: studentId ? null : (groupId || null),
        studentId: studentId || null,
        items: checked.map((c) => ({ source: c.source, refId: c.refId })),
        title: title || null, note: note || null,
        dueAt: dueAt ? new Date(dueAt).toISOString() : null,
      });
      setCreated({ ...r, full: `${window.location.origin}${r.url}` });
      onDone?.();
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }

  const shown = useMemo(() => items || [], [items]);

  const overlay = {
    position: 'fixed', inset: 0, background: 'rgba(10,26,47,.55)', zIndex: 2000,
    display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
  };
  const panel = {
    background: '#fff', borderRadius: 14, width: 'min(680px, 100%)', maxHeight: '90vh',
    display: 'flex', flexDirection: 'column', overflow: 'hidden', boxShadow: '0 20px 60px rgba(0,0,0,.3)',
  };

  return (
    <div style={overlay} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={panel} onClick={(e) => e.stopPropagation()}>
        <div style={{ padding: '13px 16px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
          <strong style={{ color: 'var(--navy)', fontFamily: 'var(--font-display)', fontSize: '1rem' }}>
            📝 Dă temă {target}
          </strong>
          <button type="button" onClick={onClose}
            style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '1.1rem', color: 'var(--text-muted)' }}>✕</button>
        </div>

        {created ? (
          <CreatedBox created={created} groupId={studentId ? null : groupId} onClose={onClose} onDone={onDone} />
        ) : (
          <>
            <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 10 }}>
              {/* Căutare */}
              <form onSubmit={(e) => { e.preventDefault(); setApplied(q.trim()); }}
                style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Caută test sau exercițiu după titlu…"
                  style={{ ...inp, flex: '1 1 200px' }} />
                <button type="submit" className="btn btn-sm" style={{ background: 'var(--gold)', color: 'var(--navy)', fontWeight: 700 }}>🔍 Caută</button>
                {applied && (
                  <button type="button" className="btn btn-sm btn-outline" onClick={() => { setQ(''); setApplied(''); }}>✕ Golește căutarea</button>
                )}
              </form>

              {/* Filtre */}
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                <select value={category} onChange={(e) => setCategory(e.target.value)} style={{ ...inp, minWidth: 170 }}>
                  <option value="">Toate categoriile</option>
                  {CATEGORIES.filter((c) => c.value !== 'manuale').map((c) => (
                    <option key={c.value} value={c.value}>{c.label}</option>
                  ))}
                </select>
                {FORMATS.map((f) => (
                  <button key={f.id} type="button" style={chip(format === f.id)} onClick={() => setFormat(f.id)}>{f.label}</button>
                ))}
              </div>
              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                {SOURCES.map((s) => (
                  <label key={s.id} title={s.hint} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '.8rem', cursor: 'pointer', color: 'var(--navy)' }}>
                    <input type="checkbox" checked={sources.includes(s.id)} onChange={() => toggleSource(s.id)} />
                    {s.label}
                  </label>
                ))}
              </div>
            </div>

            {/* Lista cu bifare */}
            <div style={{ flex: 1, overflowY: 'auto', minHeight: 160 }}>
              {loading ? (
                <div style={{ padding: 24, textAlign: 'center' }}><div className="spinner" /></div>
              ) : !shown.length ? (
                <div style={{ padding: 18, fontSize: '.85rem', color: 'var(--text-muted)' }}>
                  Niciun test sau exercițiu pentru filtrele alese. Schimbă categoria, formatul sau sursele.
                </div>
              ) : shown.map((i) => (
                <label key={`${i.source}:${i.refId}`}
                  style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '8px 16px', borderBottom: '1px solid var(--border)', cursor: 'pointer', background: isChecked(i) ? 'rgba(232,185,49,.1)' : '#fff' }}>
                  <input type="checkbox" checked={isChecked(i)} onChange={() => toggle(i)} />
                  <span style={{ flex: 1, minWidth: 0, fontSize: '.84rem', color: 'var(--navy)' }}>{i.title}</span>
                  <span style={{ fontSize: '.7rem', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                    {i.kind === 'interactive' ? '🧩' : '📄'}{' '}
                    {i.source === 'site' ? 'site' : i.source === 'personal' ? 'al meu' : 'bibliotecă'}
                    {i.isFree === false ? ' · ⭐' : ''}
                  </span>
                </label>
              ))}
            </div>

            {/* Trimitere */}
            <div style={{ padding: '12px 16px', borderTop: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 9 }}>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120}
                  placeholder="Denumirea temei (opțional)" style={{ ...inp, flex: '1 1 200px' }} />
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '.78rem', color: 'var(--text-muted)' }}>
                  Termen:
                  <input type="date" value={dueAt} onChange={(e) => setDueAt(e.target.value)} style={{ ...inp, padding: '7px 9px' }} />
                </label>
              </div>
              <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={500}
                placeholder="Un mesaj pentru elevi (opțional)" style={inp} />
              {error && <div style={{ fontSize: '.82rem', color: '#b71c1c' }}>⚠️ {error}</div>}
              <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                <button className="btn btn-primary btn-sm" disabled={busy || !checked.length} onClick={submit}>
                  {busy ? 'Se trimite…' : `📤 Trimite tema (${checked.length})`}
                </button>
                <span style={{ fontSize: '.78rem', color: 'var(--text-muted)' }}>
                  {checked.length ? `${checked.length} ${checked.length === 1 ? 'exercițiu bifat' : 'exerciții bifate'}` : 'Bifează exercițiile care intră în temă'}
                </span>
                {checked.length > 0 && (
                  <button type="button" className="btn btn-sm" style={{ color: '#c0392b' }} onClick={() => setChecked([])}>Golește bifele</button>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ─── După trimitere: linkul + denumirea + trimiterea pe mesagerie ───────────
function CreatedBox({ created, groupId, onClose, onDone }) {
  const [name, setName] = useState(created.title || '');
  const [savedName, setSavedName] = useState(created.title || '');
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(false);
  const [sent, setSent] = useState(false);
  const [sending, setSending] = useState(false);
  const [err, setErr] = useState(null);

  async function saveName() {
    const t = name.trim();
    if (!t || t === savedName) return;
    setSaving(true); setErr(null);
    try { await aiClient.homeworkRename({ id: created.id, title: t }); setSavedName(t); onDone?.(); }
    catch (e) { setErr(e.message); }
    finally { setSaving(false); }
  }

  async function sendToChat() {
    setSending(true); setErr(null);
    try {
      const { threads } = await aiClient.chatThreads();
      const t = (threads || []).find((x) => x.kind === 'group' && (!groupId || x.groupId === groupId))
        || (threads || []).find((x) => x.kind === 'group');
      if (!t) throw new Error('Nu ai încă o grupă cu elevi, deci nu există o conversație de grupă.');
      await aiClient.chatSend({
        threadId: t.id, body: 'V-am dat o temă nouă:',
        attachment: { type: 'tema', url: created.url, title: savedName || created.title },
      });
      setSent(true);
    } catch (e) { setErr(e.message); }
    finally { setSending(false); }
  }

  return (
    <div style={{ padding: 16 }}>
      <div style={{ padding: 14, background: 'rgba(39,174,96,.08)', border: '1px solid rgba(39,174,96,.35)', borderRadius: 12 }}>
        <div style={{ fontWeight: 700, color: '#1e7e34', marginBottom: 4 }}>
          ✅ Tema a fost trimisă — {created.items} {created.items === 1 ? 'exercițiu' : 'exerciții'}
          {created.students ? ` · ${created.students} ${created.students === 1 ? 'elev' : 'elevi'}` : ''}
        </div>
        <p style={{ fontSize: '.82rem', color: 'var(--text-muted)', marginBottom: 12 }}>
          Elevii au primit notificare în cont și găsesc tema la „📌 Teme nefăcute". Poți trimite și linkul:
        </p>

        {/* a) denumirea */}
        <label style={{ display: 'block', fontSize: '.78rem', fontWeight: 700, color: 'var(--navy)', marginBottom: 4 }}>Denumirea temei</label>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={120}
            style={{ ...inp, flex: '1 1 220px' }} placeholder="ex. Temă recapitulativă — fracții" />
          <button className="btn btn-sm btn-outline" onClick={saveName} disabled={saving || !name.trim() || name.trim() === savedName}>
            {saving ? 'Se salvează…' : name.trim() === savedName ? '✓ Salvat' : 'Salvează denumirea'}
          </button>
        </div>

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <input readOnly value={created.full} onFocus={(e) => e.target.select()}
            style={{ flex: '1 1 220px', minWidth: 0, border: '1px solid var(--border)', borderRadius: 8, padding: '9px 11px', fontSize: '.8rem', fontFamily: 'monospace', background: 'var(--cream)' }} />
          <button className="btn btn-sm btn-primary" onClick={async () => {
            try { await navigator.clipboard.writeText(created.full); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { /* selectare manuală */ }
          }}>{copied ? '✓ Copiat' : 'Copiază linkul'}</button>
        </div>

        {/* b) trimiterea pe mesagerie */}
        <div style={{ marginTop: 12, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button className="btn btn-sm btn-outline" onClick={sendToChat} disabled={sending || sent}>
            {sent ? '✓ Trimis pe mesagerie' : sending ? 'Se trimite…' : '💬 Trimite pe mesageria grupei'}
          </button>
          <button className="btn btn-sm btn-outline" onClick={onClose}>Închide</button>
        </div>
        {err && <div style={{ marginTop: 8, fontSize: '.8rem', color: '#b71c1c' }}>⚠️ {err}</div>}
      </div>
    </div>
  );
}
