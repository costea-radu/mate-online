// =====================================================================
// src/components/ContentAdminTools.jsx — Admin → „Tot Conținutul"
//   • ContentMetaFields — titlu / categorie / subcategorie / profil (folosit
//     la Adaugă PDF, Adaugă Interactiv și la editare);
//   • EditContentModal  — „✏️ Editează": titlu, descriere, categorie, rubrică,
//     tip, acces (gratuit/premium, cu mutarea fișierului între bucket-uri
//     pe server), ordine;
//   • ReorderPanel      — „↕ Ordinea de afișare": alegi rubrica exact ca pe
//     site, muți materialele cu drag-and-drop sau cu săgeți, sortări rapide,
//     apoi salvezi; plus sortarea automată a întregului site / unei categorii.
// Scrierile merg prin /api/content-admin (service role + verificare admin).
// Stilurile (`s`) vin din Admin.jsx, ca la ReviewsAdmin / AdminRezolvari.
// =====================================================================
import { useEffect, useMemo, useState } from 'react';
import { apiPost } from '../lib/api';
import {
  CATEGORIES, BAC_PROFILES, CONTENT_TYPES,
  categoryLabel, subcategoryLabel, profileLabel, subcategoriesFor, needsProfile,
  allowedContentTypes, storageInfo, siteOrder, matchesGroup, visibilityWarning, visibleTypesFor,
} from '../lib/contentMeta';

const dateRo = (d) => { try { return new Date(d).toLocaleDateString('ro-RO'); } catch { return ''; } };

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
export function EditContentModal({ s, item, onClose, onSaved }) {
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
            📎 <strong>{file.name}</strong>{file.bucket ? <> · bucket <code>{file.bucket}</code></> : null} · adăugat {dateRo(item.created_at)}
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

  useEffect(() => { setList(groupItems); setDirty(false); setDragId(null); }, [groupItems]);

  function changeScope(patch) {
    if (dirty && !window.confirm('Ai modificări nesalvate în ordinea curentă. Le abandonezi?')) return;
    setScope(p => ({ ...p, ...patch }));
    setMsg(null);
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
      setMsg({ type: 'success', text: `✓ Ordinea a fost salvată (${r.total} materiale, ${r.updated} actualizate). Apare imediat pe site.` });
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
      setMsg({ type: 'success', text: `✓ ${where.charAt(0).toUpperCase() + where.slice(1)}: ${r.updated} materiale renumerotate din ${r.total}.` });
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

  return (
    <div>
      <div style={s.infoBox}>
        <strong>Cum funcționează:</strong> pe site, materialele unei rubrici apar în ordinea numărului de poziție (mic = sus); la egalitate,
        cel mai nou primul. Materialele nou încărcate primesc poziția 0, deci apar primele până le muți de aici.
        Alege rubrica exact ca pe site, trage rândurile cu mouse-ul (⠿) sau folosește săgețile, apoi apasă <strong>Salvează ordinea</strong>.
      </div>

      {msg && <div style={s.alert(msg.type)}>{msg.text}</div>}

      {/* ── Sortare automată (se aplică imediat în baza de date) ── */}
      <div style={{ background: '#f7f9fc', border: '1px solid #e6eaf0', borderRadius: 10, padding: '14px 16px', marginBottom: 20 }}>
        <div style={{ fontWeight: 700, color: 'var(--navy)', fontSize: '0.9rem', marginBottom: 8 }}>⚡ Sortare automată — se aplică imediat</div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <span style={{ fontSize: '0.82rem', color: '#5a6170' }}>Pentru</span>
          <select style={{ ...s.select, width: 'auto', padding: '6px 10px', fontSize: '0.82rem' }} value={globalScope} onChange={e => setGlobalScope(e.target.value)} disabled={busy}>
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
      ) : list.length === 0 ? (
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
                onClick={() => { setList(l => sortLocally(l, q)); setDirty(true); }}>{q.label}</button>
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
            <button style={s.btnSecondary} disabled={busy || !dirty} onClick={() => { setList(groupItems); setDirty(false); setMsg(null); }}>↶ Renunță</button>
            <button style={s.btnPrimary} disabled={busy || !dirty} onClick={save}>{busy ? 'Se salvează...' : '💾 Salvează ordinea'}</button>
          </div>
        </>
      )}
    </div>
  );
}
