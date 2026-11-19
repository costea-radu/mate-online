// =====================================================================
// src/components/AdminVarianteAI.jsx — Admin → „✨ Variante AI (EN)" (19 nov. 2026)
//
// Cererea: „La categoria Evaluare Națională, la teste de antrenament, adaugă sub simulări
// o secțiune «variante generate cu AI». În admin adaugă secțiunea de încărcare."
//
// Pagina Evaluare Națională → „🏋 Teste de Antrenament" → „🤖 Variante generate cu AI"
// (sub „Simulări") arată materialele PDF din rubrica `variante-ai`. Aici:
//   • încărcarea: titlul, accesul, PDF-ul variantei și — opțional — PDF-ul baremului ei,
//     care se salvează în rubrica „Bareme" și se leagă singur de variantă (api/bareme.js →
//     incarca_barem), ca „📋 Barem" și corectarea să-l folosească;
//   • lista variantelor, cu baremul fiecăreia (api/bareme.js → legaturi) și „⬆ Baremul"
//     pentru cele fără barem. Modificarea / ștergerea: „📋 Tot Conținutul".
// =====================================================================
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiPost } from '../lib/api';
import { supabase } from '../lib/supabase';
import { safeFileName, siteOrder } from '../lib/contentMeta';
import FileUploadZone from './FileUploadZone';
import { incarcaBaremPdf } from './AdminBareme';

const EN = 'evaluare-nationala';
const RUBRICA = 'variante-ai';
const GOL = { title: '', description: '', is_free: false };
const ePdf = (f) => !!f && (/\.pdf$/i.test(f.name) || f.type === 'application/pdf');

