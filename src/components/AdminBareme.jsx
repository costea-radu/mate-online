// =====================================================================
// src/components/AdminBareme.jsx — Admin → „✅ Încarcă bareme" (19 nov. 2026)
//
// Cererea: „În admin pune o secțiune de încărcare bareme la orice categorie. Baremele să
// se poată și șterge sau face modificări din secțiunea «tot conținutul»."
//
// Baremul unui material din orice clasă sau examen: alegi clasa / examenul (+ profilul la
// BAC), materialul al cărui barem e (opțional, dar recomandat — atunci îl folosesc
// „📋 Barem" din vizualizator și corectarea), titlul, accesul și PDF-ul. PDF-ul urcă din
// browser în Storage (content-files[-free]/pdf/<categorie>/…), apoi serverul îl salvează ca
// material al categoriei, în rubrica „bareme", și îl leagă de material (api/bareme.js →
// incarca_barem). Unde apare: la clase — în fila „📋 Bareme"; la EN / BAC — în rubrica
// „Bareme". Modificarea și ștergerea: „📋 Tot Conținutul" → „📋 Doar bareme".
// =====================================================================
import { useEffect, useMemo, useState } from 'react';
import { apiPost } from '../lib/api';
import { supabase } from '../lib/supabase';
import { CATEGORIES, BAC_PROFILES, subcategoryLabel, profileLabel, safeFileName } from '../lib/contentMeta';
import { esteBarem } from '../lib/bareme';
import FileUploadZone from './FileUploadZone';

// bareme au clasele și examenele (Auxiliarele n-au fișe PDF)
export const CATEGORII_BAREM = CATEGORIES.filter((c) => c.value !== 'manuale');
const GOL = { category: 'evaluare-nationala', profile: '', materialId: '', title: '', is_free: false };

// eticheta unui material în listă: titlul · rubrica · profilul
function eticheta(m) {
  const extra = [m.subcategory ? subcategoryLabel(m.category, m.subcategory) : null, m.profile ? profileLabel(m.profile) : null].filter(Boolean).join(' · ');
  return extra ? `${m.title} — ${extra}` : m.title;
}

// Încarcă PDF-ul baremului în Storage și îl salvează pe server (folosit și de „🤖 Variante AI")
export async function incarcaBaremPdf({ file, category, profile = null, materialId = null, title = '', isFree = false }) {
  const bucket = isFree ? 'content-files-free' : 'content-files';
  const path = `pdf/${category}/${Date.now()}_${safeFileName(file.name) || 'barem.pdf'}`;
  const { error } = await supabase.storage.from(bucket).upload(path, file, { contentType: 'application/pdf' });
  if (error) throw new Error(`Încărcarea a eșuat: ${error.message}`);
  const { data: u } = supabase.storage.from(bucket).getPublicUrl(path);
  return apiPost('/api/bareme', { action: 'incarca_barem', category, profile: profile || null, materialId: materialId || null, fileUrl: u?.publicUrl || path, title });
}

