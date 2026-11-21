// =====================================================================
// src/components/AdminPdfInteractiv.jsx — Admin → „🔗 PDF ↔ Interactiv" (21 nov. 2026)
//
// Cererea: „Fă în admin o rubrică în care pot asocia manual un PDF de un test interactiv.
// Fă ca PDF-urile să se asocieze automat cu un test interactiv generat după modelul lui."
//
// • 📄 PDF-uri: fiecare PDF (fără bareme) cu testul lui principal (cel deschis de „🧩 Deschide
//   interactiv" de pe card și de „✏️ Rezolvă ▾" → „🧩 Interactiv") și celelalte teste făcute
//   după el; „🔗 Asociază un test" / „Schimbă testul", „✕ Dezleagă", „⭐ Fă-l principal".
// • 🧩 Teste interactive: PDF-ul după care e făcut fiecare test (sau de ce n-are: combinat din
//   mai multe teste, după jurnalul generatorului); „🔗 Alege PDF-ul".
// • 🤖 Asociază automat: propunerile pentru testele fără PDF (jurnalul generatorului, titlul) —
//   cele sigure bifate, cele de verificat nebifate (api/_lib/pdfTestPotrivire.js → propuneri).
// Asocierea automată la creare (testele noi): api/_lib/exgen.js → asociazaPdf (task-urile „pe
// rând"), agentul Claude → «Adaugă Interactiv» (PDF-ul-model), «Adaugă Interactiv» (PDF-ul ales
// singur după titlu — AlegePdfSursa, mai jos). Serverul: api/content-admin.js → perechi /
// asociaza / asociaza_lot / dezleaga. Legăturile stau în `content` (interactiv_id, pdf_sursa_id).
// =====================================================================
import { useEffect, useMemo, useState } from 'react';
import { apiPost } from '../lib/api';
import { supabase } from '../lib/supabase';
import { esteBarem } from '../lib/bareme';
import { CATEGORIES, BAC_PROFILES, categoryLabel, subcategoryLabel, profileLabel, subcategoriesFor, hasSubcategories } from '../lib/contentMeta';
import { propunePdf, propuneTest, propuneri, motivIncompatibil, profilCompatibil, compatibili, clasament, procent } from '../../api/_lib/pdfTestPotrivire.js';

// ─── ordinea și etichetele ────────────────────────────────────────────────────
const ORDINE_CAT = ['evaluare-nationala', 'bacalaureat', 'clasa-5', 'clasa-6', 'clasa-7', 'clasa-8', 'clasa-9', 'clasa-10', 'clasa-11', 'clasa-12', 'manuale'];
const pozCat = (c) => { const i = ORDINE_CAT.indexOf(c); return i < 0 ? 99 : i; };
const pozSub = (c, sub) => { const i = subcategoriesFor(c).findIndex((x) => x.value === sub); return i < 0 ? 99 : i; };
const titluNat = (a, b) => String(a.title || '').localeCompare(String(b.title || ''), 'ro', { numeric: true, sensitivity: 'base' });
const ordineSite = (a, b) => (pozCat(a.category) - pozCat(b.category)) || (pozSub(a.category, a.subcategory) - pozSub(b.category, b.subcategory))
  || String(a.profile || '').localeCompare(String(b.profile || '')) || titluNat(a, b);
export const unde = (r) => [categoryLabel(r.category), r.subcategory && hasSubcategories(r.category) ? subcategoryLabel(r.category, r.subcategory) : null, r.profile ? profileLabel(r.profile) : null]
  .filter(Boolean).join(' · ');
const fold = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const ePrea = (n, unu, multe) => (n === 1 ? `1 ${unu}` : `${n} ${n >= 20 ? 'de ' : ''}${multe}`);
const combinate = (n) => (n === 1 ? 'unul combinat' : `${n} combinate`);

const mic = { fontSize: '0.78rem', color: '#5a6170', lineHeight: 1.5 };
const chip = (bg, fg) => ({ display: 'inline-block', padding: '2px 9px', borderRadius: 20, fontSize: '0.72rem', fontWeight: 700, background: bg, color: fg, whiteSpace: 'nowrap' });
const btnMic = (s, extra = {}) => ({ ...s.btnSecondary, padding: '5px 11px', fontSize: '0.78rem', ...extra });
const linkBtn = { fontSize: '0.78rem', color: '#1565c0', textDecoration: 'underline', background: 'none', border: 'none', cursor: 'pointer', padding: 0, fontFamily: 'var(--font-body)' };

