// =====================================================================
// src/components/AIExerciseAgent.jsx — Agentul Claude de exerciții (admin)
// (1) Încarci FIȘIERUL 1 = exercițiile-model (PDF/HTML) și, opțional,
//     FIȘIERUL 2 = modelul de FORMAT (structura/baremul dorit la rezultat).
// (2) Scrii instrucțiuni în caseta de mesaj (stil Claude) — inclusiv
//     formatul de salvare dorit („salvează ca PDF” / „interactiv”).
// (3) Pe exercițiul generat: Trimite la «Adaugă PDF» / «Adaugă Interactiv»
//     (formularele existente din Admin, precompletate), descărcare pe
//     calculator (HTML sau PDF prin tipărire), Modifică, Șterge.
// =====================================================================
import { useState, useEffect, useRef } from 'react';
import { aiClient } from '../lib/aiClient';
import { supabase } from '../lib/supabase';
import { renderExercise, renderPrintDoc } from '../lib/exerciseRender';
import { authHeaders } from '../lib/api';
import { combineExamPdfs, fetchPdfSources, stratifyBySubcategory } from '../lib/pdfCombine';

const inp = { border: '1px solid var(--border)', borderRadius: 8, padding: '9px 11px', fontSize: '.9rem', width: '100%', marginTop: 4, boxSizing: 'border-box' };
const ta = { ...inp, fontFamily: 'inherit', resize: 'vertical' };
const lbl = { fontSize: '.82rem', color: 'var(--text-light)' };
const smallBtn = { background: '#f7f9fc', border: '1px solid var(--border)', borderRadius: 7, padding: '4px 9px', fontSize: '.78rem', cursor: 'pointer', fontWeight: 600 };

function slug(s) {
  return String(s || 'exercitiu').toLowerCase()
    .replace(/[ăâ]/g, 'a').replace(/î/g, 'i').replace(/[șş]/g, 's').replace(/[țţ]/g, 't')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'exercitiu';
}