export default function AdminBareme({ s, onSuccess }) {
  const [form, setForm] = useState(GOL);
  const [file, setFile] = useState(null);
  const [materiale, setMateriale] = useState(null);   // PDF-urile categoriei, fără bareme
  const [cauta, setCauta] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const bac = form.category === 'bacalaureat';

  useEffect(() => {
    let viu = true;
    setMateriale(null);
    supabase.from('content').select('id, title, category, subcategory, profile, content_type, file_url, is_free, created_at')
      .eq('category', form.category).eq('content_type', 'pdf')
      .order('created_at', { ascending: false }).range(0, 1999)
      .then(({ data }) => { if (viu) setMateriale((data || []).filter((r) => !esteBarem(r))); }, () => { if (viu) setMateriale([]); });
    return () => { viu = false; };
  }, [form.category]);

  const material = (materiale || []).find((m) => m.id === form.materialId) || null;
  const vazute = useMemo(() => {
    const q = cauta.trim().toLowerCase();
    return (materiale || []).filter((m) => (!bac || !form.profile || !m.profile || m.profile === form.profile)
      && (!q || eticheta(m).toLowerCase().includes(q)));
  }, [materiale, cauta, bac, form.profile]);

  function alegeMaterial(id) {
    const m = (materiale || []).find((x) => x.id === id) || null;
    setForm((f) => ({
      ...f, materialId: id,
      title: m ? `Barem — ${m.title}` : f.title,
      is_free: m ? !!m.is_free : f.is_free,
      profile: bac && m && m.profile ? m.profile : f.profile,
    }));
  }

  async function trimite() {
    if (!file) { setMsg({ type: 'error', text: 'Alege PDF-ul baremului.' }); return; }
    if (!/\.pdf$/i.test(file.name) && file.type !== 'application/pdf') { setMsg({ type: 'error', text: 'Baremul se încarcă ca PDF (cu text, nu scanat — profesorul virtual îi citește textul).' }); return; }
    if (!form.title.trim() && !material) { setMsg({ type: 'error', text: 'Scrie titlul baremului sau alege materialul lui.' }); return; }
    if (bac && !form.profile) { setMsg({ type: 'error', text: 'Alege profilul de Bacalaureat.' }); return; }
    setBusy(true);
    setMsg(null);
    try {
      const r = await incarcaBaremPdf({ file, category: form.category, profile: bac ? form.profile : null, materialId: form.materialId || null, title: form.title.trim(), isFree: form.is_free });
      setMsg({
        type: 'success',
        text: `📋 „${r.barem.title}" a fost încărcat${r.legatDe ? ` și legat de „${r.legatDe.title}"` : ''}. Îl găsești — și îl poți modifica sau șterge — în 📋 Tot Conținutul → „📋 Doar bareme".`,
      });
      setFile(null);
      setForm((f) => ({ ...f, materialId: '', title: '' }));
      onSuccess?.(r);
    } catch (e) {
      setMsg({ type: 'error', text: e.message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={s.card}>
      <div style={s.cardTitle}>✅ Încarcă bareme</div>
      <div style={s.infoBox}>
        Baremul oricărui material, la orice clasă sau examen. Alege <strong>materialul</strong> al cărui barem e: atunci îl folosesc
        „📋 Barem" din vizualizator și corectarea (Profesorul Virtual, „✏️ Rezolvă pe PDF"). Apare la clase în fila „📋 Bareme",
        la Evaluarea Națională și la Bacalaureat în rubrica „Bareme". Îl modifici sau îl ștergi din <strong>📋 Tot Conținutul</strong> → „📋 Doar bareme".
      </div>
      {msg && <div style={s.alert(msg.type)} role="status">{msg.text}</div>}

      <div style={s.formRow}>
        <div style={s.formGroup}>
          <label style={s.label}>Clasa sau examenul *</label>
          <select style={s.select} value={form.category}
            onChange={(e) => { setCauta(''); setForm((f) => ({ ...f, category: e.target.value, profile: '', materialId: '' })); }}>
            {CATEGORII_BAREM.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
          </select>
        </div>
        {bac && (
          <div style={s.formGroup}>
            <label style={s.label}>Profil Bacalaureat *</label>
            <select style={s.select} value={form.profile} onChange={(e) => setForm((f) => ({ ...f, profile: e.target.value }))}>
              <option value="">— Selectează —</option>
              {BAC_PROFILES.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
            </select>
          </div>
        )}
      </div>

      <div style={s.formGroup}>
        <label style={s.label}>Baremul pentru materialul (recomandat)</label>
        <input style={{ ...s.input, marginBottom: 6 }} value={cauta} onChange={(e) => setCauta(e.target.value)}
          placeholder="🔍 Caută materialul (titlu, an, variantă…)" aria-label="Caută materialul" />
        <select style={s.select} value={form.materialId} onChange={(e) => alegeMaterial(e.target.value)} aria-label="Materialul baremului">
          <option value="">{materiale === null ? 'Se încarcă materialele…' : `— fără material (doar baremul) · ${vazute.length} materiale —`}</option>
          {vazute.slice(0, 400).map((m) => <option key={m.id} value={m.id}>{eticheta(m)}</option>)}
        </select>
        {material && <div style={{ fontSize: '.78rem', color: '#2e7d32', marginTop: 4 }}>🔗 Baremul se leagă de „{material.title}" — corectarea și „📋 Barem" îl vor folosi.</div>}
      </div>

      <div style={s.formRow}>
        <div style={s.formGroup}>
          <label style={s.label}>Titlu {material ? '' : '*'}</label>
          <input style={s.input} value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
            placeholder="ex. Barem — Evaluare Națională 2026, Varianta 3" />
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
        <label style={s.label}>Fișierul baremului (PDF) *</label>
        <FileUploadZone s={s} accept=".pdf" icon="✅" label="Trage PDF-ul baremului aici sau apasă pentru a selecta"
          hint="PDF cu text (nu scanat) — profesorul virtual îi citește textul" file={file} onFile={setFile} />
      </div>

      <button style={s.btnPrimary} onClick={trimite} disabled={busy}>
        {busy ? 'Se încarcă...' : '⬆ Încarcă baremul'}
      </button>
    </div>
  );
}
