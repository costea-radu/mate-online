import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../lib/supabase';
import AIAdminPanel from '../components/AIAdminPanel';


const CATEGORIES = [
  { value: 'clasa-5',  label: 'Clasa a V-a' },
  { value: 'clasa-6',  label: 'Clasa a VI-a' },
  { value: 'clasa-7',  label: 'Clasa a VII-a' },
  { value: 'clasa-8',  label: 'Clasa a VIII-a' },
  { value: 'clasa-9',  label: 'Clasa a IX-a' },
  { value: 'clasa-10', label: 'Clasa a X-a' },
  { value: 'clasa-11', label: 'Clasa a XI-a' },
  { value: 'clasa-12', label: 'Clasa a XII-a' },
  { value: 'evaluare-nationala', label: 'Evaluare Națională' },
  { value: 'bacalaureat', label: 'Bacalaureat' },
  { value: 'manuale', label: 'Manuale Online' },
];

const EN_SUBCATEGORIES = [
  { value: 'capitole',          label: 'Capitole' },
  { value: 'exercitii-subiecte',label: 'Exerciții pe Subiecte (Teste antrenament)' },
  { value: 'variante',          label: 'Variante Date + Modele (Teste antrenament)' },
  { value: 'simulari',          label: 'Simulări (Teste antrenament)' },
  { value: 'bareme',            label: 'Bareme (Teste antrenament)' },
  { value: 'teste-interactive', label: 'Teste Interactive' },
];

const BAC_SUBCATEGORIES = [
  { value: 'capitole',          label: 'Capitole' },
  { value: 'exercitii',         label: 'Exerciții pe Subiecte' },
  { value: 'variante',          label: 'Variante + Olimpici + Rezerve' },
  { value: 'teste-antrenament', label: 'Teste de Antrenament' },
  { value: 'simulari',          label: 'Simulări' },
  { value: 'bareme',            label: 'Bareme' },
  { value: 'teste-interactive', label: 'Teste Interactive' },
];

const BAC_PROFILES = [
  { value: 'mate-info',       label: 'Mate-Info' },
  { value: 'stiinte-naturii', label: 'Științele Naturii' },
  { value: 'tehnologic',      label: 'Tehnologic' },
];

const CONTENT_TYPES = [
  { value: 'pdf', label: '📄 PDF' },
  { value: 'interactive', label: '🧩 Exercițiu Interactiv' },
  { value: 'manual', label: '📖 Manual Online' },
];