export default function AIExerciseAgent({ box }) {
  // Fișierele-model + conversația
  const [modelFile, setModelFile] = useState(null);   // {name, pdf|null, text|null}
  const [formatFile, setFormatFile] = useState(null); // idem — modelul de FORMAT
  const [message, setMessage] = useState('');
  const [chat, setChat] = useState([]);
  const fileRef1 = useRef(null);
  const fileRef2 = useRef(null);

  // Exercițiul curent
  const [ex, setEx] = useState(null);
  const [exHtml, setExHtml] = useState(null); // rezultat HTML brut (clonă a șablonului)
  const [editing, setEditing] = useState(false);
  const [provider, setProvider] = useState(null);
  const [savedId, setSavedId] = useState(null);
  const [savedMeta, setSavedMeta] = useState(null); // metadatele rândului la re-editare
  const [savedList, setSavedList] = useState([]);

  // Alegere model din baza de date + automatizare pe rubrică
  const [picker, setPicker] = useState(null); // null | 'model' | 'format'
  const [pickerItems, setPickerItems] = useState([]);
  const [pickerSearch, setPickerSearch] = useState('');
  const [pickerBusy, setPickerBusy] = useState(false);
  const [rubrics, setRubrics] = useState([]);
  const [autoKey, setAutoKey] = useState('');
  const [autoInstr, setAutoInstr] = useState('');
  const [autoBusy, setAutoBusy] = useState(false);
  const [autoResult, setAutoResult] = useState('auto'); // auto | interactive | exam
  const [dataMode, setDataMode] = useState('modify');   // keep | modify
  const [combineMsg, setCombineMsg] = useState(null);

  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState(null);
  const [error, setError] = useState(null);

  async function loadSaved() {
    const { data } = await supabase
      .from('content')
      .select('id, title, category, description, is_free, created_at, interactive_data')
      .eq('content_type', 'interactive')
      .order('created_at', { ascending: false })
      .limit(60);
    setSavedList((data || []).filter((r) => r.interactive_data?.agent === 'claude'));
  }
  useEffect(() => { loadSaved(); }, []);

  // TOATE rubricile site-ului — taxonomie fixă (apar și cele fără fișiere încă),
  // cu profilurile BAC separate; numărul de materiale vine din baza de date.
  useEffect(() => {
    (async () => {
      // Supabase întoarce implicit maxim 1000 rânduri pe cerere — .limit(3000) NU
      // ocolește plafonul. Peste 1000 de materiale, rubrici întregi (ex. Variante
      // Date, Capitole) ieșeau cu „0 fișiere". Citim în pagini ca să numărăm TOT.
      const PAGE = 1000;
      let data = [];
      for (let from = 0; ; from += PAGE) {
        const { data: page, error } = await supabase.from('content')
          .select('category, subcategory, profile, content_type')
          .in('content_type', ['interactive', 'pdf'])
          .order('created_at', { ascending: false })
          .range(from, from + PAGE - 1);
        if (error) break;
        const rows = page || [];
        data = data.concat(rows);
        if (rows.length < PAGE) break;
      }
      // potrivire TOLERANTĂ a subcategoriilor (diacritice/spații/cratime diferite
      //  în datele mai vechi) — fișierele încărcate apar întotdeauna la numărătoare
      const normSub = (x) => String(x || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
      const counts = {};   // cheie normalizată → n
      const rawSeen = {};  // cheie normalizată → {category, subcategory brută, profile, ctype, n}
      (data || []).forEach((r) => {
        const k = `${r.category}||${normSub(r.subcategory)}||${r.profile || ''}||${r.content_type}`;
        counts[k] = (counts[k] || 0) + 1;
        rawSeen[k] = { category: r.category, subcategory: r.subcategory || null, profile: r.profile || null, ctype: r.content_type, n: counts[k] };
      });
      const consumed = new Set();
      const EN_SUBS = [
        ['exercitii-subiecte', 'Exerciții pe Subiecte'],
        ['variante', 'Variante Date + Modele'],
        ['simulari', 'Simulări'],
        ['capitole', 'Capitole cu exerciții'],
        ['simulari+variante', 'Simulări + Variante Date (mix)'],
        ['teste-interactive', 'Teste Interactive'],
      ];
      const BAC_SUBS = [
        ['exercitii', 'Exerciții pe Subiecte'],
        ['variante', 'Variante Date + Olimpici + Rezerve'],
        ['teste-antrenament', 'Teste de Antrenament'],
        ['simulari', 'Simulări'],
        ['capitole', 'Capitole cu exerciții'],
        ['teste-interactive', 'Teste Interactive'],
      ];
      const BAC_PROFILES = [['tehnologic', 'BAC Tehnologic'], ['stiinte-naturii', 'BAC Științele Naturii'], ['mate-info', 'BAC Mate-Info']];
      const list = [];
      const countFor = (category, sub, profile, ct) => {
        // „a+b” = rubrică-mix: adună fișierele din toate subcategoriile componente
        const subs = String(sub || '').split('+');
        let n = 0;
        for (const one of subs) {
          const k = `${category}||${normSub(one)}||${profile || ''}||${ct}`;
          n += counts[k] || 0;
          consumed.add(k);
        }
        return n;
      };
      const push = (group, label, category, sub, profile) => {
        for (const ct of ['pdf', 'interactive']) {
          const n = countFor(category, sub, profile, ct);
          list.push({ group, label: `${label} · ${ct === 'pdf' ? 'PDF' : 'interactiv'} (${n})`, category, subcategory: sub, profile: profile || null, ctype: ct, n });
        }
      };
      for (const [sub, lbl] of EN_SUBS) push('Evaluare Națională', lbl, 'evaluare-nationala', sub, null);
      for (const [prof, plbl] of BAC_PROFILES) for (const [sub, lbl] of BAC_SUBS) push(plbl, lbl, 'bacalaureat', sub, prof);
      for (const c of ['clasa-5', 'clasa-6', 'clasa-7', 'clasa-8']) push('Clase', c, c, null, null);
      // tot ce există în baza de date dar nu s-a potrivit taxonomiei — vizibil separat
      for (const [k, info] of Object.entries(rawSeen)) {
        if (consumed.has(k)) continue;
        list.push({
          group: 'Alte rubrici din baza de date',
          label: `${info.category}${info.subcategory ? ' / ' + info.subcategory : ' (fără subcategorie)'}${info.profile ? ' · ' + info.profile : ''} · ${info.ctype === 'pdf' ? 'PDF' : 'interactiv'} (${info.n})`,
          category: info.category, subcategory: info.subcategory, profile: info.profile, ctype: info.ctype, n: info.n,
        });
      }
      setRubrics(list);
    })();
  }, []);

  function openPicker(which) { setPicker(which); setPickerSearch(''); }

  // Căutare în TOATĂ baza de date (titlu, categorie, subcategorie) — server-side
  useEffect(() => {
    if (!picker) return;
    const t = setTimeout(async () => {
      const q = pickerSearch.trim().replace(/[%,()]/g, ' ').trim();
      let query = supabase.from('content')
        .select('id, title, category, subcategory, content_type')
        .order('created_at', { ascending: false }).limit(150);
      if (q.length >= 2) query = query.or(`title.ilike.%${q}%,category.ilike.%${q}%,subcategory.ilike.%${q}%`);
      const { data } = await query;
      setPickerItems(data || []);
    }, 300);
    return () => clearTimeout(t);
  }, [picker, pickerSearch]);

  async function pickFromDb(item) {
    setPickerBusy(true); setError(null);
    try {
      const r = await aiClient.exerciseAgent({ action: 'fetch-model', contentId: item.id });
      const slot = r.pdf
        ? { name: `${r.title}.pdf`, pdf: r.pdf, text: null }
        : { name: `${r.title}.html`, pdf: null, text: r.text || null, html: r.html || null };
      if (picker === 'format') setFormatFile(slot); else setModelFile(slot);
      setPicker(null);
    } catch (e) { setError(e.message); }
    finally { setPickerBusy(false); }
  }

  async function getUrlFor(row) {
    if (row.is_free) return row.file_url;
    const res = await fetch('/api/get-file-url', { method: 'POST', headers: await authHeaders(), body: JSON.stringify({ contentId: row.id }) });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(d.error || 'URL indisponibil');
    return d.url;
  }

  // COMBINARE EXACTĂ (vectorială, fără AI) din PDF-urile rubricii selectate:
  // exercițiile sunt decupate din fișierele-sursă și recompuse identic.
  async function combineExactRubric() {
    const r = rubrics.find((x) => `${x.category}||${x.subcategory || ''}||${x.profile || ''}||${x.ctype}` === autoKey);
    if (!r || r.ctype !== 'pdf') { setError('Alege o rubrică PDF pentru combinarea exactă.'); return; }
    setAutoBusy(true); setError(null); setMsg(null); setCombineMsg('Caut subiectele rubricii…');
    try {
      let q = supabase.from('content').select('id, title, file_url, is_free, subcategory')
        .eq('content_type', 'pdf').eq('category', r.category).limit(60);
      if (r.subcategory && String(r.subcategory).includes('+')) q = q.in('subcategory', String(r.subcategory).split('+'));
      else if (r.subcategory) q = q.eq('subcategory', r.subcategory);
      if (r.profile) q = q.eq('profile', r.profile);
      const { data } = await q;
      const rows = (data || []).filter((x) => (x.subcategory || '') !== 'bareme');
      if (rows.length < 2) throw new Error('Rubrica are prea puține PDF-uri pentru combinare (minim 2).');
      // stratificat: un subiect din fiecare subcategorie (ex: Simulări + Variante Date)
      const sources = await fetchPdfSources(stratifyBySubcategory(rows), getUrlFor, { max: 5, onProgress: setCombineMsg, ordered: true });
      if (sources.length < 2) throw new Error('Nu am putut descărca suficiente subiecte-sursă.');
      const res = await combineExamPdfs(sources, { onProgress: setCombineMsg });
      const blob = new Blob([res.bytes], { type: 'application/pdf' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `subiect_combinat_${slug(r.category + (r.subcategory ? '-' + r.subcategory : ''))}.pdf`;
      a.click(); URL.revokeObjectURL(a.href);
      // salvăm subiectul combinat exact și în „Testele și exercițiile mele"
      // (PDF-ul merge în Storage — base64 în tabel era respins de API la >~1 MB)
      let savedNote = '';
      try {
        await aiClient.savePdfLibraryItem({
          title: `Subiect combinat · ${r.category}${r.subcategory ? ' / ' + r.subcategory : ''}`,
          category: r.category, blob, sources: res.sources,
        });
        savedNote = ' Salvat și în „Testele și exercițiile mele".';
      } catch (e) { savedNote = ' (Nu s-a putut salva în „Testele și exercițiile mele": ' + (e?.message || 'eroare') + ')'; }
      setCombineMsg('✅ PDF combinat descărcat (redactare identică, fără AI). Îl poți verifica și încărca manual unde vrei, prin «Adaugă PDF».' + savedNote);
      setChat((c) => [...c, { role: 'assistant', content: `📎 Combinare exactă pentru „${r.category}${r.subcategory ? ' / ' + r.subcategory : ''}”: ${res.report.length} exerciții preluate identic din: ${res.sources.join('; ')}.` }]);
    } catch (e) { setError(e.message); setCombineMsg(null); }
    finally { setAutoBusy(false); }
  }

  async function runAuto() {
    const r = rubrics.find((x) => `${x.category}||${x.subcategory || ''}||${x.profile || ''}||${x.ctype}` === autoKey);
    if (!r) { setError('Alege rubrica pentru automatizare.'); return; }
    setAutoBusy(true); setError(null); setMsg(null);
    try {
      const resp = await aiClient.exerciseAgent({ action: 'auto', category: r.category, subcategory: r.subcategory, profile: r.profile, ctype: r.ctype, instructions: autoInstr, resultKind: autoResult, dataMode });
      setProvider(resp.provider);
      setEditing(false); setSavedId(null); setSavedMeta(null);
      const rubEt = `${r.category}${r.subcategory ? ' / ' + r.subcategory : ''}`;
      if (resp.html) {
        // FORMATUL STANDARD (interactiv Claude): figuri + instrumente de desen
        setExHtml(resp.html); setEx(null);
        setChat((c) => [...c, { role: 'assistant', content: `⚙️ Test automat pentru „${rubEt}” în FORMATUL STANDARD (șablon: ${resp.template || 'test al rubricii'}) — combinat din: ${(resp.combinedFrom || []).join('; ')}. Testează-l în previzualizare și trimite-l la «Adaugă Interactiv».` }]);
      } else {
        setEx(resp.exercise); setExHtml(null);
        setChat((c) => [...c, { role: 'assistant', content: `⚙️ Test automat pentru „${rubEt}”: „${resp.exercise.title}” — combinat din: ${(resp.combinedFrom || []).join('; ')}. Verifică-l, apoi trimite-l la «Adaugă PDF» sau «Adaugă Interactiv».` }]);
      }
    } catch (e) { setError(e.message); }
    finally { setAutoBusy(false); }
  }

  // ── Fișierele-model (PDF sau HTML) ─────────────────────────────────
  async function onFile(f, setFileState, ref) {
    setError(null);
    if (!f) return;
    if (f.size > 3 * 1024 * 1024) { setError('Fișierul e prea mare (max 3 MB).'); return; }
    if (/\.pdf$/i.test(f.name)) {
      const b64 = await new Promise((resolve, reject) => {
        const fr = new FileReader();
        fr.onload = () => resolve(String(fr.result).split(',')[1] || '');
        fr.onerror = reject;
        fr.readAsDataURL(f);
      });
      setFileState({ name: f.name, pdf: b64, text: null });
    } else if (/\.html?$/i.test(f.name)) {
      const raw = await f.text();
      let text = raw;
      try { text = new DOMParser().parseFromString(raw, 'text/html').body?.innerText || raw; } catch { /* raw */ }
      // păstrăm și sursa brută: la slotul de FORMAT ea permite clonarea 1:1
      setFileState({ name: f.name, pdf: null, text: text.slice(0, 20000), html: raw.slice(0, 70000) });
    } else {
      setError('Acceptăm doar fișiere PDF sau HTML.');
    }
    if (ref?.current) ref.current.value = '';
  }

  function FileSlot({ title, hint, file, setFile, refEl, icon, onPick }) {
    return (
      <div style={{ flex: 1, minWidth: 240, border: '2px dashed var(--border)', borderRadius: 12, padding: 12 }}>
        <div style={{ fontSize: '.8rem', fontWeight: 700, color: 'var(--navy)', marginBottom: 6 }}>{title}</div>
        <input ref={refEl} type="file" accept=".pdf,.html,.htm" style={{ display: 'none' }}
          onChange={(e) => onFile(e.target.files?.[0], setFile, refEl)} />
        {file ? (
          <div style={{ fontSize: '.85rem', color: 'var(--navy)', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            {file.pdf ? '📕' : '📄'} {file.name}
            <button onClick={() => setFile(null)} style={{ ...smallBtn, color: '#c0392b', borderColor: '#f5c6cb' }}>✕ scoate</button>
          </div>
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <button className="btn btn-outline" onClick={() => refEl.current?.click()} style={{ fontSize: '.82rem' }}>{icon} Alege fișier</button>
            <button className="btn btn-outline" onClick={onPick} style={{ fontSize: '.82rem' }}>📚 Din baza de date</button>
            <span style={{ fontSize: '.75rem', color: 'var(--text-muted)' }}>{hint}</span>
          </div>
        )}
      </div>
    );
  }

  // ── Generare / conversație ─────────────────────────────────────────
  async function generate() {
    const text = message.trim();
    if (!modelFile && !formatFile && !text && !ex && !exHtml) { setError('Încarcă un fișier-model sau scrie instrucțiuni.'); return; }
    setLoading(true); setError(null); setMsg(null);
    try {
      const r = await aiClient.exerciseAgent({
        instructions: text,
        dataMode,
        model: ex ? JSON.stringify(ex) : (modelFile?.text || null),
        modelPdf: modelFile?.pdf || null,
        formatText: formatFile?.text || null,
        formatPdf: formatFile?.pdf || null,
        // șablon HTML → agentul clonează EXACT fișierul de format;
        // la iterații, șablonul devine rezultatul curent
        formatHtml: formatFile?.html || null,
        currentHtml: exHtml || null,
        history: chat.slice(-8),
      });
      setProvider(r.provider);
      setEditing(false); setSavedId(null); setSavedMeta(null);
      if (r.html) {
        setExHtml(r.html); setEx(null);
        const t = r.html.match(/<title>([^<]*)<\/title>/i)?.[1]?.trim() || 'Exercițiu în șablonul model';
        setChat((c) => [...c,
          ...(text ? [{ role: 'user', content: text }] : []),
          { role: 'assistant', content: `Am generat fișierul „${t}” exact în formatul șablonului (${Math.round(r.html.length / 1024)} KB). Îl poți testa în previzualizare, trimite la «Adaugă Interactiv», descărca sau modifica prin mesaje.` },
        ]);
      } else {
        setEx(r.exercise); setExHtml(null);
        const nItems = r.exercise.kind === 'etape' ? r.exercise.steps.length : r.exercise.questions.length;
        setChat((c) => [...c,
          ...(text ? [{ role: 'user', content: text }] : []),
          { role: 'assistant', content: `Am generat: „${r.exercise.title}” (${nItems} ${r.exercise.kind === 'etape' ? 'etape' : 'întrebări'}, barem ${totalOf(r.exercise)} p). Format sugerat: ${r.exercise.output === 'pdf' ? 'PDF' : 'interactiv'}. Îl poți trimite la «Adaugă PDF» / «Adaugă Interactiv», descărca sau modifica.` },
        ]);
      }
      setMessage('');
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }

  function totalOf(e) {
    const arr = e.kind === 'etape' ? e.steps : e.questions;
    return (arr || []).reduce((s, it) => s + (Number(it.points) || 0), 0);
  }

  // ── Editare completă ───────────────────────────────────────────────
  const items = ex ? (ex.kind === 'etape' ? ex.steps : ex.questions) || [] : [];
  const itemsKey = ex?.kind === 'etape' ? 'steps' : 'questions';
  const totalPoints = items.reduce((s, it) => s + (Number(it.points) || 0), 0);

  function patchEx(patch) { setEx((e) => ({ ...e, ...patch })); }
  function patchItem(i, patch) {
    setEx((e) => {
      const arr = [...(e[itemsKey] || [])];
      arr[i] = { ...arr[i], ...patch };
      return { ...e, [itemsKey]: arr };
    });
  }
  function addItem() {
    const blank = ex.kind === 'etape'
      ? { prompt: 'Etapă nouă — ce se cere?', answer: '', hint: '', explanation: '', points: 10 }
      : { statement: 'Întrebare nouă', options: ['', '', '', ''], answer: 0, hint: '', explanation: '', points: 10 };
    setEx((e) => ({ ...e, [itemsKey]: [...(e[itemsKey] || []), blank] }));
  }
  function delItem(i) { setEx((e) => ({ ...e, [itemsKey]: e[itemsKey].filter((_, j) => j !== i) })); }
  function moveItem(i, dir) {
    setEx((e) => {
      const arr = [...e[itemsKey]]; const j = i + dir;
      if (j < 0 || j >= arr.length) return e;
      [arr[i], arr[j]] = [arr[j], arr[i]];
      return { ...e, [itemsKey]: arr };
    });
  }
  function discard() {
    if (!window.confirm('Ștergi exercițiul generat? (fișierele-model și conversația rămân)')) return;
    setEx(null); setExHtml(null); setEditing(false); setSavedId(null); setSavedMeta(null); setMsg(null);
  }

  // ── Trimitere către formularele existente din Admin ────────────────
  function sendToInteractive() {
    sessionStorage.setItem('agent_prefill_interactive', JSON.stringify({
      form: { title: ex.title, description: `Generat cu agentul Claude · barem ${totalPoints} p`, type: 'exercise' },
      html: renderExercise(ex),
      fileName: `${slug(ex.title)}.html`,
    }));
    window.dispatchEvent(new CustomEvent('admin:goto-tab', { detail: 'interactive' }));
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  function sendToPdf() {
    openPrint(true); // întâi fereastra de tipărire (Salvează ca PDF), în același gest de click
    sessionStorage.setItem('agent_prefill_pdf', JSON.stringify({
      form: { title: ex.title, description: `Generat cu agentul Claude · barem ${totalPoints} p` },
    }));
    window.dispatchEvent(new CustomEvent('admin:goto-tab', { detail: 'pdf' }));
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  // ── Salvare pe calculator ──────────────────────────────────────────
  function downloadHtml() {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([renderExercise(ex)], { type: 'text/html' }));
    a.download = `${slug(ex.title)}.html`;
    a.click(); URL.revokeObjectURL(a.href);
  }
  function openPrint(withSolutions) {
    const w = window.open('', '_blank');
    if (!w) { setError('Browserul a blocat fereastra de tipărire — permite pop-up-urile.'); return; }
    w.document.write(renderPrintDoc(ex, { solutions: withSolutions, autoPrint: true }));
    w.document.close();
  }

  // ── Actualizarea unui exercițiu deja încărcat de agent ─────────────
  async function updateSaved() {
    if (!ex || !savedId || !savedMeta) return;
    setSaving(true); setError(null); setMsg(null);
    try {
      const html = renderExercise(ex);
      const bucket = savedMeta.is_free ? 'content-files-free' : 'content-files';
      const path = `interactive/${savedMeta.category}/${Date.now()}_agent_claude.html`;
      const { error: upErr } = await supabase.storage.from(bucket).upload(path, new Blob([html], { type: 'text/html' }), { contentType: 'text/html' });
      if (upErr) throw upErr;
      const { data: urlData } = supabase.storage.from(bucket).getPublicUrl(path);
      const { error: dbErr } = await supabase.from('content').update({
        title: ex.title, file_url: urlData?.publicUrl || path,
        interactive_data: { type: 'exercise', html: true, ai_generated: true, agent: 'claude', exercise: ex },
      }).eq('id', savedId);
      if (dbErr) throw dbErr;
      setMsg('✅ Exercițiu actualizat pe site.');
      loadSaved();
    } catch (e) { setError('Actualizare eșuată: ' + e.message); }
    finally { setSaving(false); }
  }

  function loadForEdit(row) {
    setEx(row.interactive_data.exercise);
    setSavedId(row.id); setSavedMeta({ category: row.category, is_free: !!row.is_free });
    setEditing(true); setMsg(null); setError(null);
  }

  return (
    <div style={{ ...box, marginTop: 18 }}>
      <h3 style={{ fontFamily: 'var(--font-display)', color: 'var(--navy)', marginBottom: 6 }}>
        🤖 Agent Claude — Generator de exerciții
      </h3>
      <p style={{ fontSize: '.85rem', color: 'var(--text-light)', marginBottom: 14 }}>
        Fișierul 1 = <strong>exercițiile-model</strong>; fișierul 2 (opțional) = <strong>modelul de format</strong>.
        Dacă fișierul 2 e HTML, rezultatul păstrează <strong>exact</strong> designul și funcționalitățile lui, doar cu exercițiile noi.
        Poți cere transformări: PDF → interactiv, interactiv → PDF, alte numere, alt tip.
        Formatul de salvare îl poți cere direct în mesaj („salvează ca PDF”).
        {provider && <span style={{ color: 'var(--text-muted)' }}> · model: {provider}</span>}
      </p>

      {/* 1. Fișierele-model */}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
        <FileSlot title="1 · Exercițiile-model (PDF / HTML)" hint="de aici ia exercițiile" icon="📎" file={modelFile} setFile={setModelFile} refEl={fileRef1} onPick={() => openPicker('model')} />
        <FileSlot title="2 · Modelul de format — opțional" hint="de aici ia structura/baremul" icon="🗂" file={formatFile} setFile={setFormatFile} refEl={fileRef2} onPick={() => openPicker('format')} />
      </div>

      {/* Automatizare: testul următor al unei rubrici, combinat din cele existente */}
      {(
        <div style={{ border: '1px solid var(--border)', borderRadius: 12, padding: 12, marginBottom: 12, display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap', background: '#f7f9fc' }}>
          <label style={{ ...lbl, flex: 1, minWidth: 230 }}>⚙️ Automatizare — rubrică (teste existente)
            <select value={autoKey} onChange={(e) => setAutoKey(e.target.value)} style={inp}>
              <option value="">— alege rubrica —</option>
              {[...new Set(rubrics.map((r) => r.group))].map((g) => (
                <optgroup key={g} label={g}>
                  {rubrics.filter((r) => r.group === g).map((r) => (
                    <option key={`${r.category}||${r.subcategory || ''}||${r.profile || ''}||${r.ctype}`}
                      value={`${r.category}||${r.subcategory || ''}||${r.profile || ''}||${r.ctype}`}>
                      {r.label}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </label>
          <label style={{ ...lbl, minWidth: 190 }}>Rezultatul
            <select value={autoResult} onChange={(e) => setAutoResult(e.target.value)} style={inp}>
              <option value="auto">După rubrică (implicit)</option>
              <option value="interactive">Test interactiv (format standard)</option>
              <option value="exam">Subiect de examen (PDF)</option>
            </select>
          </label>
          <label style={{ ...lbl, flex: 2, minWidth: 260 }}>Instrucțiuni (opțional)
            <input value={autoInstr} onChange={(e) => setAutoInstr(e.target.value)}
              placeholder="ex: dificultate medie; grile la Subiectul I; accent pe fracții…" style={inp} />
          </label>
          <button className="btn btn-primary" onClick={runAuto} disabled={autoBusy || !autoKey} style={{ fontSize: '.85rem' }}>
            {autoBusy ? 'Lucrez… (~30-60s)' : '⚙️ Generează (AI)'}
          </button>
          <button className="btn btn-outline" onClick={combineExactRubric}
            disabled={autoBusy || !autoKey || !autoKey.endsWith('||pdf')} title="Doar pentru rubrici PDF"
            style={{ fontSize: '.85rem' }}>
            📎 Combinare exactă (fără AI)
          </button>
          <div style={{ flexBasis: '100%', display: 'flex', gap: 14, fontSize: '.78rem', color: 'var(--text-light)', flexWrap: 'wrap' }}>
            <label style={{ display: 'flex', gap: 6, cursor: 'pointer' }}>
              <input type="radio" checked={dataMode === 'keep'} onChange={() => setDataMode('keep')} />
              <span><strong>păstrează datele problemelor</strong></span>
            </label>
            <label style={{ display: 'flex', gap: 6, cursor: 'pointer' }}>
              <input type="radio" checked={dataMode === 'modify'} onChange={() => setDataMode('modify')} />
              <span><strong>modifică numerele și notațiile</strong> (verifică problemele — poate greși!)</span>
            </label>
          </div>
          {combineMsg && <div style={{ flexBasis: '100%', fontSize: '.8rem', color: combineMsg.startsWith('✅') ? '#1e7e34' : 'var(--text-muted)' }}>{combineMsg}</div>}
          <span style={{ fontSize: '.72rem', color: 'var(--text-muted)', flexBasis: '100%' }}>
            Ia câte un exercițiu din teste diferite, alese la întâmplare, și schimbă numerele/notațiile.
            Rubricile interactive ies în FORMATUL STANDARD (figuri geometrice + instrumente de desen); rubricile PDF ies ca test structurat, de trimis la «Adaugă PDF».
          </span>
        </div>
      )}

      {/* 2. Conversația cu agentul */}
      {chat.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 10, maxHeight: 280, overflowY: 'auto', padding: '2px 2px' }}>
          {chat.map((m, i) => m.role === 'user' ? (
            <div key={i} style={{ alignSelf: 'flex-end', background: 'var(--navy)', color: '#fff', borderRadius: '12px 12px 2px 12px', padding: '8px 12px', fontSize: '.85rem', maxWidth: '85%', whiteSpace: 'pre-wrap' }}>{m.content}</div>
          ) : (
            <div key={i} style={{ alignSelf: 'flex-start', background: '#f7f9fc', borderRadius: '12px 12px 12px 2px', padding: '8px 12px', fontSize: '.85rem', maxWidth: '85%' }}>🤖 {m.content}</div>
          ))}
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', background: '#fff', border: '1px solid var(--border)', borderRadius: 14, padding: 10 }}>
        <textarea value={message} rows={3}
          onChange={(e) => setMessage(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); if (!loading) generate(); } }}
          placeholder={ex
            ? 'Continuă să-i dai indicații… (ex: „fă-l mai greu”, „transformă-l în grilă”, „salvează ca PDF”)'
            : 'Descrie ce vrei să genereze… (ex: „test de 90 min după modelul din fișierul 1, în formatul din fișierul 2, cu alte numere, salvat ca PDF”)'}
          style={{ flex: 1, border: 'none', outline: 'none', resize: 'none', fontSize: '.9rem', fontFamily: 'inherit', lineHeight: 1.5, background: 'transparent' }} />
        <button onClick={generate} disabled={loading} title="Generează (Enter)"
          style={{ background: 'var(--gold, #e8b931)', color: 'var(--navy, #0f2b44)', border: 'none', borderRadius: 10, width: 42, height: 42, fontSize: '1.2rem', fontWeight: 800, cursor: 'pointer', flexShrink: 0 }}>
          {loading ? '…' : '↑'}
        </button>
      </div>
      <div style={{ fontSize: '.72rem', color: 'var(--text-muted)', marginTop: 4 }}>Enter = generează · Shift+Enter = rând nou {loading && ' · agentul lucrează (~20-40s)…'}</div>

      {error && <div style={{ marginTop: 12, padding: 12, background: '#fdecea', color: '#b71c1c', borderRadius: 8, fontSize: '.85rem' }}>⚠️ {error}</div>}
      {msg && <div style={{ marginTop: 12, padding: 12, background: 'rgba(39,174,96,.1)', color: '#1e7e34', borderRadius: 8, fontSize: '.85rem' }}>{msg}</div>}

      {/* 3a. Rezultat HTML brut — clonă a șablonului de format */}
      {exHtml && !ex && (
        <div style={{ marginTop: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginBottom: 8 }}>
            <div style={{ fontWeight: 700, color: 'var(--navy)' }}>
              👁 Previzualizare · fișier în formatul șablonului ({Math.round(exHtml.length / 1024)} KB)
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button className="btn btn-outline" onClick={() => { if (window.confirm('Ștergi fișierul generat?')) { setExHtml(null); setMsg(null); } }} style={{ color: '#c0392b', borderColor: '#f5c6cb' }}>🗑 Șterge</button>
            </div>
          </div>
          <div style={{ border: '1px solid var(--gold, #e8b931)', background: '#fffdf5', borderRadius: 12, padding: 12, marginBottom: 12, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <span style={{ fontSize: '.8rem', fontWeight: 700, color: 'var(--navy)' }}>Pune pe site:</span>
            <button className="btn btn-primary" style={{ fontSize: '.85rem' }} onClick={() => {
              const t = exHtml.match(/<title>([^<]*)<\/title>/i)?.[1]?.trim() || 'Exercițiu generat';
              sessionStorage.setItem('agent_prefill_interactive', JSON.stringify({
                form: { title: t, description: 'Generat cu agentul Claude (șablon model)', type: 'exercise' },
                html: exHtml, fileName: `${slug(t)}.html`,
              }));
              window.dispatchEvent(new CustomEvent('admin:goto-tab', { detail: 'interactive' }));
              window.scrollTo({ top: 0, behavior: 'smooth' });
            }}>🧩 Trimite la «Adaugă Interactiv»</button>
            <span style={{ fontSize: '.8rem', fontWeight: 700, color: 'var(--navy)', marginLeft: 8 }}>Salvează pe calculator:</span>
            <button className="btn btn-outline" style={{ fontSize: '.82rem' }} onClick={() => {
              const t = exHtml.match(/<title>([^<]*)<\/title>/i)?.[1]?.trim() || 'exercitiu';
              const el = document.createElement('a');
              el.href = URL.createObjectURL(new Blob([exHtml], { type: 'text/html' }));
              el.download = `${slug(t)}.html`; el.click(); URL.revokeObjectURL(el.href);
            }}>⬇️ HTML</button>
            <span style={{ fontSize: '.75rem', color: 'var(--text-muted)' }}>Modificările se cer prin mesaje în chat (ex: „schimbă exercițiul 3”).</span>
          </div>
          <iframe title="preview-sablon" sandbox="allow-scripts" srcDoc={exHtml}
            style={{ width: '100%', height: 560, border: '1px solid var(--border)', borderRadius: 10, background: '#fff' }} />
        </div>
      )}

      {/* 3. Exercițiul generat */}
      {ex && (
        <div style={{ marginTop: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginBottom: 8 }}>
            <div style={{ fontWeight: 700, color: 'var(--navy)' }}>
              {editing ? '✏️ Mod editare' : '👁 Previzualizare'} · barem {totalPoints} p · {items.length} {ex.kind === 'etape' ? 'etape' : 'întrebări'}
              {ex.output === 'pdf' && !editing && <span style={{ marginLeft: 8, fontSize: '.75rem', background: '#fff4e5', color: '#8a6d00', borderRadius: 20, padding: '2px 10px' }}>sugerat: PDF</span>}
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {editing ? (
                <button className="btn btn-primary" onClick={() => setEditing(false)}>✅ Finalizare</button>
              ) : (
                <>
                  {savedId && <button className="btn btn-primary" onClick={updateSaved} disabled={saving}>{saving ? 'Se salvează…' : '💾 Actualizează pe site'}</button>}
                  <button className="btn btn-outline" onClick={() => setEditing(true)}>✏️ Modifică</button>
                  <button className="btn btn-outline" onClick={discard} style={{ color: '#c0392b', borderColor: '#f5c6cb' }}>🗑 Șterge</button>
                </>
              )}
            </div>
          </div>

          {/* Plasare pe site + salvare pe calculator */}
          {!editing && (
            <div style={{ border: '1px solid var(--gold, #e8b931)', background: '#fffdf5', borderRadius: 12, padding: 12, marginBottom: 12, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              <span style={{ fontSize: '.8rem', fontWeight: 700, color: 'var(--navy)' }}>Pune pe site:</span>
              <button className="btn btn-primary" onClick={sendToInteractive} style={{ fontSize: '.85rem' }}>🧩 Trimite la «Adaugă Interactiv»</button>
              <button className="btn btn-primary" onClick={sendToPdf} style={{ fontSize: '.85rem' }}>📄 Trimite la «Adaugă PDF»</button>
              <span style={{ fontSize: '.8rem', fontWeight: 700, color: 'var(--navy)', marginLeft: 8 }}>Salvează pe calculator:</span>
              <button className="btn btn-outline" onClick={downloadHtml} style={{ fontSize: '.82rem' }}>⬇️ HTML interactiv</button>
              <button className="btn btn-outline" onClick={() => openPrint(true)} style={{ fontSize: '.82rem' }}>🖨 PDF cu barem</button>
              <button className="btn btn-outline" onClick={() => openPrint(false)} style={{ fontSize: '.82rem' }}>🖨 PDF fără barem</button>
            </div>
          )}

          {editing ? (
            <div style={{ border: '1px solid var(--border)', borderRadius: 12, padding: 14 }}>
              <label style={lbl}>Titlu
                <input value={ex.title || ''} onChange={(e) => patchEx({ title: e.target.value })} style={{ ...inp, marginBottom: 10 }} />
              </label>
              <label style={lbl}>{ex.kind === 'etape' ? 'Enunțul problemei' : 'Context general (opțional)'}
                <textarea value={ex.statement || ''} onChange={(e) => patchEx({ statement: e.target.value })} rows={3} style={{ ...ta, marginBottom: 12 }} />
              </label>

              {items.map((it, i) => (
                <div key={i} style={{ background: '#f7f9fc', borderRadius: 10, padding: 12, marginBottom: 10 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                    <b style={{ fontSize: '.88rem', color: 'var(--navy)' }}>{ex.kind === 'etape' ? `Etapa ${i + 1}` : `Întrebarea ${i + 1}`}</b>
                    <span style={{ display: 'flex', gap: 6 }}>
                      <button style={smallBtn} onClick={() => moveItem(i, -1)} title="Mută sus">↑</button>
                      <button style={smallBtn} onClick={() => moveItem(i, 1)} title="Mută jos">↓</button>
                      <button style={{ ...smallBtn, color: '#c0392b', borderColor: '#f5c6cb' }} onClick={() => delItem(i)}>🗑 Șterge</button>
                    </span>
                  </div>

                  <label style={lbl}>{ex.kind === 'etape' ? 'Cerința etapei' : 'Enunț'}
                    <textarea value={ex.kind === 'etape' ? it.prompt : it.statement}
                      onChange={(e) => patchItem(i, ex.kind === 'etape' ? { prompt: e.target.value } : { statement: e.target.value })}
                      rows={2} style={ta} />
                  </label>

                  {ex.kind === 'grila' && Array.isArray(it.options) && (
                    <div style={{ marginTop: 8 }}>
                      {it.options.map((o, oi) => (
                        <div key={oi} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                          <input type="radio" name={`correct${i}`} checked={Number(it.answer) === oi}
                            onChange={() => patchItem(i, { answer: oi })} title="Marchează ca răspuns corect" />
                          <input value={o} placeholder={`Varianta ${String.fromCharCode(65 + oi)}`}
                            onChange={(e) => {
                              const options = [...it.options]; options[oi] = e.target.value;
                              patchItem(i, { options });
                            }} style={{ ...inp, marginTop: 0 }} />
                        </div>
                      ))}
                      <div style={{ fontSize: '.72rem', color: 'var(--text-muted)' }}>Bifează bulina din stânga variantei corecte.</div>
                    </div>
                  )}

                  {(ex.kind === 'etape' || !Array.isArray(it.options)) && (
                    <label style={lbl}>Răspuns corect
                      <input value={String(it.answer ?? '')} onChange={(e) => patchItem(i, { answer: e.target.value })} style={inp} />
                    </label>
                  )}

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 90px', gap: 8, marginTop: 8 }}>
                    <label style={lbl}>Indiciu
                      <textarea value={it.hint || ''} onChange={(e) => patchItem(i, { hint: e.target.value })} rows={2} style={ta} />
                    </label>
                    <label style={lbl}>Rezolvare / barem
                      <textarea value={it.explanation || ''} onChange={(e) => patchItem(i, { explanation: e.target.value })} rows={2} style={ta} />
                    </label>
                    <label style={lbl}>Punctaj
                      <input type="number" min="1" value={it.points || 10} onChange={(e) => patchItem(i, { points: Number(e.target.value) || 1 })} style={inp} />
                    </label>
                  </div>
                </div>
              ))}

              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button className="btn btn-outline" onClick={addItem}>➕ Adaugă {ex.kind === 'etape' ? 'etapă' : 'întrebare'}</button>
                {ex.kind === 'etape' && (
                  <label style={{ ...lbl, flex: 1, minWidth: 220 }}>Răspuns final
                    <input value={ex.final_answer || ''} onChange={(e) => patchEx({ final_answer: e.target.value })} style={inp} />
                  </label>
                )}
              </div>
            </div>
          ) : (
            <iframe title="preview-exercitiu" sandbox="allow-scripts" srcDoc={renderExercise(ex)}
              style={{ width: '100%', height: 520, border: '1px solid var(--border)', borderRadius: 10, background: '#fff' }} />
          )}
        </div>
      )}

      {/* Modal: alege un material din baza de date ca model */}
      {picker && (
        <div onClick={() => !pickerBusy && setPicker(null)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(9,30,48,.55)', zIndex: 1400, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
          <div onClick={(e) => e.stopPropagation()}
            style={{ background: '#fff', borderRadius: 14, padding: 16, width: 'min(560px, 100%)', maxHeight: '80vh', display: 'flex', flexDirection: 'column' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
              <b style={{ color: 'var(--navy)' }}>📚 Alege {picker === 'format' ? 'modelul de format' : 'exercițiile-model'} din baza de date</b>
              <button onClick={() => setPicker(null)} style={{ ...smallBtn }}>✕</button>
            </div>
            <input value={pickerSearch} onChange={(e) => setPickerSearch(e.target.value)} placeholder="Caută după titlu / categorie…"
              style={{ ...inp, marginTop: 0, marginBottom: 10 }} />
            <div style={{ overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 6 }}>
              {pickerItems
                .slice(0, 100)
                .map((it) => (
                  <button key={it.id} disabled={pickerBusy} onClick={() => pickFromDb(it)}
                    style={{ textAlign: 'left', background: '#f7f9fc', border: '1px solid var(--border)', borderRadius: 8, padding: '8px 10px', cursor: 'pointer' }}>
                    <div style={{ fontSize: '.85rem', fontWeight: 600, color: 'var(--navy)' }}>
                      {it.content_type === 'pdf' ? '📄' : '🧩'} {it.title}
                    </div>
                    <div style={{ fontSize: '.72rem', color: 'var(--text-muted)' }}>{it.category}{it.subcategory ? ` / ${it.subcategory}` : ''}</div>
                  </button>
                ))}
              {pickerBusy && <div style={{ fontSize: '.82rem', color: 'var(--text-muted)', padding: 8 }}>Se descarcă materialul…</div>}
            </div>
          </div>
        </div>
      )}

      {/* Exerciții încărcate de agent — reeditabile */}
      {savedList.length > 0 && (
        <div style={{ marginTop: 20 }}>
          <div style={{ fontWeight: 700, color: 'var(--navy)', fontSize: '.9rem', marginBottom: 8 }}>Exerciții încărcate de agent (poți să le modifici oricând)</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {savedList.map((r) => (
              <div key={r.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, padding: '8px 10px', background: '#f7f9fc', borderRadius: 8 }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: '.85rem', fontWeight: 600, color: 'var(--navy)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {r.interactive_data?.exercise?.kind === 'etape' ? '🧮' : '☑️'} {r.title}
                  </div>
                  <div style={{ fontSize: '.72rem', color: 'var(--text-muted)' }}>
                    {r.category} · {r.is_free ? 'gratuit' : 'premium'} · {new Date(r.created_at).toLocaleDateString('ro-RO')}
                  </div>
                </div>
                <button style={smallBtn} onClick={() => loadForEdit(r)}>✏️ Modifică</button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