// ═════════════════════════════════════════════════════════════════════════════
// „📄 Făcut după PDF-ul" — în Admin → 🧩 Exerciții Interactive (încărcarea unui test)
// ═════════════════════════════════════════════════════════════════════════════
// `value` = { id, title, din: 'agent' | 'titlu' | 'manual' | null, scor? }. PDF-ul se alege SINGUR
// după titlu când potrivirea e sigură (și adminul n-a ales el altceva); de la agentul Claude vine
// PDF-ul-model. După încărcare, Admin.jsx → UploadInteractive cere asocierea (content-admin).
export function AlegePdfSursa({ s, form, value, onChange }) {
  const [pdfs, setPdfs] = useState(null);
  const [cauta, setCauta] = useState('');
  useEffect(() => {
    let viu = true;
    setPdfs(null);
    if (!form.category) { setPdfs([]); return undefined; }
    supabase.from('content').select('id, title, category, subcategory, profile, content_type, file_url, is_free, interactiv_id, created_at')
      .eq('category', form.category).eq('content_type', 'pdf')
      .order('created_at', { ascending: false }).range(0, 1999)
      .then(({ data }) => { if (viu) setPdfs((data || []).filter((r) => !esteBarem(r))); }, () => { if (viu) setPdfs([]); });
    return () => { viu = false; };
  }, [form.category]);

  const cand = useMemo(() => (pdfs || []).filter((p) => profilCompatibil(form.profile || null, p.profile || null)), [pdfs, form.profile]);
  const testul = { title: form.title || '', category: form.category, profile: form.profile || null };
  const prop = useMemo(() => (String(form.title || '').trim().length >= 3 && cand.length ? propunePdf(testul, cand) : null),
    [form.title, form.category, form.profile, cand]); // eslint-disable-line react-hooks/exhaustive-deps

  // alegerea automată după titlu — doar cât adminul n-a ales el și nu vine PDF-ul-model de la agent
  useEffect(() => {
    if (value.din === 'manual' || value.din === 'agent') return;
    const a = prop && prop.nivel === 'sigur' ? prop.alesul : null;
    if (a) {
      if (a.row.id !== value.id) onChange({ id: a.row.id, title: a.row.title || '', din: 'titlu', scor: a.scor });
    } else if (value.din === 'titlu') {
      onChange({ id: '', title: '', din: null });   // alt titlu / altă categorie: alegerea nu mai e sigură
    }
  }, [prop]); // eslint-disable-line react-hooks/exhaustive-deps

  const ales = value.id ? cand.find((p) => p.id === value.id) || null : null;
  const dinAltaParte = !!value.id && pdfs !== null && !ales;
  const q = fold(cauta.trim());
  const potrivite = (prop ? prop.lista : []).filter((x) => x.scor >= 0.3).slice(0, 5).map((x) => x.row);
  const idPotrivite = new Set(potrivite.map((p) => p.id));
  const restul = cand.filter((p) => !idPotrivite.has(p.id) && (!q || fold(p.title).includes(q))).sort(titluNat);
  const sugestie = prop && prop.nivel === 'probabil' && prop.alesul && prop.alesul.row.id !== value.id ? prop.alesul : null;
  const eticheta = (p) => `${p.title}${p.subcategory && hasSubcategories(p.category) ? ` — ${subcategoryLabel(p.category, p.subcategory)}` : ''}${p.profile ? ` · ${profileLabel(p.profile)}` : ''}${p.interactiv_id ? ' · are deja test' : ''}`;

  return (
    <div style={s.formGroup} data-alege-pdf-sursa>
      <label style={s.label}>📄 Făcut după PDF-ul (se asociază singur)</label>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <select style={{ ...s.select, flex: '1 1 260px', width: 'auto' }} value={value.id || ''} aria-label="PDF-ul după care e făcut testul"
          onChange={(e) => { const p = cand.find((x) => x.id === e.target.value); onChange({ id: e.target.value, title: p ? p.title || '' : '', din: 'manual' }); }}>
          <option value="">{pdfs === null ? 'Se încarcă PDF-urile…' : '— nefăcut după un PDF (ex. test combinat) —'}</option>
          {dinAltaParte && <option value={value.id}>{value.title || 'PDF-ul ales'} (din altă categorie / alt profil)</option>}
          {potrivite.length > 0 && (
            <optgroup label="Potrivite după titlu">
              {potrivite.map((p) => <option key={p.id} value={p.id}>{eticheta(p)}</option>)}
            </optgroup>
          )}
          {restul.length > 0 && (
            <optgroup label={q ? `PDF-urile care conțin „${cauta.trim()}"` : 'Toate PDF-urile categoriei'}>
              {restul.map((p) => <option key={p.id} value={p.id}>{eticheta(p)}</option>)}
            </optgroup>
          )}
        </select>
        <input style={{ ...s.input, flex: '0 1 200px', width: 'auto' }} value={cauta} placeholder="🔍 filtrează PDF-urile"
          aria-label="Filtrează PDF-urile" onChange={(e) => setCauta(e.target.value)} />
      </div>
      <div style={{ ...mic, marginTop: 6 }}>
        {value.din === 'agent' && value.id && !dinAltaParte && <div>📎 PDF-ul-model din agentul Claude — testul se asociază cu el la încărcare.</div>}
        {value.din === 'titlu' && value.id && <div data-ales-automat>🤖 Ales automat după titlu (potrivire {procent(value.scor)}). Schimbă-l dacă nu e PDF-ul după care e făcut testul.</div>}
        {sugestie && (
          <div>
            💡 Pare făcut după „{sugestie.row.title}" ({procent(sugestie.scor)}).{' '}
            <button type="button" style={linkBtn} onClick={() => onChange({ id: sugestie.row.id, title: sugestie.row.title || '', din: 'manual' })}>Alege-l</button>
          </div>
        )}
        {dinAltaParte && <div style={{ color: '#b26a00', fontWeight: 600 }}>⚠️ PDF-ul ales nu e în categoria / profilul testului — alege categoria lui, altfel testul nu se poate asocia.</div>}
        {ales && ales.interactiv_id && <div>PDF-ul are deja un test interactiv principal: testul nou se adaugă lângă el (principalul îl schimbi din 🔗 PDF ↔ Interactiv).</div>}
        {!ales && !dinAltaParte && <div>Testul ales aici devine testul interactiv al PDF-ului („🧩 Deschide interactiv" pe cardul PDF-ului), dacă PDF-ul n-are deja unul.</div>}
      </div>
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// Alegerea perechii (testul unui PDF / PDF-ul unui test), deschisă sub rând
// ═════════════════════════════════════════════════════════════════════════════
function AlegePereche({ s, rand, tip, date, onAlege, onInchide, busy }) {
  const [cauta, setCauta] = useState('');
  const [alesId, setAlesId] = useState('');
  const pdfDupaId = useMemo(() => new Map(date.pdfs.map((p) => [p.id, p])), [date.pdfs]);
  const pentruPdf = tip === 'pdf';
  const cand = useMemo(() => (pentruPdf
    ? date.teste.filter((t) => compatibili(t, rand))
    : date.pdfs.filter((p) => compatibili(rand, p))), [date, rand, pentruPdf]);
  const potrivite = useMemo(() => clasament(rand.title, cand).filter((x) => x.scor >= 0.3).slice(0, 6).map((x) => x.row), [cand, rand.title]);
  const q = fold(cauta.trim());
  const filtrat = (lista) => lista.filter((r) => !q || fold(r.title).includes(q));
  const grupuri = useMemo(() => {
    const vazut = new Set();
    const ia = (lista) => lista.filter((r) => !vazut.has(r.id) && vazut.add(r.id));
    if (pentruPdf) {
      return [
        ['Făcute după acest PDF', ia(cand.filter((t) => t.pdf_sursa_id === rand.id).sort(titluNat))],
        ['Potrivite după titlu', ia(potrivite)],
        ['Fără PDF', ia(cand.filter((t) => !t.pdf_sursa_id).sort(titluNat))],
        ['Făcute după alt PDF (se mută aici)', ia(cand.filter((t) => t.pdf_sursa_id && t.pdf_sursa_id !== rand.id).sort(titluNat))],
      ];
    }
    return [
      ['Potrivite după titlu', ia(potrivite)],
      ['Fără test interactiv', ia(cand.filter((p) => !p.interactiv_id).sort(ordineSite))],
      ['Cu test interactiv', ia(cand.filter((p) => p.interactiv_id).sort(ordineSite))],
    ];
  }, [cand, potrivite, pentruPdf, rand.id]);
  const ales = alesId ? cand.find((r) => r.id === alesId) || null : null;
  // la un test: devine principalul PDF-ului ales? (implicit da, dacă PDF-ul n-are încă unul)
  const [principal, setPrincipal] = useState(true);
  useEffect(() => { if (!pentruPdf && ales) setPrincipal(!ales.interactiv_id || ales.interactiv_id === rand.id); }, [alesId]); // eslint-disable-line react-hooks/exhaustive-deps
  const eticheta = (r) => (pentruPdf
    ? `${r.title}${r.is_free ? '' : ' · ⭐'}${r.pdf_sursa_id && r.pdf_sursa_id !== rand.id ? ` · acum după „${(pdfDupaId.get(r.pdf_sursa_id) || {}).title || 'alt PDF'}"` : ''}`
    : `${r.title}${r.subcategory && hasSubcategories(r.category) ? ` — ${subcategoryLabel(r.category, r.subcategory)}` : ''}${r.profile ? ` · ${profileLabel(r.profile)}` : ''}`);

  return (
    <div data-alege-pereche style={{ marginTop: 10, padding: 12, borderRadius: 10, background: '#f7f9fc', border: '1.5px solid #dde1e8' }}>
      <div style={{ ...mic, fontWeight: 700, color: 'var(--navy)', marginBottom: 6 }}>
        {pentruPdf ? '🧩 Testul interactiv generat după acest PDF' : '📄 PDF-ul după care e făcut acest test'}
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <input style={{ ...s.input, flex: '1 1 180px', width: 'auto', padding: '8px 12px' }} value={cauta} autoFocus
          placeholder={pentruPdf ? '🔍 caută testul' : '🔍 caută PDF-ul'} onChange={(e) => setCauta(e.target.value)} aria-label="Caută" />
        <select style={{ ...s.select, flex: '2 1 260px', width: 'auto', padding: '8px 12px' }} value={alesId} onChange={(e) => setAlesId(e.target.value)}
          aria-label={pentruPdf ? 'Alege testul interactiv' : 'Alege PDF-ul'}>
          <option value="">{cand.length ? (pentruPdf ? `— alege testul (${cand.length} în categorie) —` : `— alege PDF-ul (${cand.length} în categorie) —`) : 'Nu există niciunul în aceeași categorie'}</option>
          {grupuri.map(([nume, lista]) => {
            const l = filtrat(lista);
            return l.length ? (
              <optgroup key={nume} label={nume}>
                {l.map((r) => <option key={r.id} value={r.id}>{eticheta(r)}</option>)}
              </optgroup>
            ) : null;
          })}
        </select>
      </div>
      {!pentruPdf && ales && (
        <label style={{ ...mic, display: 'flex', alignItems: 'center', gap: 6, marginTop: 8, cursor: 'pointer' }}>
          <input type="checkbox" checked={principal} onChange={(e) => setPrincipal(e.target.checked)} />
          E testul principal al PDF-ului (îl deschide „🧩 Deschide interactiv")
          {ales.interactiv_id && ales.interactiv_id !== rand.id ? ' — PDF-ul are acum alt test principal' : ''}
        </label>
      )}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
        <button type="button" style={{ ...s.btnPrimary, padding: '7px 16px', fontSize: '0.84rem', opacity: ales && !busy ? 1 : 0.55 }} disabled={!ales || !!busy}
          onClick={() => onAlege(ales, pentruPdf ? 'da' : (principal ? 'da' : 'daca-lipseste'))}>
          {busy ? 'Se salvează…' : '🔗 Asociază'}
        </button>
        <button type="button" style={btnMic(s)} onClick={onInchide}>Renunță</button>
      </div>
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// Fila „🔗 PDF ↔ Interactiv"
// ═════════════════════════════════════════════════════════════════════════════
const PAS = 40;
export default function AdminPdfInteractiv({ s }) {
  const [date, setDate] = useState(null);         // { pdfs, teste, jurnal }
  const [eroareInc, setEroareInc] = useState(null);
  const [vedere, setVedere] = useState('pdf');     // 'pdf' | 'teste'
  const [filtru, setFiltru] = useState({ category: '', subcategory: '', profile: '', stare: '', q: '' });
  const [limita, setLimita] = useState(PAS);
  const [deschis, setDeschis] = useState(null);    // rândul cu alegerea deschisă
  const [busy, setBusy] = useState(null);          // rândul în lucru
  const [mesaj, setMesaj] = useState(null);        // { tip: 'success' | 'error', text }
  const [auto, setAuto] = useState(null);          // { lista, bifate: Set, gata? }
  const [aplic, setAplic] = useState(null);        // progresul „Asociază bifatele"

  async function incarca() {
    setEroareInc(null);
    try { setDate(await apiPost('/api/content-admin', { action: 'perechi' })); }
    catch (e) { setEroareInc(e.message); }
  }
  useEffect(() => { incarca(); }, []);
  useEffect(() => { setLimita(PAS); setDeschis(null); }, [vedere, filtru]);

  const idx = useMemo(() => {
    if (!date) return null;
    const pdfDupaId = new Map(date.pdfs.map((p) => [p.id, p]));
    const testDupaId = new Map(date.teste.map((t) => [t.id, t]));
    const testeDupaPdf = new Map();
    for (const t of date.teste) {
      if (!t.pdf_sursa_id) continue;
      if (!testeDupaPdf.has(t.pdf_sursa_id)) testeDupaPdf.set(t.pdf_sursa_id, []);
      testeDupaPdf.get(t.pdf_sursa_id).push(t);
    }
    return { pdfDupaId, testDupaId, testeDupaPdf };
  }, [date]);

  // rândurile întoarse de server (PDF-ul, testul, PDF-ul de dinainte) iau locul celor vechi
  function aplicaRanduri(rows) {
    const noi = new Map((rows || []).filter(Boolean).map((r) => [r.id, r]));
    if (!noi.size) return;
    setDate((d) => ({
      ...d,
      pdfs: d.pdfs.map((p) => (noi.has(p.id) ? { ...p, ...noi.get(p.id) } : p)),
      teste: d.teste.map((t) => (noi.has(t.id) ? { ...t, ...noi.get(t.id) } : t)),
    }));
  }

  async function asociaza(pdf, test, principal, randId) {
    setBusy(randId); setMesaj(null);
    try {
      const r = await apiPost('/api/content-admin', { action: 'asociaza', pdfId: pdf.id, testId: test.id, principal });
      aplicaRanduri([r.pdf, r.test, r.vechi]);
      setDeschis(null);
      setMesaj({ tip: 'success', text: `✓ „${r.test.title}" e făcut după PDF-ul „${r.pdf.title}"${r.principal ? ' — e testul lui principal („🧩 Deschide interactiv")' : ' (PDF-ul își păstrează testul principal)'}.${r.vechi ? ` Nu mai e legat de „${r.vechi.title}".` : ''}` });
    } catch (e) { setMesaj({ tip: 'error', text: `Asocierea n-a reușit: ${e.message}` }); }
    finally { setBusy(null); }
  }
  async function dezleaga(pdf, test, randId) {
    if (!window.confirm(`Desfaci legătura dintre PDF-ul „${pdf.title}" și testul „${test.title}"?\n\nPe site, cardul PDF-ului nu mai deschide acest test.`)) return;
    setBusy(randId); setMesaj(null);
    try {
      const r = await apiPost('/api/content-admin', { action: 'dezleaga', pdfId: pdf.id, testId: test.id });
      aplicaRanduri([r.pdf, r.test]);
      const alt = r.altPrincipal && idx ? idx.testDupaId.get(r.altPrincipal) : null;
      setMesaj({ tip: 'success', text: `✓ Legătura „${pdf.title}" ↔ „${test.title}" a fost scoasă.${alt ? ` PDF-ul deschide acum celălalt test făcut după el: „${alt.title}".` : ''}` });
    } catch (e) { setMesaj({ tip: 'error', text: `Legătura n-a putut fi scoasă: ${e.message}` }); }
    finally { setBusy(null); }
  }

  // ─── 🤖 Asociază automat ───────────────────────────────────────────────────
  function deschideAuto() {
    if (!date) return;
    const lista = propuneri({ pdfs: date.pdfs, teste: date.teste, jurnal: date.jurnal || {} });
    setAuto({ lista, bifate: new Set(lista.filter((p) => p.nivel === 'sigur').map((p) => p.testId)) });
  }
  async function aplicaAuto() {
    const alese = auto.lista.filter((p) => auto.bifate.has(p.testId));
    if (!alese.length) return;
    setAplic({ facute: 0, total: alese.length, erori: [] });
    let facute = 0;
    const erori = [];
    for (let i = 0; i < alese.length; i += 25) {
      const lot = alese.slice(i, i + 25).map((p) => ({ pdfId: p.pdfId, testId: p.testId }));
      try {
        const r = await apiPost('/api/content-admin', { action: 'asociaza_lot', perechi: lot });
        const rows = [];
        for (const x of r.rezultate || []) {
          if (x.ok) { facute += 1; rows.push(x.pdf, x.test, x.vechi); } else erori.push(x.eroare || (x.sarit ? 'testul fusese legat între timp de alt PDF' : 'eroare'));
        }
        aplicaRanduri(rows);
      } catch (e) { erori.push(e.message); }
      setAplic({ facute, total: alese.length, erori: [...erori] });
    }
    setAuto(null);
    setAplic(null);
    setMesaj({ tip: erori.length ? 'error' : 'success', text: `🤖 ${ePrea(facute, 'asociere făcută', 'asocieri făcute')}${erori.length ? ` · ${ePrea(erori.length, 'nereușită', 'nereușite')}: ${[...new Set(erori)].slice(0, 3).join('; ')}` : ''}.` });
  }

  if (eroareInc) {
    return (
      <div style={s.card}>
        <div style={s.cardTitle}>🔗 PDF ↔ Test interactiv</div>
        <div style={s.alert('error')}>⚠️ Nu am putut încărca legăturile: {eroareInc}</div>
        <button style={s.btnSecondary} onClick={incarca}>↻ Încearcă din nou</button>
      </div>
    );
  }
  if (!date || !idx) {
    return (
      <div style={s.card}>
        <div style={s.cardTitle}>🔗 PDF ↔ Test interactiv</div>
        <div style={{ textAlign: 'center', padding: 40, color: '#8e95a3' }}>Se încarcă PDF-urile și testele…</div>
      </div>
    );
  }

  // ─── cifrele ───────────────────────────────────────────────────────────────
  const areTest = (p) => !!p.interactiv_id || idx.testeDupaPdf.has(p.id);
  const jurnal = date.jurnal || {};
  const combinat = (t) => !!(jurnal[t.id] && jurnal[t.id].combinat);
  const nPdfCu = date.pdfs.filter(areTest).length;
  const testeFara = date.teste.filter((t) => !t.pdf_sursa_id);
  const nCombinate = testeFara.filter(combinat).length;
  // PDF-urile fără test, pe rubrici (ce mai e de generat)
  const faraPeRubrici = (() => {
    const m = new Map();
    for (const p of date.pdfs) {
      if (areTest(p)) continue;
      const k = `${p.category}|${p.subcategory || ''}`;
      m.set(k, { cat: p.category, sub: p.subcategory, n: ((m.get(k) || {}).n || 0) + 1 });
    }
    return [...m.values()].sort((a, b) => b.n - a.n);
  })();

  // ─── lista filtrată ───────────────────────────────────────────────────────
  const q = fold(filtru.q.trim());
  const potriveste = (r) => (!filtru.category || r.category === filtru.category)
    && (!filtru.subcategory || (r.subcategory || '') === filtru.subcategory)
    && (!filtru.profile || r.profile === filtru.profile)
    && (!q || fold(r.title).includes(q));
  const lista = vedere === 'pdf'
    ? date.pdfs.filter((p) => potriveste(p) && (!filtru.stare || (filtru.stare === 'cu' ? areTest(p) : !areTest(p)))).sort(ordineSite)
    : date.teste.filter((t) => potriveste(t) && (!filtru.stare || (filtru.stare === 'cu' ? !!t.pdf_sursa_id : !t.pdf_sursa_id))).sort(ordineSite);
  const subcats = filtru.category ? subcategoriesFor(filtru.category).filter((x) => (vedere === 'pdf' ? x.value !== 'bareme' && x.value !== 'teste-interactive' : true)) : [];
  const testeLibere = date.teste.filter((t) => !t.pdf_sursa_id && !combinat(t));
  const tab = (activ) => ({
    ...s.btnSecondary, padding: '7px 14px', fontSize: '0.84rem',
    background: activ ? 'var(--navy)' : '#f0f4f8', color: activ ? '#fff' : 'var(--navy)', borderColor: activ ? 'var(--navy)' : '#dde1e8',
  });

  return (
    <div style={s.card} data-admin-pdf-interactiv>
      <div style={{ ...s.cardTitle, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <span>🔗 PDF ↔ Test interactiv</span>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <button type="button" style={{ ...s.btnPrimary, padding: '8px 16px', fontSize: '0.85rem' }} onClick={deschideAuto} data-asociaza-automat>🤖 Asociază automat</button>
          <button type="button" style={btnMic(s, { padding: '8px 12px' })} onClick={incarca} title="Reîncarcă legăturile din bază">↻</button>
        </div>
      </div>

      <div style={s.infoBox}>
        Leagă fiecare PDF de testul interactiv generat după el. Pe site, cardul PDF-ului primește <b>„🧩 Deschide interactiv"</b>,
        vizualizatorul — metoda <b>„🧩 Interactiv"</b> din „✏️ Rezolvă", iar cardul testului — <b>„📄 PDF"</b>; punctajul se cumulează între ele.
        Testele generate de acum înainte după un PDF se asociază <b>singure</b>: task-urile „pe rând" ale agentului Claude, agentul Claude
        cu un PDF de pe site ca model (→ «Adaugă Interactiv») și încărcarea din «🧩 Exerciții Interactive», unde PDF-ul se alege după titlu.
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14 }} data-cifre>
        <span style={chip('#e3f2fd', '#1565c0')}>📄 {nPdfCu} din {date.pdfs.length} PDF-uri au test interactiv</span>
        <span style={chip('#f3e5f5', '#6a1b9a')}>🧩 {date.teste.length - testeFara.length} din {date.teste.length} teste au PDF-ul lor</span>
        {testeFara.length > 0 && <span style={chip('#fff3e0', '#b26a00')}>{ePrea(testeFara.length, 'test fără PDF', 'teste fără PDF')}{nCombinate ? ` (${combinate(nCombinate)} din mai multe teste)` : ''}</span>}
      </div>

      {mesaj && (
        <div style={{ ...s.alert(mesaj.tip), display: 'flex', justifyContent: 'space-between', gap: 10 }} role="status">
          <span>{mesaj.text}</span>
          <button type="button" onClick={() => setMesaj(null)} aria-label="Închide mesajul" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'inherit', fontWeight: 700 }}>✕</button>
        </div>
      )}

      {/* 🤖 propunerile asocierii automate */}
      {auto && (
        <div data-propuneri style={{ border: '2px solid var(--gold)', borderRadius: 12, padding: 14, marginBottom: 16, background: '#fffdf5' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
            <b style={{ color: 'var(--navy)' }}>
              🤖 Asociere automată — {auto.lista.length
                ? `${ePrea(auto.lista.length, 'propunere', 'propuneri')} (${auto.lista.filter((p) => p.nivel === 'sigur').length} sigure, ${auto.lista.filter((p) => p.nivel !== 'sigur').length} de verificat)`
                : 'nicio propunere'}
            </b>
            <button type="button" style={btnMic(s)} onClick={() => setAuto(null)} disabled={!!aplic}>Închide</button>
          </div>
          {auto.lista.length === 0 ? (
            <div style={mic}>
              Nimic de asociat automat acum: testele generate după un PDF au deja PDF-ul lor.
              {testeFara.length > 0 && ` Rămân fără PDF ${ePrea(testeFara.length, 'test', 'teste')}${nCombinate ? `, dintre care ${combinate(nCombinate)} din mai multe teste (jurnalul generatorului)` : ''} — pe celelalte le poți lega de mână, din fila „🧩 Teste interactive".`}
              {faraPeRubrici.length > 0 && ` PDF-urile fără test (${date.pdfs.length - nPdfCu}) n-au încă un test generat după ele.`}
            </div>
          ) : (
            <>
              <div style={{ ...mic, marginBottom: 8 }}>Cele sigure sunt bifate. Un test primește PDF-ul bifat; devine testul principal al PDF-ului doar dacă PDF-ul n-are deja unul.</div>
              <div style={{ maxHeight: 360, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 6 }}>
                {auto.lista.map((p) => {
                  const t = idx.testDupaId.get(p.testId);
                  const pdf = idx.pdfDupaId.get(p.pdfId);
                  if (!t || !pdf) return null;
                  const bifat = auto.bifate.has(p.testId);
                  return (
                    <label key={p.testId} data-propunere={p.nivel} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', padding: '8px 10px', borderRadius: 8, background: '#fff', border: '1px solid #eef0f4', cursor: 'pointer' }}>
                      <input type="checkbox" checked={bifat} disabled={!!aplic} style={{ marginTop: 3 }}
                        onChange={() => setAuto((a) => { const b = new Set(a.bifate); if (b.has(p.testId)) b.delete(p.testId); else b.add(p.testId); return { ...a, bifate: b }; })} />
                      <span style={{ fontSize: '0.84rem', lineHeight: 1.45 }}>
                        🧩 <b>{t.title}</b> → 📄 <b>{pdf.title}</b>
                        <span style={{ display: 'block', ...mic }}>
                          {unde(pdf)} · {p.nivel === 'sigur' ? <span style={chip('#e8f5e9', '#2e7d32')}>✓ sigur</span> : <span style={chip('#fff3e0', '#b26a00')}>de verificat</span>}
                          {' '}{p.motiv === 'jurnal' ? 'jurnalul generatorului: făcut din acest PDF' : `după titlu (${procent(p.scor)})`}
                          {p.pdfAreTest ? ' · PDF-ul are deja test' : ''}
                        </span>
                      </span>
                    </label>
                  );
                })}
              </div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginTop: 10 }}>
                <button type="button" style={{ ...s.btnPrimary, opacity: auto.bifate.size && !aplic ? 1 : 0.55 }} disabled={!auto.bifate.size || !!aplic} onClick={aplicaAuto}>
                  {aplic ? `Se asociază… ${aplic.facute}/${aplic.total}` : `✓ Asociază bifatele (${auto.bifate.size})`}
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {/* vederile + filtrele */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
        <button type="button" style={tab(vedere === 'pdf')} onClick={() => setVedere('pdf')}>📄 PDF-uri ({date.pdfs.length})</button>
        <button type="button" style={tab(vedere === 'teste')} onClick={() => setVedere('teste')}>🧩 Teste interactive ({date.teste.length})</button>
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
        <select style={{ ...s.select, width: 'auto', flex: '1 1 170px' }} value={filtru.category} aria-label="Categoria"
          onChange={(e) => setFiltru((f) => ({ ...f, category: e.target.value, subcategory: '', profile: e.target.value === 'bacalaureat' ? f.profile : '' }))}>
          <option value="">Toate categoriile</option>
          {[...CATEGORIES].sort((a, b) => pozCat(a.value) - pozCat(b.value)).map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
        </select>
        {subcats.length > 0 && (
          <select style={{ ...s.select, width: 'auto', flex: '1 1 170px' }} value={filtru.subcategory} aria-label="Rubrica"
            onChange={(e) => setFiltru((f) => ({ ...f, subcategory: e.target.value }))}>
            <option value="">Toate rubricile</option>
            {subcats.map((x) => <option key={x.value} value={x.value}>{x.label}</option>)}
          </select>
        )}
        {filtru.category === 'bacalaureat' && (
          <select style={{ ...s.select, width: 'auto', flex: '1 1 150px' }} value={filtru.profile} aria-label="Profilul"
            onChange={(e) => setFiltru((f) => ({ ...f, profile: e.target.value }))}>
            <option value="">Toate profilurile</option>
            {BAC_PROFILES.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
          </select>
        )}
        <select style={{ ...s.select, width: 'auto', flex: '1 1 170px' }} value={filtru.stare} aria-label="Asocierea"
          onChange={(e) => setFiltru((f) => ({ ...f, stare: e.target.value }))}>
          <option value="">Asociate și neasociate</option>
          <option value="fara">{vedere === 'pdf' ? '⛓️‍💥 Fără test interactiv' : '⛓️‍💥 Fără PDF'}</option>
          <option value="cu">{vedere === 'pdf' ? '🔗 Cu test interactiv' : '🔗 Cu PDF'}</option>
        </select>
        <input style={{ ...s.input, width: 'auto', flex: '2 1 200px' }} value={filtru.q} placeholder="🔍 Caută după titlu" aria-label="Caută după titlu"
          onChange={(e) => setFiltru((f) => ({ ...f, q: e.target.value }))} />
      </div>

      {vedere === 'pdf' && filtru.stare === 'fara' && faraPeRubrici.length > 0 && (
        <div style={{ ...mic, marginBottom: 12, padding: '10px 12px', borderRadius: 8, background: '#fff8e1' }} data-fara-test>
          PDF-urile fără test interactiv, pe rubrici: {faraPeRubrici.slice(0, 8).map((r) => `${categoryLabel(r.cat)}${r.sub && hasSubcategories(r.cat) ? ` · ${subcategoryLabel(r.cat, r.sub)}` : ''} (${r.n})`).join(', ')}{faraPeRubrici.length > 8 ? ' …' : ''}.
          {' '}Testul lor se poate genera cu un task „pe rând" pe rubrica lor (🤖 Unelte AI → Agent Claude → 🗓 Task-uri programate) — fiecare test generat se asociază singur cu PDF-ul lui.
        </div>
      )}

      <div style={{ ...mic, marginBottom: 8 }}>{ePrea(lista.length, vedere === 'pdf' ? 'PDF' : 'test', vedere === 'pdf' ? 'PDF-uri' : 'teste')}</div>
      {lista.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 30, color: '#8e95a3' }}>Nimic pentru filtrele alese.</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {lista.slice(0, limita).map((r) => (vedere === 'pdf'
            ? <RandPdf key={r.id} s={s} pdf={r} idx={idx} date={date} testeLibere={testeLibere} deschis={deschis === r.id} busy={busy === r.id}
                onDeschide={() => setDeschis(deschis === r.id ? null : r.id)} onInchide={() => setDeschis(null)}
                onAsociaza={(test, principal) => asociaza(r, test, principal, r.id)} onDezleaga={(test) => dezleaga(r, test, r.id)} />
            : <RandTest key={r.id} s={s} test={r} idx={idx} date={date} jurnal={jurnal[r.id] || null} deschis={deschis === r.id} busy={busy === r.id}
                onDeschide={() => setDeschis(deschis === r.id ? null : r.id)} onInchide={() => setDeschis(null)}
                onAsociaza={(pdf, principal) => asociaza(pdf, r, principal, r.id)} onDezleaga={(pdf) => dezleaga(pdf, r, r.id)} />))}
        </div>
      )}
      {lista.length > limita && (
        <div style={{ textAlign: 'center', marginTop: 12 }}>
          <button type="button" style={s.btnSecondary} onClick={() => setLimita((n) => n + PAS * 2)}>Arată încă {Math.min(PAS * 2, lista.length - limita)} (din {lista.length - limita} rămase)</button>
        </div>
      )}
    </div>
  );
}

// ─── un PDF ─────────────────────────────────────────────────────────────────────
function RandPdf({ s, pdf, idx, date, testeLibere, deschis, busy, onDeschide, onInchide, onAsociaza, onDezleaga }) {
  const dupa = (idx.testeDupaPdf.get(pdf.id) || []).slice().sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));
  const principal = pdf.interactiv_id ? idx.testDupaId.get(pdf.interactiv_id) || { id: pdf.interactiv_id, title: '(test)' } : null;
  const alte = dupa.filter((t) => !principal || t.id !== principal.id);
  const fara = !principal && !alte.length;
  // propunerea pentru un PDF fără test: dintre testele fără PDF (necombinate)
  const prop = useMemo(() => (fara ? propuneTest(pdf, testeLibere) : null), [fara, pdf, testeLibere]);
  const sugestie = prop && prop.nivel && prop.alesul ? prop.alesul : null;
  return (
    <div data-rand-pdf={pdf.id} style={{ padding: '12px 14px', borderRadius: 10, border: `1.5px solid ${fara ? '#ffe0b2' : '#eef0f4'}`, background: '#fff' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, flexWrap: 'wrap' }}>
        <span aria-hidden="true">📄</span>
        <div style={{ flex: '1 1 220px', minWidth: 0 }}>
          <div style={{ fontWeight: 700, color: 'var(--navy)', fontSize: '0.9rem', overflowWrap: 'anywhere' }}>{pdf.title}</div>
          <div style={mic}>{unde(pdf)}</div>
        </div>
        <span style={chip(pdf.is_free ? '#e8f5e9' : '#fff3e0', pdf.is_free ? '#2e7d32' : '#e65100')}>{pdf.is_free ? 'Gratuit' : 'Premium'}</span>
      </div>
      <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 4 }}>
        {principal ? (
          <div style={{ ...mic, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span>🧩 Testul interactiv: <b style={{ color: 'var(--navy)' }}>„{principal.title}"</b>{principal.is_free === false ? ' ⭐' : ''}</span>
            <a href={`/exercitiu?id=${principal.id}`} target="_blank" rel="noopener noreferrer" style={linkBtn}>deschide</a>
            <button type="button" style={{ ...linkBtn, color: '#c62828' }} disabled={busy} onClick={() => onDezleaga(principal)}>✕ dezleagă</button>
          </div>
        ) : (
          <div style={{ ...mic, color: '#b26a00', fontWeight: 600 }}>⛓️‍💥 {alte.length ? 'Fără test principal' : 'Fără test interactiv'}</div>
        )}
        {alte.map((t) => (
          <div key={t.id} style={{ ...mic, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span>↳ alt test făcut după el: „{t.title}"{t.is_free ? ' (gratuit)' : ' ⭐'}</span>
            <a href={`/exercitiu?id=${t.id}`} target="_blank" rel="noopener noreferrer" style={linkBtn}>deschide</a>
            <button type="button" style={linkBtn} disabled={busy} onClick={() => onAsociaza(t, 'da')}>⭐ fă-l principal</button>
            <button type="button" style={{ ...linkBtn, color: '#c62828' }} disabled={busy} onClick={() => onDezleaga(t)}>✕ dezleagă</button>
          </div>
        ))}
        {sugestie && (
          <div style={{ ...mic, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }} data-sugestie>
            <span>💡 Pare făcut după el: „{sugestie.row.title}" ({procent(sugestie.scor)})</span>
            <button type="button" style={btnMic(s)} disabled={busy} onClick={() => onAsociaza(sugestie.row, 'da')}>✓ Asociază</button>
          </div>
        )}
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
        <a href={`/pdf-viewer?id=${pdf.id}`} target="_blank" rel="noopener noreferrer" style={{ ...btnMic(s), textDecoration: 'none', display: 'inline-block' }}>📄 Deschide PDF</a>
        <button type="button" style={btnMic(s, deschis ? { background: 'var(--navy)', color: '#fff', borderColor: 'var(--navy)' } : {})} onClick={onDeschide} aria-expanded={deschis}>
          🔗 {principal ? 'Schimbă testul' : 'Asociază un test'}
        </button>
      </div>
      {deschis && <AlegePereche s={s} rand={pdf} tip="pdf" date={date} busy={busy} onInchide={onInchide} onAlege={(t, principalNou) => onAsociaza(t, principalNou)} />}
    </div>
  );
}

// ─── un test interactiv ─────────────────────────────────────────────────────────
function RandTest({ s, test, idx, date, jurnal, deschis, busy, onDeschide, onInchide, onAsociaza, onDezleaga }) {
  const pdf = test.pdf_sursa_id ? idx.pdfDupaId.get(test.pdf_sursa_id) || null : null;
  const ePrincipal = !!pdf && pdf.interactiv_id === test.id;
  const principalPdf = pdf && pdf.interactiv_id && !ePrincipal ? idx.testDupaId.get(pdf.interactiv_id) : null;
  const combinat = !!(jurnal && jurnal.combinat);
  const prop = useMemo(() => (!test.pdf_sursa_id && !combinat ? propunePdf(test, date.pdfs) : null), [test, combinat, date.pdfs]);
  const sugestie = prop && prop.nivel && prop.alesul ? prop.alesul : null;
  const motivCombinat = combinat
    ? `🔀 combinat din ${jurnal.n ? ePrea(jurnal.n, jurnal.din === 'pdf' ? 'PDF' : 'material', jurnal.din === 'pdf' ? 'PDF-uri' : (jurnal.din === 'teste' ? 'teste interactive' : 'materiale')) : 'mai multe materiale'}${jurnal.task ? ` (task-ul „${jurnal.task}")` : ''} — nu e făcut după un singur PDF`
    : null;
  return (
    <div data-rand-test={test.id} style={{ padding: '12px 14px', borderRadius: 10, border: `1.5px solid ${!pdf && !combinat ? '#ffe0b2' : '#eef0f4'}`, background: '#fff' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, flexWrap: 'wrap' }}>
        <span aria-hidden="true">🧩</span>
        <div style={{ flex: '1 1 220px', minWidth: 0 }}>
          <div style={{ fontWeight: 700, color: 'var(--navy)', fontSize: '0.9rem', overflowWrap: 'anywhere' }}>{test.title}</div>
          <div style={mic}>{unde(test)}</div>
        </div>
        <span style={chip(test.is_free ? '#e8f5e9' : '#fff3e0', test.is_free ? '#2e7d32' : '#e65100')}>{test.is_free ? 'Gratuit' : 'Premium'}</span>
      </div>
      <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 4 }}>
        {pdf ? (
          <div style={{ ...mic, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span>📄 Făcut după PDF-ul <b style={{ color: 'var(--navy)' }}>„{pdf.title}"</b> · {ePrincipal ? 'testul lui principal' : `alt test (principalul e „${principalPdf ? principalPdf.title : '—'}")`}</span>
            <a href={`/pdf-viewer?id=${pdf.id}`} target="_blank" rel="noopener noreferrer" style={linkBtn}>deschide</a>
            {!ePrincipal && <button type="button" style={linkBtn} disabled={busy} onClick={() => onAsociaza(pdf, 'da')}>⭐ fă-l principal</button>}
            <button type="button" style={{ ...linkBtn, color: '#c62828' }} disabled={busy} onClick={() => onDezleaga(pdf)}>✕ dezleagă</button>
          </div>
        ) : (
          <div style={{ ...mic, color: combinat ? '#5a6170' : '#b26a00', fontWeight: combinat ? 400 : 600 }}>
            {combinat ? motivCombinat : '⛓️‍💥 Nefăcut după un PDF (sau încă neasociat)'}
          </div>
        )}
        {sugestie && (
          <div style={{ ...mic, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }} data-sugestie>
            <span>💡 Pare făcut după „{sugestie.row.title}" ({procent(sugestie.scor)})</span>
            <button type="button" style={btnMic(s)} disabled={busy} onClick={() => onAsociaza(sugestie.row, sugestie.row.interactiv_id ? 'daca-lipseste' : 'da')}>✓ Asociază</button>
          </div>
        )}
        {test.pdf_sursa_id && !pdf && <div style={{ ...mic, color: '#b26a00' }}>⚠️ Legat de un PDF care nu mai e în listă (barem sau șters).</div>}
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
        <a href={`/exercitiu?id=${test.id}`} target="_blank" rel="noopener noreferrer" style={{ ...btnMic(s), textDecoration: 'none', display: 'inline-block' }}>🧩 Deschide testul</a>
        <button type="button" style={btnMic(s, deschis ? { background: 'var(--navy)', color: '#fff', borderColor: 'var(--navy)' } : {})} onClick={onDeschide} aria-expanded={deschis}>
          🔗 {pdf ? 'Schimbă PDF-ul' : 'Alege PDF-ul'}
        </button>
      </div>
      {deschis && <AlegePereche s={s} rand={test} tip="test" date={date} busy={busy} onInchide={onInchide} onAlege={(p, principal) => onAsociaza(p, principal)} />}
    </div>
  );
}

// pentru teste: mesajul de incompatibilitate e același ca pe server
export { motivIncompatibil };