// ─── Styles ───────────────────────────────────────────────────────────────────
const s = {
  page: { minHeight: '100vh', background: '#f0f4f8', fontFamily: 'var(--font-body)' },
  header: {
    background: 'var(--navy)', color: '#fff', padding: '20px 32px',
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    boxShadow: '0 2px 12px rgba(0,0,0,0.2)',
  },
  headerTitle: { fontFamily: 'var(--font-display)', fontSize: '1.4rem', color: 'var(--gold)' },
  headerSub: { fontSize: '0.8rem', color: 'rgba(255,255,255,0.5)', marginTop: 2 },
  body: { display: 'flex', minHeight: 'calc(100vh - 64px)' },
  sidebar: { width: 220, background: 'var(--navy-dark)', padding: '24px 0', flexShrink: 0 },
  sidebarBtn: (active) => ({
    display: 'block', width: '100%', padding: '12px 24px', textAlign: 'left',
    color: active ? 'var(--gold)' : 'rgba(255,255,255,0.6)',
    background: active ? 'rgba(232,185,49,0.1)' : 'none',
    borderLeft: active ? '3px solid var(--gold)' : '3px solid transparent',
    fontWeight: active ? 600 : 400, fontSize: '0.9rem', cursor: 'pointer', transition: 'all 0.2s',
  }),
  main: { flex: 1, padding: '32px', overflowY: 'auto' },
  card: {
    background: '#fff', borderRadius: 12, padding: '28px 32px',
    boxShadow: '0 1px 4px rgba(0,0,0,0.08)', marginBottom: 24,
  },
  cardTitle: {
    fontFamily: 'var(--font-display)', fontSize: '1.2rem', color: 'var(--navy)',
    marginBottom: 20, paddingBottom: 12, borderBottom: '2px solid #f0f4f8',
  },
  formRow: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 },
  formGroup: { marginBottom: 16 },
  label: {
    display: 'block', fontSize: '0.82rem', fontWeight: 600, color: '#5a6170',
    marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.04em',
  },
  input: {
    width: '100%', padding: '10px 14px', borderRadius: 8,
    border: '1.5px solid #dde1e8', fontSize: '0.92rem',
    fontFamily: 'var(--font-body)', outline: 'none', transition: 'border-color 0.2s', background: '#fafbfc',
  },
  select: {
    width: '100%', padding: '10px 14px', borderRadius: 8,
    border: '1.5px solid #dde1e8', fontSize: '0.92rem',
    fontFamily: 'var(--font-body)', outline: 'none', background: '#fafbfc',
  },
  textarea: {
    width: '100%', padding: '10px 14px', borderRadius: 8,
    border: '1.5px solid #dde1e8', fontSize: '0.92rem',
    fontFamily: 'var(--font-body)', outline: 'none', background: '#fafbfc',
    minHeight: 100, resize: 'vertical',
  },
  btnPrimary: {
    padding: '10px 24px', background: 'var(--gold)', color: 'var(--navy-dark)',
    borderRadius: 8, fontWeight: 700, fontSize: '0.9rem', cursor: 'pointer',
    border: 'none', transition: 'all 0.2s',
  },
  btnDanger: {
    padding: '6px 14px', background: '#fce4ec', color: '#c62828',
    borderRadius: 6, fontWeight: 600, fontSize: '0.82rem', cursor: 'pointer', border: 'none',
  },
  btnSecondary: {
    padding: '8px 18px', background: '#f0f4f8', color: 'var(--navy)',
    borderRadius: 8, fontWeight: 600, fontSize: '0.87rem', cursor: 'pointer',
    border: '1.5px solid #dde1e8',
  },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: '0.88rem' },
  th: {
    padding: '10px 14px', textAlign: 'left', background: '#f7f9fc', fontWeight: 600,
    color: '#5a6170', fontSize: '0.8rem', textTransform: 'uppercase',
    letterSpacing: '0.04em', borderBottom: '1px solid #eee',
  },
  td: { padding: '12px 14px', borderBottom: '1px solid #f0f4f8', verticalAlign: 'middle' },
  badge: (type) => ({
    display: 'inline-block', padding: '3px 10px', borderRadius: 20,
    fontSize: '0.75rem', fontWeight: 700,
    background: type === 'pdf' ? '#e3f2fd' : type === 'interactive' ? '#f3e5f5' : '#e8f5e9',
    color: type === 'pdf' ? '#1565c0' : type === 'interactive' ? '#6a1b9a' : '#2e7d32',
  }),
  freeBadge: (free) => ({
    display: 'inline-block', padding: '3px 10px', borderRadius: 20,
    fontSize: '0.75rem', fontWeight: 700,
    background: free ? '#e8f5e9' : '#fff3e0',
    color: free ? '#2e7d32' : '#e65100',
  }),
  alert: (type) => ({
    padding: '12px 16px', borderRadius: 8, marginBottom: 16, fontSize: '0.88rem',
    background: type === 'success' ? '#e8f5e9' : '#fce4ec',
    color: type === 'success' ? '#2e7d32' : '#c62828',
  }),
  uploadZone: (drag) => ({
    border: `2px dashed ${drag ? 'var(--gold)' : '#dde1e8'}`,
    borderRadius: 10, padding: '28px 20px', textAlign: 'center',
    background: drag ? 'rgba(232,185,49,0.05)' : '#fafbfc',
    cursor: 'pointer', transition: 'all 0.2s',
  }),
  separator: { borderBottom: '1.5px solid #f0f4f8', margin: '20px 0' },
  statCard: { background: '#fff', borderRadius: 12, padding: '20px 24px', boxShadow: '0 1px 4px rgba(0,0,0,0.07)' },
  statNum: { fontSize: '2rem', fontWeight: 800, color: 'var(--navy)', fontFamily: 'var(--font-display)' },
  statLabel: { fontSize: '0.8rem', color: '#8e95a3', marginTop: 2 },
  infoBox: {
    background: '#e8f4fd', border: '1px solid #90caf9', borderRadius: 8,
    padding: '14px 18px', fontSize: '0.86rem', color: '#1565c0', lineHeight: 1.6, marginBottom: 16,
  },
};