export default function AdminVarianteAI({ s, onSuccess }) {
  const [form, setForm] = useState(GOL);
  const [file, setFile] = useState(null);
  const [barem, setBarem] = useState(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const [lista, setLista] = useState(null);       // variantele existente
  const [bareme, setBareme] = useState({});       // variantă → baremul ei (sau null)
  const [lucru, setLucru] = useState(null);       // id-ul variantei la care se încarcă baremul
  const alegeBarem = useRef(null);
  const tinta = useRef(null);

  const load = useCallback(async () => {
    const { data } = await supabase.from('content').select('id, title, category, subcategory, content_type, is_free, file_url, sort_order, created_at')
      .eq('category', EN).eq('subcategory', RUBRICA).eq('content_type', 'pdf');
    const rows = (data || []).slice().sort(siteOrder);
    setLista(rows);
    if (rows.length) {
      try {
        const r = await apiPost('/api/bareme', { action: 'legaturi', materialIds: rows.map((x) => x.id) });
        setBareme(r.materiale || {});
      } catch { setBareme({}); }
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  async function trimite() {
    if (!form.title.trim()) { setMsg({ type: 'error', text: 'Scrie titlul variantei.' }); return; }
    if (!ePdf(file)) { setMsg({ type: 'error', text: 'Alege PDF-ul variantei.' }); return; }
    if (barem && !ePdf(barem)) { setMsg({ type: 'error', text: 'Baremul se încarcă ca PDF.' }); return; }
    setBusy(true);
    setMsg(null);
    try {
      const bucket = form.is_free ? 'content-files-free' : 'content-files';
      const path = `pdf/${EN}/${Date.now()}_${safeFileName(file.name) || 'varianta.pdf'}`;
      const { error: upErr } = await supabase.storage.from(bucket).upload(path, file, { contentType: 'application/pdf' });
      if (upErr) throw new Error(`Încărcarea variantei a eșuat: ${upErr.message}`);
      const { data: u } = supabase.storage.from(bucket).getPublicUrl(path);
      const { data: nou, error: dbErr } = await supabase.from('content').insert({
        title: form.title.trim(), description: form.description.trim() || null,
        category: EN, subcategory: RUBRICA, profile: null, content_type: 'pdf',
        is_free: form.is_free, file_url: u?.publicUrl || path, sort_order: 0,
      }).select('id, title').single();
      if (dbErr) throw dbErr;
      let txt = `✨ „${nou.title}" a apărut la Evaluare Națională → Teste de antrenament → Variante generate cu AI.`;
      if (barem) {
        try {
          await incarcaBaremPdf({ file: barem, category: EN, materialId: nou.id, title: `Barem — ${nou.title}`, isFree: form.is_free });
          txt += ' Baremul ei e încărcat și legat.';
        } catch (e) { txt += ` Baremul NU s-a încărcat (${e.message}) — îl poți adăuga din lista de mai jos.`; }
      }
      setMsg({ type: 'success', text: txt });
      setForm(GOL);
      setFile(null);
      setBarem(null);
      onSuccess?.();
      load();
    } catch (e) {
      setMsg({ type: 'error', text: e.message });
    } finally {
      setBusy(false);
    }
  }

  function cereBarem(v) {
    tinta.current = v;
    if (alegeBarem.current) { alegeBarem.current.value = ''; alegeBarem.current.click(); }
  }
  async function baremPentru(f) {
    const v = tinta.current;
    if (!v || !f) return;
    if (!ePdf(f)) { setMsg({ type: 'error', text: 'Baremul se încarcă ca PDF.' }); return; }
    setLucru(v.id);
    try {
      await incarcaBaremPdf({ file: f, category: EN, materialId: v.id, title: `Barem — ${v.title}`, isFree: !!v.is_free });
      setMsg({ type: 'success', text: `📋 Baremul pentru „${v.title}" e încărcat și legat.` });
      onSuccess?.();
      load();
    } catch (e) { setMsg({ type: 'error', text: e.message }); }
    finally { setLucru(null); }
  }

  const btn = { padding: '6px 12px', borderRadius: 8, fontSize: '.8rem', fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap', border: '1.5px solid var(--border, #dde1e8)', background: '#fff', color: 'var(--navy)', textDecoration: 'none' };
  return (
    <>
      <div style={s.card}>
        <div style={s.cardTitle}>✨ Variante generate cu AI — Evaluarea Națională</div>
        <div style={s.infoBox}>
          Apar pe pagina <strong>Evaluare Națională → 🏋 Teste de Antrenament → 🤖 Variante generate cu AI</strong> (sub „Simulări").
          Încarcă și <strong>baremul</strong> variantei: se leagă singur de ea, ca elevul să-l deschidă cu „📋 Barem" și ca profesorul
          virtual să corecteze după el. Le modifici sau le ștergi din <strong>📋 Tot Conținutul</strong>.
        </div>
        {msg && <div style={s.alert(msg.type)} role="status">{msg.text}</div>}
        <div style={s.formRow}>
          <div style={s.formGroup}>
            <label style={s.label}>Titlu *</label>
            <input style={s.input} value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
              placeholder="ex. Varianta AI 1 — Evaluare Națională 2027" />
          </div>
          <div style={s.formGroup}>
            <label style={s.label}>Acces</label>
            <select style={s.select} value={form.is_free ? 'free' : 'premium'} onChange={(e) => setForm((f) => ({ ...f, is_free: e.target.value === 'free' }))}>
              <option value="free">🟢 Gratuit</option>
              <option value="premium">⭐ Premium</option>
            </select>
          </div>
        </div>
        <div style={s.formGroup}>
          <label style={s.label}>Descriere</label>
          <input style={s.input} value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
            placeholder="Scurtă descriere opțională (ex. după modelul oficial 2027)" />
        </div>
        <div style={s.formRow}>
          <div style={s.formGroup}>
            <label style={s.label}>Varianta (PDF) *</label>
            <FileUploadZone s={s} accept=".pdf" icon="✨" label="Trage PDF-ul variantei aici" hint="subiectele variantei" file={file} onFile={setFile} />
          </div>
          <div style={s.formGroup}>
            <label style={s.label}>Baremul variantei (PDF, opțional)</label>
            <FileUploadZone s={s} accept=".pdf" icon="✅" label="Trage PDF-ul baremului aici" hint="se leagă singur de variantă" file={barem} onFile={setBarem} />
          </div>
        </div>
        <button style={s.btnPrimary} onClick={trimite} disabled={busy}>
          {busy ? 'Se încarcă...' : '⬆ Încarcă varianta'}
        </button>
      </div>

      <div style={s.card}>
        <div style={s.cardTitle}>🤖 Variantele de pe site ({lista ? lista.length : '…'})</div>
        <input ref={alegeBarem} type="file" accept=".pdf,application/pdf" style={{ display: 'none' }} onChange={(e) => baremPentru(e.target.files && e.target.files[0])} />
        {lista === null ? (
          <div style={{ color: '#8e95a3', fontSize: '.86rem' }}>Se încarcă…</div>
        ) : !lista.length ? (
          <div style={{ color: '#8e95a3', fontSize: '.86rem' }}>Încă nicio variantă generată cu AI. Prima pe care o încarci apare pe pagina Evaluării Naționale.</div>
        ) : (
          <div style={{ display: 'grid', gap: 8 }}>
            {lista.map((v) => {
              const b = bareme[v.id];
              return (
                <div key={v.id} style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', padding: '10px 12px', border: '1.5px solid #eef0f4', borderRadius: 10 }}>
                  <div style={{ flex: '1 1 260px', minWidth: 0 }}>
                    <div style={{ fontWeight: 700, color: 'var(--navy)', fontSize: '.88rem' }}>
                      {v.title}
                      <span style={{ marginLeft: 8, padding: '1px 8px', borderRadius: 20, fontSize: '.68rem', fontWeight: 800, background: v.is_free ? '#e8f5e9' : '#fff3e0', color: v.is_free ? '#2e7d32' : '#e65100' }}>{v.is_free ? 'Gratuit' : 'Premium'}</span>
                    </div>
                    <div style={{ fontSize: '.76rem', color: b ? '#2e7d32' : '#b45309', marginTop: 2 }}>
                      {b ? `📋 ${b.title}` : '— fără barem'}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    <Link to={`/pdf-viewer?id=${v.id}`} style={btn}>📄 Deschide</Link>
                    {!b && (
                      <button type="button" style={{ ...btn, background: 'var(--gold)', borderColor: 'var(--gold)' }} disabled={lucru === v.id} onClick={() => cereBarem(v)}>
                        {lucru === v.id ? '⏳ Se încarcă…' : '⬆ Baremul'}
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}
