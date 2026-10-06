// =====================================================================
// src/components/ContentAdminTools.jsx — Admin → „Tot Conținutul"
//   • ContentMetaFields — titlu / categorie / subcategorie / profil (folosit
//     la Adaugă PDF, Adaugă Interactiv și la editare);
//   • EditContentModal  — „✏️ Editează": titlu, descriere, categorie, rubrică,
//     tip, acces (gratuit/premium, cu mutarea fișierului între bucket-uri
//     pe server), ordine;
//   • ReplaceFileModal  — „🔁 Înlocuiește": alt fișier pentru același material;
//     data adăugării și poziția în listă rămân (deci și ordinea de pe site),
//     la fel rezultatele elevilor, recenziile și temele date;
//   • ReorderPanel      — „↕ Ordinea de afișare": alegi rubrica exact ca pe
//     site, muți materialele cu drag-and-drop sau cu săgeți, sortări rapide,
//     apoi salvezi; plus sortarea automată a întregului site / unei categorii
//     și „📥 Materialele noi apar: primele / ultimele" (site / categorie / rubrică).
// Scrierile merg prin /api/content-admin (service role + verificare admin).
// Stilurile (`s`) vin din Admin.jsx, ca la ReviewsAdmin / AdminRezolvari.
// =====================================================================
import { useEffect, useMemo, useRef, useState } from 'react';
import { apiPost } from '../lib/api';
import { supabase } from '../lib/supabase';
import {
  CATEGORIES, BAC_PROFILES, CONTENT_TYPES,
  categoryLabel, subcategoryLabel, profileLabel, subcategoriesFor, needsProfile, hasSubcategories,
  allowedContentTypes, storageInfo, siteOrder, matchesGroup, visibilityWarning, visibleTypesFor,
  rubricKey, newPositionInfo, replaceKind, replacementPath, fileExtension,
} from '../lib/contentMeta';

const dateRo = (d) => { try { return new Date(d).toLocaleDateString('ro-RO'); } catch { return ''; } };
const sizeRo = (b) => (b < 1024 ? `${b} B` : b < 1024 * 1024 ? `${Math.round(b / 1024)} KB` : `${(b / 1024 / 1024).toFixed(1).replace('.', ',')} MB`);