// ─── Componentă upload fișier reutilizabilă ───────────────────────────────────
function FileUploadZone({ accept, label, hint, file, onFile, icon }) {
  const [drag, setDrag] = useState(false);
  const ref = useRef();

  function handleFile(f) {
    if (!f) return;
    const ext = f.name.split('.').pop().toLowerCase();
    const accepted = accept.replace('.', '').split(',').map(a => a.trim().replace('.', ''));
    if (!accepted.includes(ext)) {
      alert(`Selectează un fișier ${accept}.`);
      return;
    }
    onFile(f);
  }

  return (
    <div>
      <div
        style={s.uploadZone(drag)}
        onDragOver={e => { e.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={e => { e.preventDefault(); setDrag(false); handleFile(e.dataTransfer.files[0]); }}
        onClick={() => ref.current.click()}
      >
        {file ? (
          <div>
            <div style={{ fontSize: '2rem' }}>{icon}</div>
            <div style={{ fontWeight: 600, marginTop: 8 }}>{file.name}</div>
            <div style={{ color: '#8e95a3', fontSize: '0.82rem' }}>{(file.size / 1024).toFixed(0)} KB</div>
          </div>
        ) : (
          <div>
            <div style={{ fontSize: '2rem' }}>☁️</div>
            <div style={{ fontWeight: 600, marginTop: 8 }}>{label}</div>
            <div style={{ color: '#8e95a3', fontSize: '0.82rem', marginTop: 4 }}>{hint}</div>
          </div>
        )}
      </div>
      <input ref={ref} type="file" accept={accept} style={{ display: 'none' }} onChange={e => handleFile(e.target.files[0])} />
    </div>
  );
}

// ─── Upload PDF ───────────────────────────────────────────────────────────────
function UploadPDF({ onSuccess }) {
  const [form, setForm] = useState({ title: '', description: '', category: 'clasa-5', subcategory: '', profile: '', is_free: true });
  const [file, setFile] = useState(null);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState(null);

  const isEN = form.category === 'evaluare-nationala';
  const isBAC = form.category === 'bacalaureat';

  async function handleSubmit() {
    if (!file || !form.title || !form.category) {
      setMsg({ type: 'error', text: 'Completează titlul, categoria și selectează un PDF.' });
      return;
    }
    setLoading(true);
    setMsg(null);
    try {
      const bucket = form.is_free ? 'content-files-free' : 'content-files';
      const path = `pdf/${form.category}/${Date.now()}_${file.name}`;
      const { error: uploadErr } = await supabase.storage.from(bucket).upload(path, file);
      if (uploadErr) throw uploadErr;

      const { data: urlData } = supabase.storage.from(bucket).getPublicUrl(path);

      const { error: dbErr } = await supabase.from('content').insert({
        title: form.title, description: form.description,
        category: form.category, content_type: 'pdf',
        is_free: form.is_free, file_url: urlData?.publicUrl || path,
        subcategory: form.subcategory || null,
        profile: form.profile || null,
        sort_order: 0,
      });
      if (dbErr) throw dbErr;

      setMsg({ type: 'success', text: 'PDF încărcat cu succes!' });
      setFile(null);
      setForm({ title: '', description: '', category: 'clasa-5', subcategory: '', profile: '', is_free: true });
      onSuccess?.();
    } catch (err) {
      setMsg({ type: 'error', text: err.message });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={s.card}>
      <div style={s.cardTitle}>📄 Adaugă PDF</div>
      {msg && <div style={s.alert(msg.type)}>{msg.text}</div>}

      <div style={s.formRow}>
        <div style={s.formGroup}>
          <label style={s.label}>Titlu *</label>
          <input style={s.input} value={form.title}
            onChange={e => setForm(p => ({ ...p, title: e.target.value }))}
            placeholder="ex. Fișă de lucru – Fracții" />
        </div>
        <div style={s.formGroup}>
          <label style={s.label}>Categorie *</label>
          <select style={s.select} value={form.category}
            onChange={e => setForm(p => ({ ...p, category: e.target.value, subcategory: '', profile: '' }))}>
            {CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
          </select>
        </div>
      </div>

      {isEN && (
        <div style={s.formGroup}>
          <label style={s.label}>Subcategorie EN</label>
          <select style={s.select} value={form.subcategory}
            onChange={e => setForm(p => ({ ...p, subcategory: e.target.value }))}>
            <option value="">— Selectează —</option>
            {EN_SUBCATEGORIES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
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
              {BAC_SUBCATEGORIES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
          </div>
        </div>
      )}

      <div style={s.formRow}>
        <div style={s.formGroup}>
          <label style={s.label}>Descriere</label>
          <input style={s.input} value={form.description}
            onChange={e => setForm(p => ({ ...p, description: e.target.value }))}
            placeholder="Scurtă descriere opțională" />
        </div>
        <div style={s.formGroup}>
          <label style={s.label}>Acces</label>
          <select style={s.select} value={form.is_free ? 'free' : 'premium'}
            onChange={e => setForm(p => ({ ...p, is_free: e.target.value === 'free' }))}>
            <option value="free">🟢 Gratuit</option>
            <option value="premium">⭐ Premium</option>
          </select>
        </div>
      </div>

      <div style={s.formGroup}>
        <label style={s.label}>Fișier PDF *</label>
        <FileUploadZone
          accept=".pdf" icon="📄"
          label="Trage PDF-ul aici sau apasă pentru a selecta"
          hint="Doar fișiere .pdf"
          file={file} onFile={setFile}
        />
      </div>

      <button style={s.btnPrimary} onClick={handleSubmit} disabled={loading}>
        {loading ? 'Se încarcă...' : '⬆ Încarcă PDF'}
      </button>
    </div>
  );
}

// ─── Upload Exercițiu Interactiv (HTML) ───────────────────────────────────────
function UploadInteractive({ onSuccess }) {
  const [form, setForm] = useState({
    title: '', description: '', category: 'clasa-5', subcategory: '', profile: '', is_free: false, type: 'exercise',
  });
  const [file, setFile] = useState(null);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState(null);
  const isEN = form.category === 'evaluare-nationala';
  const isBAC = form.category === 'bacalaureat';

  async function handleSubmit() {
    if (!file || !form.title || !form.category) {
      setMsg({ type: 'error', text: 'Completează titlul, categoria și selectează un fișier HTML.' });
      return;
    }
    setLoading(true);
    setMsg(null);
    try {
      const bucket = form.is_free ? 'content-files-free' : 'content-files';
      const path = `interactive/${form.category}/${Date.now()}_${file.name}`;
      const { error: uploadErr } = await supabase.storage.from(bucket).upload(path, file, { contentType: 'text/html' });
      if (uploadErr) throw uploadErr;
      const { data: urlData } = supabase.storage.from(bucket).getPublicUrl(path);
      const { error: dbErr } = await supabase.from('content').insert({
        title: form.title, description: form.description,
        category: form.category, content_type: 'interactive',
        is_free: form.is_free, file_url: urlData?.publicUrl || path,
        interactive_data: { type: form.type, html: true },
        subcategory: form.subcategory || null,
        profile: form.profile || null,
        sort_order: 0,
      });
      if (dbErr) throw dbErr;
      setMsg({ type: 'success', text: 'Exercițiul interactiv a fost încărcat cu succes!' });
      setFile(null);
      setForm({ title: '', description: '', category: 'clasa-5', subcategory: '', profile: '', is_free: false, type: 'exercise' });
      onSuccess?.();
    } catch (err) {
      setMsg({ type: 'error', text: err.message });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={s.card}>
      <div style={s.cardTitle}>🧩 Adaugă Exercițiu / Test Interactiv</div>
      <div style={s.infoBox}>
        <strong>Cum funcționează:</strong> Creezi exercițiul ca pagină HTML separată și îl încarci aici. Se va deschide în viewer intern.
      </div>
      {msg && <div style={s.alert(msg.type)}>{msg.text}</div>}

      <div style={s.formRow}>
        <div style={s.formGroup}>
          <label style={s.label}>Titlu *</label>
          <input style={s.input} value={form.title}
            onChange={e => setForm(p => ({ ...p, title: e.target.value }))}
            placeholder="ex. Test – Ecuații de gradul I" />
        </div>
        <div style={s.formGroup}>
          <label style={s.label}>Categorie *</label>
          <select style={s.select} value={form.category}
            onChange={e => setForm(p => ({ ...p, category: e.target.value, subcategory: '', profile: '' }))}>
            {CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
          </select>
        </div>
      </div>

      {isEN && (
        <div style={s.formGroup}>
          <label style={s.label}>Subcategorie EN</label>
          <select style={s.select} value={form.subcategory}
            onChange={e => setForm(p => ({ ...p, subcategory: e.target.value }))}>
            <option value="">— Selectează —</option>
            {EN_SUBCATEGORIES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
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
              {BAC_SUBCATEGORIES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
          </div>
        </div>
      )}

      <div style={s.formRow}>
        <div style={s.formGroup}>
          <label style={s.label}>Tip</label>
          <select style={s.select} value={form.type} onChange={e => setForm(p => ({ ...p, type: e.target.value }))}>
            <option value="exercise">Exercițiu</option>
            <option value="test">Test</option>
          </select>
        </div>
        <div style={s.formGroup}>
          <label style={s.label}>Acces</label>
          <select style={s.select} value={form.is_free ? 'free' : 'premium'}
            onChange={e => setForm(p => ({ ...p, is_free: e.target.value === 'free' }))}>
            <option value="free">🟢 Gratuit</option>
            <option value="premium">⭐ Premium</option>
          </select>
        </div>
      </div>

      <div style={s.formGroup}>
        <label style={s.label}>Descriere</label>
        <input style={s.input} value={form.description}
          onChange={e => setForm(p => ({ ...p, description: e.target.value }))}
          placeholder="ex. 10 întrebări despre ecuații liniare" />
      </div>

      <div style={s.formGroup}>
        <label style={s.label}>Fișier HTML *</label>
        <FileUploadZone
          accept=".html" icon="🧩"
          label="Trage fișierul HTML aici sau apasă pentru a selecta"
          hint="Doar fișiere .html — include tot CSS și JS în același fișier"
          file={file} onFile={setFile}
        />
      </div>

      {file && (
        <div style={{ background: '#f3e5f5', border: '1px solid #ce93d8', borderRadius: 8, padding: '12px 16px', marginBottom: 16, fontSize: '0.85rem', color: '#4a148c' }}>
          <strong>📋 Fișier selectat:</strong> {file.name} ({(file.size / 1024).toFixed(1)} KB)
          <br />
          <span style={{ opacity: 0.8 }}>Va fi încărcat în bucket-ul "{form.is_free ? 'content-files-free' : 'content-files'}"</span>
        </div>
      )}

      <button style={s.btnPrimary} onClick={handleSubmit} disabled={loading}>
        {loading ? 'Se încarcă...' : '⬆ Încarcă Exercițiul'}
      </button>
    </div>
  );
}


// ─── Content List ─────────────────────────────────────────────────────────────
function ContentList({ refresh }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState({ category: '', type: '' });
  const [deleting, setDeleting] = useState(null);

  useEffect(() => { load(); }, [refresh]);

  async function load() {
    setLoading(true);
    // Supabase întoarce implicit maxim 1000 rânduri — citim în pagini ca să apară TOT.
    const PAGE = 1000;
    let all = [];
    let from = 0;
    while (true) {
      const { data, error } = await supabase.from('content').select('*')
        .order('created_at', { ascending: false }).range(from, from + PAGE - 1);
      if (error) break;
      const rows = data || [];
      all = all.concat(rows);
      if (rows.length < PAGE) break;
      from += PAGE;
    }
    setItems(all);
    setLoading(false);
  }

  async function handleDelete(item) {
    if (!window.confirm(`Sigur vrei să ștergi "${item.title}"?`)) return;
    setDeleting(item.id);

    // Șterge fișierul din Storage dacă există
    if (item.file_url) {
      try {
        const bucket = item.is_free ? 'content-files-free' : 'content-files';
        const prefix = `${bucket}/`;
        const url = item.file_url;
        const idx = url.indexOf(prefix);
        if (idx !== -1) {
          const storagePath = url.slice(idx + prefix.length);
          await supabase.storage.from(bucket).remove([storagePath]);
        }
      } catch (_) { /* nu blocăm dacă Storage eșuează */ }
    }

    await supabase.from('content').delete().eq('id', item.id);
    setItems(i => i.filter(x => x.id !== item.id));
    setDeleting(null);
  }

  const filtered = items.filter(i =>
    (!filter.category || i.category === filter.category) &&
    (!filter.type || i.content_type === filter.type)
  );

  return (
    <div style={s.card}>
      <div style={s.cardTitle}>📋 Tot Conținutul ({filtered.length})</div>

      <div style={{ display: 'flex', gap: 12, marginBottom: 20 }}>
        <select style={{ ...s.select, width: 200 }} value={filter.category}
          onChange={e => setFilter(p => ({ ...p, category: e.target.value }))}>
          <option value="">Toate categoriile</option>
          {CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
        </select>
        <select style={{ ...s.select, width: 180 }} value={filter.type}
          onChange={e => setFilter(p => ({ ...p, type: e.target.value }))}>
          <option value="">Toate tipurile</option>
          {CONTENT_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
        </select>
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: 40, color: '#8e95a3' }}>Se încarcă...</div>
      ) : filtered.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 40, color: '#8e95a3' }}>Nu există conținut.</div>
      ) : (
        <table style={s.table}>
          <thead>
            <tr>
              <th style={s.th}>Titlu</th>
              <th style={s.th}>Categorie</th>
              <th style={s.th}>Tip</th>
              <th style={s.th}>Acces</th>
              <th style={s.th}>Fișier</th>
              <th style={s.th}>Data</th>
              <th style={s.th}></th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(item => (
              <tr key={item.id}>
                <td style={s.td}>
                  <div style={{ fontWeight: 600, color: 'var(--navy)' }}>{item.title}</div>
                  {item.description && (
                    <div style={{ fontSize: '0.78rem', color: '#8e95a3', marginTop: 2 }}>{item.description}</div>
                  )}
                </td>
                <td style={s.td}>
                  <span style={{ fontSize: '0.82rem', color: '#5a6170' }}>
                    {CATEGORIES.find(c => c.value === item.category)?.label || item.category}
                  </span>
                </td>
                <td style={s.td}><span style={s.badge(item.content_type)}>{item.content_type}</span></td>
                <td style={s.td}><span style={s.freeBadge(item.is_free)}>{item.is_free ? 'Gratuit' : 'Premium'}</span></td>
                <td style={s.td}>
                  {item.file_url ? (
                    <a href={item.file_url} target="_blank" rel="noopener noreferrer"
                      style={{ fontSize: '0.78rem', color: '#1565c0', textDecoration: 'underline' }}>
                      {item.content_type === 'interactive' ? '🧩 HTML' : '📄 PDF'}
                    </a>
                  ) : (
                    <span style={{ fontSize: '0.78rem', color: '#8e95a3' }}>—</span>
                  )}
                </td>
                <td style={{ ...s.td, fontSize: '0.78rem', color: '#8e95a3' }}>
                  {new Date(item.created_at).toLocaleDateString('ro-RO')}
                </td>
                <td style={s.td}>
                  <button style={s.btnDanger} onClick={() => handleDelete(item)}
                    disabled={deleting === item.id}>
                    {deleting === item.id ? '...' : '🗑 Șterge'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

// ─── Dashboard ────────────────────────────────────────────────────────────────
function Dashboard() {
  const [stats, setStats] = useState({ total: 0, pdf: 0, interactive: 0, manual: 0, users: 0, premium: 0 });
  const { user } = useAuth();

  useEffect(() => {
    if (!user) return;
    async function load() {
      try {
        // Folosim API route cu service role key pentru a ocoli RLS pe profiles
        const res = await fetch('/api/admin-stats', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId: user.id }),
        });
        if (!res.ok) throw new Error('Eroare la încărcarea statisticilor');
        const data = await res.json();
        setStats(data);
      } catch (err) {
        console.error('Dashboard stats error:', err);
      }
    }
    load();
  }, [user]);

  const statItems = [
    { num: stats.total,       label: 'Total materiale',       color: 'var(--navy)' },
    { num: stats.pdf,         label: 'PDF-uri',               color: '#1565c0' },
    { num: stats.interactive, label: 'Exerciții interactive', color: '#6a1b9a' },
    { num: stats.manual,      label: 'Auxiliare',             color: '#00695c' },
    { num: stats.users,       label: 'Utilizatori',           color: '#2e7d32' },
    { num: stats.premium,     label: 'Abonați Premium',       color: '#e65100' },
  ];

  return (
    <>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16, marginBottom: 24 }}>
        {statItems.map(st => (
          <div key={st.label} style={s.statCard}>
            <div style={{ ...s.statNum, color: st.color }}>{st.num}</div>
            <div style={s.statLabel}>{st.label}</div>
          </div>
        ))}
      </div>
      <div style={{ ...s.card, background: 'var(--navy)', color: '#fff' }}>
        <div style={{ fontFamily: 'var(--font-display)', fontSize: '1.1rem', color: 'var(--gold)', marginBottom: 10 }}>
          👋 Bun venit în Admin
        </div>
        <p style={{ fontSize: '0.9rem', color: 'rgba(255,255,255,0.7)', lineHeight: 1.7 }}>
          Din acest panou poți adăuga <strong style={{ color: '#fff' }}>PDF-uri</strong>,{' '}
          <strong style={{ color: '#fff' }}>exerciții interactive HTML</strong> și{' '}
          <strong style={{ color: '#fff' }}>manuale online</strong>.
          Exercițiile interactive sunt fișiere <code style={{ background: 'rgba(255,255,255,0.1)', padding: '1px 6px', borderRadius: 4 }}>.html</code> pe
          care le creezi separat și le încarci direct.
        </p>
      </div>
    </>
  );
}




// ─── Admin Rezolvări ──────────────────────────────────────────────────────────
const REZ_CATS = [
  { value: 'general', label: 'General' },
  { value: 'clasa-5', label: 'Clasa a V-a' }, { value: 'clasa-6', label: 'Clasa a VI-a' },
  { value: 'clasa-7', label: 'Clasa a VII-a' }, { value: 'clasa-8', label: 'Clasa a VIII-a' },
  { value: 'clasa-9', label: 'Clasa a IX-a' }, { value: 'clasa-10', label: 'Clasa a X-a' },
  { value: 'clasa-11', label: 'Clasa a XI-a' }, { value: 'clasa-12', label: 'Clasa a XII-a' },
  { value: 'evaluare-nationala', label: 'Evaluare Națională' },
  { value: 'bacalaureat', label: 'Bacalaureat' },
];

function AdminRezolvari({ user, s }) {
  const empty = { title: '', description: '', category: 'general', type: 'video', file_url: '', video_url: '', sort_order: 0, is_free: true };
  const [form, setForm] = useState(empty);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState(null);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef(null);

  useEffect(() => { loadItems(); }, []);

  async function loadItems() {
    const res = await fetch('/api/rezolvari-admin', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'list', adminId: user.id }),
    });
    const d = await res.json();
    if (d.rows) setItems(d.rows);
  }

  async function handleFile(file) {
    if (!file) return;
    setUploading(true);
    try {
      const path = `rezolvari/${Date.now()}_${file.name}`;
      const { error } = await supabase.storage.from('discussions').upload(path, file);
      if (error) throw error;
      const { data: { publicUrl } } = supabase.storage.from('discussions').getPublicUrl(path);
      const isImg = file.type.startsWith('image');
      setForm(p => ({ ...p, file_url: publicUrl, type: isImg ? 'image' : 'pdf' }));
    } catch(e) { setMsg({ type: 'error', text: e.message }); }
    setUploading(false);
  }

  async function handleSubmit() {
    if (!form.title) { setMsg({ type: 'error', text: 'Titlul e obligatoriu.' }); return; }
    if (form.type === 'video' && !form.video_url) { setMsg({ type: 'error', text: 'Adaugă URL video.' }); return; }
    if ((form.type === 'image' || form.type === 'pdf') && !form.file_url) { setMsg({ type: 'error', text: 'Încarcă un fișier.' }); return; }
    setLoading(true);
    const res = await fetch('/api/rezolvari-admin', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'create', adminId: user.id, data: form }),
    });
    const d = await res.json();
    if (d.row) { setMsg({ type: 'success', text: 'Rezolvare adăugată!' }); setForm(empty); loadItems(); }
    else setMsg({ type: 'error', text: d.error });
    setLoading(false);
  }

  async function handleDelete(id) {
    if (!window.confirm('Ștergi această rezolvare?')) return;
    await fetch('/api/rezolvari-admin', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'delete', adminId: user.id, id }),
    });
    loadItems();
  }

  return (
    <div>
      {/* Formular adăugare */}
      <div style={s.card}>
        <div style={s.cardTitle}>📝 Adaugă Rezolvare</div>
        {msg && <div style={s.alert(msg.type)}>{msg.text}</div>}

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          <div style={s.formGroup}>
            <label style={s.label}>Titlu *</label>
            <input style={s.input} value={form.title} onChange={e => setForm(p => ({...p, title: e.target.value}))} placeholder="ex: Rezolvare Fracții – Set 1" />
          </div>
          <div style={s.formGroup}>
            <label style={s.label}>Categorie</label>
            <select style={s.select} value={form.category} onChange={e => setForm(p => ({...p, category: e.target.value}))}>
              {REZ_CATS.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
            </select>
          </div>
        </div>

        <div style={s.formGroup}>
          <label style={s.label}>Descriere</label>
          <input style={s.input} value={form.description} onChange={e => setForm(p => ({...p, description: e.target.value}))} placeholder="Scurtă descriere..." />
        </div>

        {/* Tip conținut */}
        <div style={s.formGroup}>
          <label style={s.label}>Tip conținut</label>
          <div style={{ display: 'flex', gap: 8 }}>
            {[{v:'video',l:'▶ Video (YouTube/TikTok)'},{v:'image',l:'🖼 Imagine'},{v:'pdf',l:'📄 PDF'}].map(t => (
              <button key={t.v} type="button" onClick={() => setForm(p => ({...p, type: t.v, file_url: '', video_url: ''}))}
                style={{ ...s.btnSecondary, flex:1, background: form.type === t.v ? 'var(--navy)' : '#f0f4f8', color: form.type === t.v ? '#fff' : 'var(--navy)' }}>
                {t.l}
              </button>
            ))}
          </div>
        </div>

        {/* Input în funcție de tip */}
        {form.type === 'video' && (
          <div style={s.formGroup}>
            <label style={s.label}>URL Video *</label>
            <input style={s.input} value={form.video_url} onChange={e => setForm(p => ({...p, video_url: e.target.value}))}
              placeholder="https://www.youtube.com/watch?v=... sau https://www.tiktok.com/..." />
          </div>
        )}

        {(form.type === 'image' || form.type === 'pdf') && (
          <div style={s.formGroup}>
            <label style={s.label}>Fișier * ({form.type === 'image' ? 'imagine JPG/PNG' : 'document PDF'})</label>
            <div onClick={() => fileRef.current?.click()}
              style={{ border: '2px dashed #dde1e8', borderRadius: 10, padding: '24px', textAlign: 'center', cursor: 'pointer', background: '#fafbfc' }}>
              <div style={{ fontSize: '2rem', marginBottom: 8 }}>{form.type === 'image' ? '🖼' : '📄'}</div>
              <div style={{ fontSize: '0.85rem', color: '#5a6170' }}>
                {uploading ? 'Se încarcă...' : form.file_url ? '✓ Fișier încărcat' : 'Click pentru a selecta fișierul'}
              </div>
              {form.file_url && <div style={{ fontSize: '0.75rem', color: '#2e7d32', marginTop: 4 }}>URL: {form.file_url.slice(-40)}...</div>}
            </div>
            <input ref={fileRef} type="file" accept={form.type === 'image' ? 'image/*' : '.pdf'}
              style={{ display: 'none' }} onChange={e => handleFile(e.target.files[0])} />
          </div>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          <div style={s.formGroup}>
            <label style={s.label}>Ordine afișare</label>
            <input type="number" style={s.input} value={form.sort_order}
              onChange={e => setForm(p => ({...p, sort_order: parseInt(e.target.value)||0}))} />
          </div>
          <div style={s.formGroup}>
            <label style={s.label}>Acces</label>
            <select style={s.select} value={form.is_free ? 'free' : 'premium'}
              onChange={e => setForm(p => ({...p, is_free: e.target.value === 'free'}))}>
              <option value="free">✅ Gratuit</option>
              <option value="premium">⭐ Premium</option>
            </select>
          </div>
        </div>

        <button style={s.btnPrimary} onClick={handleSubmit} disabled={loading || uploading}>
          {loading ? 'Se salvează...' : '💾 Adaugă Rezolvare'}
        </button>
      </div>

      {/* Lista rezolvări existente */}
      <div style={s.card}>
        <div style={s.cardTitle}>📋 Rezolvări existente ({items.length})</div>
        {items.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '30px 0', color: '#8e95a3' }}>Nicio rezolvare adăugată.</div>
        ) : (
          <table style={s.table}>
            <thead><tr>
              <th style={s.th}>Titlu</th>
              <th style={s.th}>Tip</th>
              <th style={s.th}>Categorie</th>
              <th style={s.th}>Acces</th>
                  <th style={s.th}>Ordine</th>
              <th style={s.th}></th>
            </tr></thead>
            <tbody>
              {items.map(item => (
                <tr key={item.id}>
                  <td style={s.td}><div style={{ fontWeight:600, color:'var(--navy)', fontSize:'0.88rem' }}>{item.title}</div>
                    {item.description && <div style={{ fontSize:'0.75rem', color:'#8e95a3' }}>{item.description}</div>}
                  </td>
                  <td style={s.td}><span style={s.badge(item.type)}>{item.type}</span></td>
                  <td style={{ ...s.td, fontSize:'0.82rem', color:'#5a6170' }}>{item.category}</td>
                  <td style={s.td}><span style={s.freeBadge(item.is_free)}>{item.is_free ? 'Gratuit' : 'Premium'}</span></td>
                  <td style={{ ...s.td, fontSize:'0.82rem', color:'#8e95a3', textAlign:'center' }}>{item.sort_order}</td>
                  <td style={s.td}>
                    <button style={s.btnDanger} onClick={() => handleDelete(item.id)}>🗑 Șterge</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────
export default function Admin() {
  const { user, isAdmin, loading } = useAuth();
  const navigate = useNavigate();
  const [tab, setTab] = useState('dashboard');
  const [refreshList, setRefreshList] = useState(0);

  useEffect(() => {
    if (!loading && (!user || !isAdmin)) navigate('/');
  }, [user, loading, navigate]);

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '60vh' }}>
        <div className="spinner" />
      </div>
    );
  }

  if (!user || !isAdmin) return null;

  const tabs = [
    { id: 'dashboard',   label: '📊 Dashboard' },
    { id: 'pdf',         label: '📄 Adaugă PDF' },
    { id: 'interactive', label: '🧩 Exerciții Interactive' },
    { id: 'rezolvari',   label: '📝 Rezolvări' },
    { id: 'list',        label: '📋 Tot Conținutul' },
    { id: 'ai',          label: '🎓 AI Tutor' },
  ];

  function onSuccess() {
    setRefreshList(r => r + 1);
    setTab('list');
  }

  return (
    <div style={s.page}>
      <div style={s.header}>
        <div>
          <div style={s.headerTitle}>⚙ Panou Admin — ExamenMate (Mate-Online)</div>
          <div style={s.headerSub}>{user.email}</div>
        </div>
        <button style={s.btnSecondary} onClick={() => navigate('/')}>← Înapoi pe site</button>
      </div>

      <div style={s.body}>
        <div style={s.sidebar}>
          {tabs.map(t => (
            <button key={t.id} style={s.sidebarBtn(tab === t.id)} onClick={() => setTab(t.id)}>
              {t.label}
            </button>
          ))}
        </div>
        <div style={s.main}>
          {tab === 'dashboard'   && <Dashboard />}
          {tab === 'rezolvari'   && <AdminRezolvari user={user} s={s} />}
          {tab === 'pdf'         && <UploadPDF onSuccess={onSuccess} />}
          {tab === 'interactive' && <UploadInteractive onSuccess={onSuccess} />}
          {tab === 'list'        && <ContentList refresh={refreshList} />}
          {tab === 'ai'          && <AIAdminPanel />}
        </div>
      </div>
    </div>
  );
}