// ─── Câmpuri meta partajate (titlu/categorie/subcategorie/profil) ─────────────
export function ContentMetaFields({ s, form, setForm, titlePlaceholder }) {
  const subs = subcategoriesFor(form.category);
  const isBAC = form.category === 'bacalaureat';
  return (
    <>
      <div style={s.formRow}>
        <div style={s.formGroup}>
          <label style={s.label}>Titlu *</label>
          <input style={s.input} value={form.title}
            onChange={e => setForm(p => ({ ...p, title: e.target.value }))}
            placeholder={titlePlaceholder} />
        </div>
        <div style={s.formGroup}>
          <label style={s.label}>Categorie *</label>
          <select style={s.select} value={form.category}
            onChange={e => setForm(p => ({ ...p, category: e.target.value, subcategory: '', profile: '' }))}>
            {CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
          </select>
        </div>
      </div>

      {subs.length > 0 && !isBAC && (
        <div style={s.formGroup}>
          <label style={s.label}>Subcategorie EN</label>
          <select style={s.select} value={form.subcategory}
            onChange={e => setForm(p => ({ ...p, subcategory: e.target.value }))}>
            <option value="">— Selectează —</option>
            {subs.map(x => <option key={x.value} value={x.value}>{x.label}</option>)}
          </select>
        </div>
      )}

      {isBAC && (
        <div style={s.formRow}>
          <div style={s.formGroup}>
            <label style={s.label}>Profil Bacalaureat</label>
            <select style={s.select} value={form.profile}
              onChange={e => setForm(p => ({ ...p, profile: e.target.value }))}>
              <option value="">— Selectează —</option>
              {BAC_PROFILES.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
            </select>
          </div>
          <div style={s.formGroup}>
            <label style={s.label}>Subcategorie BAC</label>
            <select style={s.select} value={form.subcategory}
              onChange={e => setForm(p => ({ ...p, subcategory: e.target.value }))}>
              <option value="">— Selectează —</option>
              {subs.map(x => <option key={x.value} value={x.value}>{x.label}</option>)}
            </select>
          </div>
        </div>
      )}
    </>
  );
}

// ─── Modal „Editează" ─────────────────────────────────────────────────────────
export function EditContentModal({ s, item, onClose, onSaved, onReplace = null }) {
  const [form, setForm] = useState({
    title: item.title || '', description: item.description || '',
    category: item.category, subcategory: item.subcategory || '', profile: item.profile || '',
    content_type: item.content_type, is_free: !!item.is_free,
    sort_order: item.sort_order == null ? 0 : item.sort_order,
  });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState(null);
  const allowedTypes = allowedContentTypes(item);
  const file = storageInfo(item.file_url);
  const accessChanged = form.is_free !== !!item.is_free;
  const preview = { ...item, ...form, subcategory: form.subcategory || null, profile: form.profile || null };
  const warn = visibilityWarning(preview);

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  async function save() {
    if (!form.title.trim()) { setErr('Titlul e obligatoriu.'); return; }
    setSaving(true); setErr(null);
    try {
      const r = await apiPost('/api/content-admin', {
        action: 'update', id: item.id,
        data: {
          title: form.title, description: form.description, category: form.category,
          subcategory: form.subcategory || null, profile: form.profile || null,
          content_type: form.content_type, is_free: form.is_free, sort_order: form.sort_order,
        },
      });
      onSaved(r.row || { ...item, ...form }, r);
    } catch (e) { setErr(e.message); }
    finally { setSaving(false); }
  }

  const field = (label, node) => (
    <div style={s.formGroup}><label style={s.label}>{label}</label>{node}</div>
  );

  return (
    <div onClick={onClose}
      style={{ position: 'fixed', inset: 0, background: 'rgba(15,43,68,0.55)', zIndex: 9000, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '40px 16px', overflowY: 'auto' }}>
      <div onClick={e => e.stopPropagation()} role="dialog" aria-modal="true"
        style={{ background: '#fff', borderRadius: 12, width: '100%', maxWidth: 760, boxShadow: '0 12px 40px rgba(0,0,0,0.25)', padding: '24px 28px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, paddingBottom: 12, borderBottom: '2px solid #f0f4f8' }}>
          <div style={{ fontFamily: 'var(--font-display)', fontSize: '1.15rem', color: 'var(--navy)' }}>✏️ Editează materialul</div>
          <button onClick={onClose} aria-label="Închide" style={{ background: 'none', border: 'none', fontSize: '1.3rem', cursor: 'pointer', color: '#8e95a3' }}>✕</button>
        </div>

        {err && <div style={s.alert('error')}>⚠️ {err}</div>}

        <ContentMetaFields s={s} form={form} setForm={setForm} titlePlaceholder="Titlul materialului" />

        {field('Descriere', (
          <input style={s.input} value={form.description} placeholder="Scurtă descriere opțională"
            onChange={e => setForm(p => ({ ...p, description: e.target.value }))} />
        ))}

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16 }}>
          {field('Tip', (
            <select style={s.select} value={form.content_type}
              onChange={e => setForm(p => ({ ...p, content_type: e.target.value }))}>
              {CONTENT_TYPES.map(t => (
                <option key={t.value} value={t.value} disabled={!allowedTypes.includes(t.value)}>{t.label}</option>
              ))}
            </select>
          ))}
          {field('Acces', (
            <select style={s.select} value={form.is_free ? 'free' : 'premium'}
              onChange={e => setForm(p => ({ ...p, is_free: e.target.value === 'free' }))}>
              <option value="free">🟢 Gratuit</option>
              <option value="premium">⭐ Premium</option>
            </select>
          ))}
          {field('Ordine (poziție)', (
            <input type="number" min={0} style={s.input} value={form.sort_order}
              onChange={e => setForm(p => ({ ...p, sort_order: e.target.value === '' ? '' : Math.max(0, parseInt(e.target.value, 10) || 0) }))} />
          ))}
        </div>

        <div style={{ fontSize: '0.78rem', color: '#8e95a3', lineHeight: 1.6, marginTop: -6, marginBottom: 14 }}>
          Tipul poate fi doar unul compatibil cu fișierul ({file ? file.name : 'fără fișier'}). Ordinea: număr mai mic = apare mai sus
          (0 = primul); cel mai comod o stabilești din „↕ Ordinea de afișare".
        </div>

        {file && (
          <div style={{ background: '#f7f9fc', border: '1px solid #e6eaf0', borderRadius: 8, padding: '10px 14px', fontSize: '0.82rem', color: '#5a6170', marginBottom: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
              <span>📎 <strong>{file.name}</strong>{file.bucket ? <> · bucket <code>{file.bucket}</code></> : null} · adăugat {dateRo(item.created_at)}</span>
              {onReplace && (
                <button type="button" style={{ ...s.btnSecondary, padding: '5px 12px', fontSize: '0.8rem' }} disabled={saving}
                  title="Alt fișier pentru același material — data adăugării și poziția rămân"
                  onClick={onReplace}>🔁 Înlocuiește fișierul…</button>
              )}
            </div>
            {accessChanged && (
              <div style={{ color: '#e65100', marginTop: 4 }}>
                ↪ La salvare, fișierul va fi mutat în bucket-ul <code>{form.is_free ? 'content-files-free' : 'content-files'}</code>
                {form.is_free ? ' (public — material gratuit).' : ' (privat — doar prin link semnat, pentru abonați).'}
              </div>
            )}
          </div>
        )}

        {warn && <div style={{ ...s.alert('error'), background: '#fff3e0', color: '#e65100' }}>⚠️ {warn}</div>}

        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 6 }}>
          <button style={s.btnSecondary} onClick={onClose} disabled={saving}>Renunță</button>
          <button style={s.btnPrimary} onClick={save} disabled={saving}>{saving ? 'Se salvează...' : '💾 Salvează'}</button>
        </div>
      </div>
    </div>
  );
}

// ─── Modal „🔁 Înlocuiește fișierul" ──────────────────────────────────────────
// Fișierul nou se încarcă în același bucket (gratuit / premium), într-o cale
// nouă; serverul (replace_file) mută materialul pe el și șterge fișierul vechi.
// Rândul din baza de date rămâne același → data adăugării și poziția nu se schimbă.
export function ReplaceFileModal({ s, item, onClose, onReplaced }) {
  const kind = replaceKind(item);
  const cur = storageInfo(item.file_url);
  const [file, setFile] = useState(null);
  const [drag, setDrag] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const inputRef = useRef(null);
  const bucket = item.is_free ? 'content-files-free' : 'content-files';
  const position = item.sort_order == null ? 0 : item.sort_order;

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape' && !busy) onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, busy]);

  function pick(f) {
    if (!f) return;
    setErr(null);
    const ext = fileExtension(f.name);
    if (!kind.exts.includes(ext)) { setErr(`Alege ${kind.label === 'PDF' ? 'un PDF (.pdf)' : 'un fișier HTML (.html)'} — materialul e de tip „${item.content_type}".`); return; }
    if (f.size > 50 * 1024 * 1024) { setErr('Fișierul e prea mare (peste 50 MB).'); return; }
    if (f.size < 50) { setErr('Fișierul pare gol.'); return; }
    setFile(f);
  }

  async function go() {
    if (!file || busy) return;
    setBusy(true); setErr(null);
    const path = replacementPath(item, file.name);
    try {
      const { error: upErr } = await supabase.storage.from(bucket).upload(path, file, { contentType: kind.mime });
      if (upErr) throw new Error(`Încărcarea fișierului a eșuat: ${upErr.message}`);
      try {
        const r = await apiPost('/api/content-admin', { action: 'replace_file', id: item.id, path, expectUrl: item.file_url || null });
        onReplaced(r.row, r);
      } catch (e) {
        // materialul a rămas pe fișierul vechi → fișierul abia încărcat nu mai trebuie
        await supabase.storage.from(bucket).remove([path]).catch(() => {});
        throw e;
      }
    } catch (e) { setErr(e.message); setBusy(false); }
  }

  return (
    <div onClick={() => { if (!busy) onClose(); }}
      style={{ position: 'fixed', inset: 0, background: 'rgba(15,43,68,0.55)', zIndex: 9000, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '40px 16px', overflowY: 'auto' }}>
      <div onClick={e => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Înlocuiește fișierul"
        style={{ background: '#fff', borderRadius: 12, width: '100%', maxWidth: 640, boxShadow: '0 12px 40px rgba(0,0,0,0.25)', padding: '24px 28px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14, paddingBottom: 12, borderBottom: '2px solid #f0f4f8' }}>
          <div style={{ fontFamily: 'var(--font-display)', fontSize: '1.15rem', color: 'var(--navy)' }}>🔁 Înlocuiește fișierul</div>
          <button onClick={onClose} disabled={busy} aria-label="Închide" style={{ background: 'none', border: 'none', fontSize: '1.3rem', cursor: 'pointer', color: '#8e95a3' }}>✕</button>
        </div>

        <div style={{ fontWeight: 700, color: 'var(--navy)', marginBottom: 4 }}>{item.title}</div>
        <div style={{ fontSize: '0.8rem', color: '#8e95a3', marginBottom: 12 }}>
          {categoryLabel(item.category)}
          {hasSubcategories(item.category) && item.subcategory ? ` › ${subcategoryLabel(item.category, item.subcategory)}` : ''}
          {item.profile ? ` › ${profileLabel(item.profile)}` : ''} · <span style={s.badge(item.content_type)}>{item.content_type}</span> · {item.is_free ? 'Gratuit' : 'Premium'}
        </div>

        <div style={{ background: '#f7f9fc', border: '1px solid #e6eaf0', borderRadius: 8, padding: '10px 14px', fontSize: '0.84rem', color: '#5a6170', marginBottom: 12 }}>
          Fișierul de acum: <strong>📎 {cur?.name || (item.file_url ? 'fișier' : '— (fără fișier)')}</strong>
          <div style={{ fontSize: '0.78rem', marginTop: 3 }}>adăugat pe site pe <strong>{dateRo(item.created_at)}</strong> · poziția în rubrică: <strong>{position}</strong></div>
        </div>

        <div
          onDragOver={e => { e.preventDefault(); if (!busy) setDrag(true); }}
          onDragLeave={() => setDrag(false)}
          onDrop={e => { e.preventDefault(); setDrag(false); if (!busy) pick(e.dataTransfer.files[0]); }}
          onClick={() => { if (!busy) inputRef.current?.click(); }}
          style={{
            border: `2px dashed ${drag ? 'var(--gold)' : file ? '#81c784' : '#dde1e8'}`, borderRadius: 10, padding: '22px 18px', textAlign: 'center',
            background: drag ? 'rgba(232,185,49,0.05)' : file ? '#f1f8f2' : '#fafbfc', cursor: busy ? 'default' : 'pointer', marginBottom: 12,
          }}>
          {file ? (
            <>
              <div style={{ fontSize: '1.7rem' }}>{kind.icon}</div>
              <div style={{ fontWeight: 700, marginTop: 6, color: 'var(--navy)' }}>Fișierul nou: {file.name}</div>
              <div style={{ color: '#8e95a3', fontSize: '0.8rem' }}>{sizeRo(file.size)} · apasă ca să alegi altul</div>
            </>
          ) : (
            <>
              <div style={{ fontSize: '1.7rem' }}>☁️</div>
              <div style={{ fontWeight: 600, marginTop: 6 }}>Trage noul {kind.label} aici sau apasă ca să-l alegi</div>
              <div style={{ color: '#8e95a3', fontSize: '0.8rem', marginTop: 3 }}>doar {kind.exts.map((x) => `.${x}`).join(' / ')}</div>
            </>
          )}
        </div>
        <input ref={inputRef} type="file" accept={kind.accept} style={{ display: 'none' }} onChange={e => { pick(e.target.files[0]); e.target.value = ''; }} />

        <div style={{ background: '#e8f5e9', border: '1px solid #c8e6c9', borderRadius: 8, padding: '10px 14px', fontSize: '0.82rem', color: '#2e5d32', lineHeight: 1.6, marginBottom: 12 }}>
          <strong>Rămân la fel:</strong> titlul, descrierea, rubrica, accesul, <strong>data adăugării ({dateRo(item.created_at)}) și poziția în listă</strong> —
          deci ordinea de pe site nu se schimbă. Rezultatele elevilor, recenziile și temele date rămân la acest material.
          <br /><strong>Se schimbă doar fișierul:</strong> textul citit de Profesorul Virtual și căutarea se refac singure
          {item.content_type === 'interactive' ? ', iar punctajul se calculează după răspunsurile din noul fișier' : ''}. Fișierul vechi se șterge din Storage.
        </div>

        {err && <div style={s.alert('error')}>⚠️ {err}</div>}

        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button style={s.btnSecondary} onClick={onClose} disabled={busy}>Renunță</button>
          <button style={{ ...s.btnPrimary, opacity: file ? 1 : 0.55 }} onClick={go} disabled={!file || busy}>
            {busy ? 'Se înlocuiește...' : '🔁 Înlocuiește fișierul'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Panoul „Ordinea de afișare" ──────────────────────────────────────────────
const QUICK_SORTS = [
  { key: 'new',  label: '📅 Cele mai noi primele',   by: 'created_at', dir: 'desc' },
  { key: 'old',  label: '📅 Cele mai vechi primele', by: 'created_at', dir: 'asc' },
  { key: 'az',   label: '🔤 A → Z',                  by: 'title',      dir: 'asc' },
  { key: 'za',   label: '🔤 Z → A',                  by: 'title',      dir: 'desc' },
];
const collator = typeof Intl !== 'undefined' ? new Intl.Collator('ro', { numeric: true, sensitivity: 'base' }) : null;
function sortLocally(list, { by, dir }) {
  const sign = dir === 'asc' ? 1 : -1;
  return [...list].sort((a, b) => {
    const d = by === 'title'
      ? (collator ? collator.compare(a.title || '', b.title || '') : String(a.title || '').localeCompare(String(b.title || '')))
      : (Date.parse(a.created_at || 0) || 0) - (Date.parse(b.created_at || 0) || 0);
    return sign * d || siteOrder(a, b);
  });
}

// Materialele „noi" care apar acum PRIMELE: în rubricile cu o ordine stabilită
// (cel puțin o poziție > 0), cele rămase pe poziția 0 — adăugate după ultima
// ordonare (oglinda lui planMoveNewToEnd de pe server).
function newAtTop(list) {
  const groups = new Map();
  for (const it of list || []) {
    const k = rubricKey(it);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(it);
  }
  let n = 0;
  for (const g of groups.values()) {
    const pos = (x) => (x.sort_order == null ? 0 : Number(x.sort_order));
    if (g.some((x) => pos(x) > 0)) n += g.filter((x) => pos(x) <= 0).length;
  }
  return n;
}
const NP_LABEL = { start: '⤒ primele', end: '⤓ ultimele' };
const NP_EMPTY = { site: 'start', categories: {}, rubrics: {} };

export function ReorderPanel({ s, items, initialScope, onSaved, onReload }) {
  const [scope, setScope] = useState(() => ({
    category: initialScope?.category || CATEGORIES[0].value,
    type: initialScope?.type || 'pdf',
    subcategory: '', profile: '',
  }));
  const subs = subcategoriesFor(scope.category);
  const needSub = subs.length > 0;
  const needProf = needsProfile(scope.category, scope.subcategory);
  const scopeReady = !needSub || (!!scope.subcategory && (!needProf || !!scope.profile));

  // Lista rubricii, exact în ordinea de pe site.
  const groupItems = useMemo(
    () => (scopeReady ? items.filter(i => matchesGroup(i, scope)).sort(siteOrder) : []),
    [items, scope, scopeReady],
  );
  const [list, setList] = useState(groupItems);
  const [dirty, setDirty] = useState(false);
  const [dragId, setDragId] = useState(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const [globalScope, setGlobalScope] = useState('site');
  const [lastSort, setLastSort] = useState(null);      // ultima sortare rapidă aplicată listei rubricii

  // „📥 Materialele noi apar": setarea (site / categorie / rubrică), citită de pe server
  const [np, setNp] = useState(null);                  // null = se încarcă
  const [npSetup, setNpSetup] = useState(true);
  const [npErr, setNpErr] = useState(null);
  const [npMsg, setNpMsg] = useState(null);
  const [npBusy, setNpBusy] = useState(false);

  useEffect(() => { setList(groupItems); setDirty(false); setDragId(null); }, [groupItems]);
  useEffect(() => {
    let alive = true;
    apiPost('/api/content-admin', { action: 'settings' })
      .then((r) => { if (alive) { setNp(r.newPosition || NP_EMPTY); setNpSetup(r.setup !== false); } })
      .catch((e) => { if (alive) { setNp(NP_EMPTY); setNpErr(e.message); } });
    return () => { alive = false; };
  }, []);

  function changeScope(patch) {
    if (dirty && !window.confirm('Ai modificări nesalvate în ordinea curentă. Le abandonezi?')) return;
    setScope(p => ({ ...p, ...patch }));
    setMsg(null); setNpMsg(null); setLastSort(null);
  }

  function move(from, to) {
    if (from === to || from < 0 || to < 0 || from >= list.length || to >= list.length) return;
    setList(prev => {
      const next = [...prev];
      const [it] = next.splice(from, 1);
      next.splice(to, 0, it);
      return next;
    });
    setDirty(true);
    setLastSort(null);
  }
  const idx = (id) => list.findIndex(i => i.id === id);

  // Drag-and-drop nativ (HTML5): la trecerea peste un rând, rândul tras își ia
  // locul lui — reordonare „live". Pe ecrane tactile rămân săgețile ▲ ▼.
  function onDragStart(e, id) {
    setDragId(id);
    e.dataTransfer.effectAllowed = 'move';
    try { e.dataTransfer.setData('text/plain', id); } catch { /* Safari vechi */ }
  }
  function onDragOver(e, overId) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (!dragId || dragId === overId) return;
    const from = idx(dragId), to = idx(overId);
    if (from !== -1 && to !== -1 && from !== to) move(from, to);
  }

  // ── unde apar materialele noi ──
  const cfg = np || NP_EMPTY;
  const rubricScope = { category: scope.category, subcategory: needSub ? scope.subcategory : '', profile: needProf ? scope.profile : '', type: scope.type };
  const rubricInfo = newPositionInfo(cfg, rubricScope);
  const rubricOwn = cfg.rubrics?.[rubricKey(rubricScope)] || null;
  const inheritedForRubric = cfg.categories?.[scope.category]
    ? { value: cfg.categories[scope.category], where: `la ${categoryLabel(scope.category)}` }
    : { value: cfg.site === 'end' ? 'end' : 'start', where: 'pe tot site-ul' };
  const catOwn = cfg.categories?.[scope.category] || null;
  const siteVal = cfg.site === 'end' ? 'end' : 'start';
  const npDisabled = npBusy || busy || !np || !npSetup;

  // Câte materiale „noi" (poziția 0, după o ordonare) apar acum primele într-un scope
  const newTopIn = (where) => newAtTop(
    where === 'rubric' ? groupItems
      : where === 'category' ? items.filter(i => i.category === scope.category)
        : items,
  );

  async function setNewPos(level, value) {
    setNpBusy(true); setNpMsg(null);
    try {
      const body = { action: 'set_new_position', scope: level, value };
      if (level === 'category') body.category = scope.category;
      if (level === 'rubric') body.rubric = rubricScope;
      const r = await apiPost('/api/content-admin', body);
      const next = r.newPosition || NP_EMPTY;
      setNp(next);
      const where = level === 'site' ? 'pe tot site-ul' : level === 'category' ? `la ${categoryLabel(scope.category)}` : `în rubrica „${rubricLabel}"`;
      const eff = level === 'rubric' ? newPositionInfo(next, rubricScope).value
        : level === 'category' ? (next.categories?.[scope.category] || (next.site === 'end' ? 'end' : 'start'))
          : (next.site === 'end' ? 'end' : 'start');
      const pending = eff === 'end' ? newTopIn(level) : 0;
      setNpMsg({
        type: 'success', at: level === 'rubric' ? 'rubric' : 'auto',
        text: `✓ Salvat: ${where}, materialele noi apar ${eff === 'end' ? 'la SFÂRȘIT (după ultimul material din rubrica lor)' : 'PRIMELE'}.`
          + (pending ? ` Atenție: ${pending} ${pending === 1 ? 'material adăugat' : 'materiale adăugate'} după ultima ordonare ${pending === 1 ? 'apare' : 'apar'} încă primele.` : ''),
        moveLevel: pending ? level : null,
      });
    } catch (e) { setNpMsg({ type: 'error', at: level === 'rubric' ? 'rubric' : 'auto', text: e.message }); }
    finally { setNpBusy(false); }
  }

  async function moveNewToEnd(level) {
    if (dirty && !window.confirm('Ai modificări nesalvate în ordinea rubricii. Le abandonezi?')) return;
    setNpBusy(true); setNpMsg(null);
    try {
      const body = { action: 'move_new_to_end' };
      if (level === 'category') body.category = scope.category;
      if (level === 'rubric') body.rubric = rubricScope;
      const r = await apiPost('/api/content-admin', body);
      if (r.positions && Object.keys(r.positions).length) onSaved?.(r.positions);
      setNpMsg({ type: 'success', at: level === 'rubric' ? 'rubric' : 'auto', text: r.moved ? `✓ ${r.moved} ${r.moved === 1 ? 'material nou a fost mutat' : 'materiale noi au fost mutate'} la sfârșit (${r.rubrics} ${r.rubrics === 1 ? 'rubrică' : 'rubrici'}). Apare imediat pe site.` : '✓ Nimic de mutat — niciun material nou nu apare primul.' });
    } catch (e) { setNpMsg({ type: 'error', at: level === 'rubric' ? 'rubric' : 'auto', text: e.message }); }
    finally { setNpBusy(false); }
  }

  async function save() {
    if (!list.length) return;
    setBusy(true); setMsg(null);
    try {
      const ids = list.map(i => i.id);
      const r = await apiPost('/api/content-admin', { action: 'reorder', ids });
      const orderMap = {};
      ids.forEach((id, i) => { orderMap[id] = i + 1; });
      onSaved?.(orderMap);
      setDirty(false);
      // „Cele mai vechi primele" salvat, dar materialele noi apar încă primele → propunem „⤓ ultimele"
      const suggest = lastSort === 'old' && rubricInfo.value !== 'end' && npSetup;
      setMsg({
        type: 'success',
        text: `✓ Ordinea a fost salvată (${r.total} materiale, ${r.updated} actualizate). Apare imediat pe site.`
          + (suggest ? ' Materialele adăugate de acum înainte în această rubrică vor apărea totuși PRIMELE.' : ''),
        np: suggest ? 'rubric' : null,
      });
    } catch (e) { setMsg({ type: 'error', text: e.message }); }
    finally { setBusy(false); }
  }

  async function sortAll(q) {
    const cat = globalScope === 'category' ? scope.category : null;
    const n = cat ? items.filter(i => i.category === cat).length : items.length;
    const where = cat ? `categoria „${categoryLabel(cat)}"` : 'TOT site-ul (toate categoriile)';
    if (!window.confirm(`Renumerotezi ${where} — ${n} materiale — cu „${q.label}"?\n\nOrdinea manuală stabilită până acum în aceste rubrici se pierde.`)) return;
    setBusy(true); setMsg(null);
    try {
      const r = await apiPost('/api/content-admin', { action: 'sort_all', by: q.by, dir: q.dir, category: cat });
      const eff = cat ? (cfg.categories?.[cat] || siteVal) : siteVal;
      const suggest = q.key === 'old' && eff !== 'end' && npSetup;
      setMsg({
        type: 'success',
        text: `✓ ${where.charAt(0).toUpperCase() + where.slice(1)}: ${r.updated} materiale renumerotate din ${r.total}.`
          + (suggest ? ' Materialele adăugate de acum înainte (de tine sau de agent) vor apărea totuși PRIMELE.' : ''),
        np: suggest ? (cat ? 'category' : 'site') : null,
      });
      setDirty(false);
      onReload?.();
    } catch (e) { setMsg({ type: 'error', text: e.message }); }
    finally { setBusy(false); }
  }

  const rubricLabel = [
    categoryLabel(scope.category),
    needSub && scope.subcategory ? subcategoryLabel(scope.category, scope.subcategory) : null,
    needProf && scope.profile ? profileLabel(scope.profile) : null,
    scope.type === 'pdf' ? 'PDF' : scope.type === 'interactive' ? 'Interactiv' : 'Manual',
  ].filter(Boolean).join(' › ');
  // Rubrica aleasă chiar afișează tipul ales? (ex. EN › Variante arată doar PDF)
  const visibleTypes = scopeReady ? visibleTypesFor(scope.category, scope.subcategory) : [];
  const typeHidden = scopeReady && !visibleTypes.includes(scope.type);

  const smallBtn = (extra = {}) => ({
    ...s.btnSecondary, padding: '6px 12px', fontSize: '0.8rem', ...extra,
  });
  // buton de comutator (segment): activ = albastru închis
  const segBtn = (active, extra = {}) => ({
    ...s.btnSecondary, padding: '5px 11px', fontSize: '0.78rem',
    background: active ? 'var(--navy)' : '#fff', color: active ? '#fff' : 'var(--navy)',
    borderColor: active ? 'var(--navy)' : '#dde1e8', opacity: npDisabled && !active ? 0.6 : 1, ...extra,
  });
  const npNote = !npSetup
    ? <div style={{ fontSize: '0.76rem', color: '#e65100', marginTop: 6 }}>⚠️ Ca să poți alege, rulează o dată <code>supabase/setari_ordine_gratuite.sql</code> în Supabase → SQL Editor. Până atunci, materialele noi apar primele.</div>
    : npErr ? <div style={{ fontSize: '0.76rem', color: '#c62828', marginTop: 6 }}>⚠️ Setarea nu s-a putut citi: {npErr}</div> : null;
  const npAlert = npMsg && (
    <div style={{ ...s.alert(npMsg.type === 'error' ? 'error' : 'success'), display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginTop: 10, marginBottom: 0 }}>
      <span style={{ flex: 1, minWidth: 220 }}>{npMsg.text}</span>
      {npMsg.moveLevel && (
        <button style={smallBtn({ padding: '5px 12px' })} disabled={npBusy} onClick={() => moveNewToEnd(npMsg.moveLevel)}>⤓ Mută-le acum la sfârșit</button>
      )}
    </div>
  );

  return (
    <div>
      <div style={s.infoBox}>
        <strong>Cum funcționează:</strong> pe site, materialele unei rubrici apar în ordinea numărului de poziție (mic = sus); la egalitate,
        cel mai nou primul. Materialele nou încărcate (de tine sau generate de agentul Claude) primesc poziția 0, deci apar <strong>primele</strong> —
        sau <strong>la sfârșitul rubricii</strong>, dacă la „📥 Materialele noi apar" alegi „⤓ ultimele".
        Alege rubrica exact ca pe site, trage rândurile cu mouse-ul (⠿) sau folosește săgețile, apoi apasă <strong>Salvează ordinea</strong>.
      </div>

      {msg && (
        <div style={{ ...s.alert(msg.type), display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <span style={{ flex: 1, minWidth: 220 }}>{msg.text}</span>
          {msg.np && (
            <button style={smallBtn({ padding: '5px 12px' })} disabled={npDisabled}
              onClick={() => { const lvl = msg.np; setMsg(m => (m ? { ...m, np: null } : m)); setNewPos(lvl, 'end'); }}>
              ⤓ Și materialele noi la sfârșit
            </button>
          )}
        </div>
      )}

      {/* ── Sortare automată (se aplică imediat în baza de date) ── */}
      <div style={{ background: '#f7f9fc', border: '1px solid #e6eaf0', borderRadius: 10, padding: '14px 16px', marginBottom: 20 }}>
        <div style={{ fontWeight: 700, color: 'var(--navy)', fontSize: '0.9rem', marginBottom: 8 }}>⚡ Sortare automată — se aplică imediat</div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <span style={{ fontSize: '0.82rem', color: '#5a6170' }}>Pentru</span>
          <select style={{ ...s.select, width: 'auto', padding: '6px 10px', fontSize: '0.82rem' }} value={globalScope} onChange={e => { setGlobalScope(e.target.value); setNpMsg(null); }} disabled={busy}>
            <option value="site">tot site-ul</option>
            <option value="category">doar {categoryLabel(scope.category)}</option>
          </select>
          <span style={{ fontSize: '0.82rem', color: '#5a6170' }}>pune:</span>
          {QUICK_SORTS.map(q => (
            <button key={q.key} style={smallBtn()} disabled={busy} onClick={() => sortAll(q)}>{q.label}</button>
          ))}
        </div>
        <div style={{ fontSize: '0.76rem', color: '#8e95a3', marginTop: 8 }}>
          Renumerotează fiecare categorie (crescător/descrescător după data adăugării sau alfabetic). Înlocuiește vechile scripturi <code>reset_sort_order*.sql</code>.
        </div>

        {/* ── Unde apar materialele noi (site / categorie) ── */}
        <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px dashed #dde3ea' }}>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <span style={{ fontWeight: 700, color: 'var(--navy)', fontSize: '0.86rem' }}>📥 Materialele noi apar</span>
            <span style={{ fontSize: '0.82rem', color: '#5a6170' }}>{globalScope === 'site' ? 'pe tot site-ul:' : `la ${categoryLabel(scope.category)}:`}</span>
            {globalScope === 'category' && (
              <button style={segBtn(!catOwn)} disabled={npDisabled} onClick={() => setNewPos('category', null)}
                title="Fără excepție pentru categorie — se aplică alegerea pentru tot site-ul">ca pe tot site-ul ({NP_LABEL[siteVal]})</button>
            )}
            {['start', 'end'].map(v => {
              const active = globalScope === 'site' ? siteVal === v : catOwn === v;
              return (
                <button key={v} style={segBtn(active)} disabled={npDisabled}
                  onClick={() => setNewPos(globalScope === 'site' ? 'site' : 'category', v)}>{NP_LABEL[v]}</button>
              );
            })}
          </div>
          <div style={{ fontSize: '0.76rem', color: '#8e95a3', marginTop: 6, lineHeight: 1.5 }}>
            Pentru orice material nou: încărcat din „Adaugă PDF / Interactiv" sau generat de agentul Claude. „⤓ ultimele" = după ultimul material
            din rubrica lui — potrivit cu „📅 Cele mai vechi primele". O rubrică anume poate avea propria alegere (mai jos, la mutarea manuală).
          </div>
          {npNote}
          {npMsg && npMsg.at !== 'rubric' && npAlert}
        </div>
      </div>

      {/* ── Mutare manuală într-o rubrică ── */}
      <div style={{ fontWeight: 700, color: 'var(--navy)', fontSize: '0.9rem', marginBottom: 8 }}>✋ Mutare manuală — alege rubrica</div>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 14 }}>
        <select style={{ ...s.select, width: 200 }} value={scope.category} disabled={busy}
          onChange={e => changeScope({ category: e.target.value, subcategory: '', profile: '' })}>
          {CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
        </select>
        {needSub && (
          <select style={{ ...s.select, width: 280 }} value={scope.subcategory} disabled={busy}
            onChange={e => changeScope({ subcategory: e.target.value, profile: needsProfile(scope.category, e.target.value) ? scope.profile : '' })}>
            <option value="">— Subcategorie —</option>
            {subs.map(x => <option key={x.value} value={x.value}>{x.label}</option>)}
          </select>
        )}
        {needProf && (
          <select style={{ ...s.select, width: 180 }} value={scope.profile} disabled={busy}
            onChange={e => changeScope({ profile: e.target.value })}>
            <option value="">— Profil —</option>
            {BAC_PROFILES.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
          </select>
        )}
        <select style={{ ...s.select, width: 200 }} value={scope.type} disabled={busy}
          onChange={e => changeScope({ type: e.target.value })}>
          {CONTENT_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
        </select>
      </div>

      {!scopeReady ? (
        <div style={{ textAlign: 'center', padding: 30, color: '#8e95a3', fontSize: '0.88rem' }}>
          Alege {needSub && !scope.subcategory ? 'subcategoria' : 'profilul'} ca să vezi lista exact cum apare pe site.
        </div>
      ) : (
        <>
          {/* ── Unde apar materialele noi în această rubrică ── */}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 10, padding: '8px 12px', background: '#fffdf5', border: '1px solid #f3e6b5', borderRadius: 8 }}>
            <span style={{ fontSize: '0.82rem', color: '#5a6170' }}>📥 În rubrica <strong>{rubricLabel}</strong>, materialele noi apar:</span>
            <button style={segBtn(!rubricOwn)} disabled={npDisabled} onClick={() => setNewPos('rubric', null)}
              title="Fără excepție pentru rubrică — se aplică alegerea de deasupra">ca {inheritedForRubric.where} ({NP_LABEL[inheritedForRubric.value]})</button>
            {['start', 'end'].map(v => (
              <button key={v} style={segBtn(rubricOwn === v)} disabled={npDisabled} onClick={() => setNewPos('rubric', v)}>{NP_LABEL[v]}</button>
            ))}
            {rubricInfo.value === 'end' && newAtTop(groupItems) > 0 && npMsg?.moveLevel !== 'rubric' && (
              <button style={smallBtn({ padding: '5px 11px', fontSize: '0.78rem' })} disabled={npDisabled}
                title="Materialele adăugate după ultima ordonare (poziția 0) apar acum primele"
                onClick={() => moveNewToEnd('rubric')}>⤓ Mută la sfârșit {newAtTop(groupItems) === 1 ? 'materialul nou' : `cele ${newAtTop(groupItems)} materiale noi`}</button>
            )}
            {!npSetup && <span style={{ fontSize: '0.76rem', color: '#e65100' }}>(rulează întâi <code>setari_ordine_gratuite.sql</code>)</span>}
          </div>
          {npMsg && npMsg.at === 'rubric' && <div style={{ marginTop: -4, marginBottom: 10 }}>{npAlert}</div>}

          {list.length === 0 ? (
            <div style={{ textAlign: 'center', padding: 30, color: '#8e95a3', fontSize: '0.88rem' }}>
              Niciun material în rubrica <strong>{rubricLabel}</strong>.
            </div>
          ) : (
            <>
              {typeHidden && (
                <div style={{ ...s.alert('error'), background: '#fff3e0', color: '#e65100' }}>
                  ⚠️ Pe site, această rubrică afișează doar {visibleTypes.map(t => (t === 'pdf' ? 'PDF' : 'interactiv')).join(' și ') || 'nimic'} —
                  materialele de mai jos ({scope.type}) NU sunt vizibile acolo. Schimbă-le tipul/rubrica din „📋 Lista → Editează".
                </div>
              )}
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 10 }}>
                <span style={{ fontSize: '0.82rem', color: '#5a6170' }}>
                  <strong>{rubricLabel}</strong> · {list.length} materiale · aranjează lista:
                </span>
                {QUICK_SORTS.map(q => (
                  <button key={q.key} style={smallBtn({ padding: '4px 10px', fontSize: '0.76rem' })} disabled={busy}
                    onClick={() => { setList(l => sortLocally(l, q)); setDirty(true); setLastSort(q.key); }}>{q.label}</button>
                ))}
              </div>

              <div>
                {list.map((item, i) => {
                  const dragging = dragId === item.id;
                  return (
                    <div key={item.id} draggable={!busy}
                      onDragStart={e => onDragStart(e, item.id)}
                      onDragOver={e => onDragOver(e, item.id)}
                      onDrop={e => e.preventDefault()}
                      onDragEnd={() => setDragId(null)}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', marginBottom: 6,
                        border: `1.5px solid ${dragging ? 'var(--gold)' : '#eef0f4'}`, borderRadius: 8,
                        background: dragging ? '#fff8e1' : '#fff', opacity: dragging ? 0.75 : 1,
                        cursor: busy ? 'default' : 'grab', userSelect: 'none',
                      }}>
                      <span title="Trage pentru a muta" style={{ color: '#b0b7c3', fontSize: '1.15rem', lineHeight: 1 }}>⠿</span>
                      <span style={{ width: 30, textAlign: 'right', fontWeight: 800, color: 'var(--navy)', fontSize: '0.82rem' }}>{i + 1}.</span>
                      <span style={s.badge(item.content_type)}>{item.content_type}</span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 600, color: 'var(--navy)', fontSize: '0.88rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.title}</div>
                        <div style={{ fontSize: '0.74rem', color: '#8e95a3' }}>
                          {dateRo(item.created_at)} · {item.is_free ? 'Gratuit' : 'Premium'} · poziție salvată: {item.sort_order == null ? 0 : item.sort_order}
                        </div>
                      </div>
                      <button title="Mută sus" style={smallBtn({ padding: '4px 9px' })} disabled={busy || i === 0} onClick={() => move(i, i - 1)}>▲</button>
                      <button title="Mută jos" style={smallBtn({ padding: '4px 9px' })} disabled={busy || i === list.length - 1} onClick={() => move(i, i + 1)}>▼</button>
                      <button title="Mută primul" style={smallBtn({ padding: '4px 9px' })} disabled={busy || i === 0} onClick={() => move(i, 0)}>⤒</button>
                      <button title="Mută ultimul" style={smallBtn({ padding: '4px 9px' })} disabled={busy || i === list.length - 1} onClick={() => move(i, list.length - 1)}>⤓</button>
                    </div>
                  );
                })}
              </div>

              <div style={{
                position: 'sticky', bottom: 12, marginTop: 12, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap',
                background: dirty ? '#fff8e1' : '#f7f9fc', border: `1px solid ${dirty ? '#ffe082' : '#e6eaf0'}`, borderRadius: 8, padding: '10px 14px',
              }}>
                <span style={{ fontSize: '0.84rem', color: dirty ? '#8a6d00' : '#5a6170', flex: 1 }}>
                  {dirty ? '● Ordinea a fost modificată, dar nu e salvată încă.' : 'Ordinea afișată e cea salvată (cum apare pe site).'}
                </span>
                <button style={s.btnSecondary} disabled={busy || !dirty} onClick={() => { setList(groupItems); setDirty(false); setMsg(null); setLastSort(null); }}>↶ Renunță</button>
                <button style={s.btnPrimary} disabled={busy || !dirty} onClick={save}>{busy ? 'Se salvează...' : '💾 Salvează ordinea'}</button>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
