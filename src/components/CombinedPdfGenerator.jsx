// =====================================================================
// src/components/CombinedPdfGenerator.jsx — teste PDF diferite din subiectele
// de examen ale site-ului
//
// Din 1 nov. 2026 stă în „🧩 Generează exerciții/teste interactive/PDF" →
// „👥 Teste diferite / elev" (src/components/TesteDiferite.jsx), cu sursa
// „🎓 Subiectele de examen" (până atunci era în „👥 Test pe grupă" → „⚡
// Generează acum testele"). Face atâtea teste PDF câte teste diferite / elev s-au
// cerut, fiecare COMBINAT EXACT din subiectele PDF ale site-ului — ca la „📄 Generează
// subiect examen" → „📎 Combină exact": exercițiile sunt decupate din variantele
// date, modelele, simulările și testele de antrenament ale examenului și așezate
// pe ACEEAȘI poziție (exercițiul 3 de la Subiectul II vine dintre exercițiile 3
// de la Subiectul II), cu redactarea originală — fără AI, fără cost.
//
//   • testele diferă între ele: pe fiecare poziție, alt test-sursă
//     (src/lib/pdfCombine.js → planCombinations);
//   • profesorul alege ce subiecte intră: toate, doar I, doar II, doar III sau
//     I și II — testele parțiale primesc un antet scurt (titlu + „Numele și
//     prenumele") în locul copertei oficiale (care vorbește de toate subiectele);
//   • și, prin BIFE, exercițiile fiecărui subiect; la BAC, la Subiectele II și
//     III, și subpunctele a), b), c) ale fiecărei probleme (1 nov. 2026). Un
//     subiect din care lipsește ceva are titlul cu punctajul bifat;
//   • fiecare PDF se salvează în „Testele și exercițiile mele", se publică în
//     „Biblioteca utilizatorilor" (aiClient.saveCombinedPdf) și se poate
//     descărca — unul câte unul sau toate într-un singur PDF, de tipărit;
//   • cu „👥 Folosește-le în testul interactiv pe grupă", testele intră bifate în
//     bazinul testului pe grupă (sursa „🧩 Testele generate de mine").
//
// „🔢 SCHIMBĂ NUMERELE ȘI NOTAȚIILE" (dataMode 'modify', 1 nov. 2026): ca la
// „📄 Generează subiect examen" cu „modifică datele" — fiecare test îl compune
// AI-ul din subiectele site-ului, cu alte numere și notații (un apel AI pe test,
// aiClient.generateExam), apoi se păstrează doar exercițiile bifate
// (src/lib/fiseTeste.js → filterExamBySelection). Testul e un „exam" (JSON
// tipăribil, cu barem) — kind 'exam' în „Testele mele", merge și în testul pe
// grupă în format PDF.
// =====================================================================
import { useEffect, useRef, useState } from 'react';
import { aiClient } from '../lib/aiClient';
import { supabase } from '../lib/supabase';
import { authHeaders } from '../lib/api';
import {
  fetchPdfSources, stratifyBySubcategory, probeExamPdf, prepareExamSources, planCombinations,
  openSourceDocs, composeExamPdf, makeHeaderPng, mergePdfs, maxDistinctTests,
  SUBJECT_CHOICES, subjectsLabel, examLayout, fullSelection, normSelection, selectionSubjects,
  selectionComplete, subjectComplete, selectionPoints, pointsLabel, presetOf, selectionSummary, subjectName,
} from '../lib/pdfCombine';
import { EXAM_SOURCES, EXAM_TYPES } from './ExamGenerator';
import { filterExamBySelection } from '../lib/fiseTeste';
import { setTitle, setText, variantLabel, variantTitle, buildExamSet, examIsGrila, combinedIsGrila } from '../lib/testeSet';
import OptiuneSpatiuLucru from './OptiuneSpatiuLucru';
import ListaTesteExam, { SetSalvat } from './ListaTesteExam';
import { fmtEstimare } from '../lib/aiCost';

// un test de examen compus de AI (gpt-6.1-sol, cu verificatorul): ~0,5–0,85 lei
// (GHID_LIMITE_AI.md) — estimarea afișată sub buton, în credite (100 = 1 leu)
const CREDITE_TEST_EXAMEN_AI = 70;

// Doar rubricile cu teste ÎNTREGI (structura oficială). Capitolele, fișele pe
// exerciții și baremele nu au structură de subiect — nu le descărcăm degeaba.
const TEST_SUBCATS = new Set(['variante', 'simulari', 'teste-antrenament', '']);
// numele examenului: scurt (în titlul testului) și pe antetul testelor parțiale
const EXAM_NAME = {
  'evaluare-nationala': { short: 'Evaluare Națională', head: 'Evaluarea Națională · Matematică' },
  'bac-mate-info': { short: 'BAC Mate-Info', head: 'Bacalaureat · Matematică M_mate-info' },
  'bac-stiinte': { short: 'BAC Științele Naturii', head: 'Bacalaureat · Matematică M_șt-nat' },
  'bac-tehnologic': { short: 'BAC Tehnologic', head: 'Bacalaureat · Matematică M_tehnologic' },
};
// categoria testului pe grupă (pasul 1) → examenul propus
const examFromCategory = (cat) => (cat === 'bacalaureat' || /^clasa-(9|1[0-2])$/.test(cat || '') ? 'bac-mate-info' : 'evaluare-nationala');
const marime = (n) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1).replace('.', ',')} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
const slug = (t) => String(t || 'test').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80) || 'test';

function descarca(blob, nume) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = nume;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

// adresa unui PDF din site (premium → semnată de server, ca la generatorul de subiecte)
async function getUrlFor(row) {
  if (row.is_free) return row.file_url;
  const res = await fetch('/api/get-file-url', { method: 'POST', headers: await authHeaders(), body: JSON.stringify({ contentId: row.id }) });
  const d = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(d.error || 'URL indisponibil');
  return d.url;
}

const chip = (active) => ({
  padding: '6px 11px', borderRadius: 999, cursor: 'pointer', fontSize: '.8rem', fontWeight: 600,
  border: `1.5px solid ${active ? 'var(--navy)' : 'var(--border)'}`,
  background: active ? 'var(--navy)' : '#fff', color: active ? '#fff' : 'var(--navy)',
});
// o bifă (exercițiu / subpunct), ca o etichetă mică: bifată = conturul albastru
const bifa = (on, disabled) => ({
  display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 6px', borderRadius: 7,
  border: `1.5px solid ${on ? 'var(--navy)' : 'var(--border)'}`, background: on ? 'rgba(15,43,68,.07)' : '#fff',
  color: 'var(--navy)', fontSize: '.8rem', fontWeight: 600, cursor: disabled ? 'default' : 'pointer',
  userSelect: 'none', opacity: disabled ? 0.6 : 1,
});
const range = (n) => Array.from({ length: n }, (_, i) => i + 1);

// Bifele: exercițiile fiecărui subiect; la BAC, la Subiectele II și III, fiecare
// problemă cu subpunctele ei a), b), c). Bifa subiectului / a problemei le
// schimbă pe toate (e „pe jumătate" când sunt bifate doar unele).
export function BifeExercitii({ layout, sel, onChange, disabled }) {
  const n = normSelection(sel, layout);
  const edit = (fn) => onChange((cur) => {
    const c = normSelection(cur, layout);
    const x = { items: { ...c.items }, parts: { ...c.parts } };
    fn(x);
    return normSelection(x, layout);
  });
  const allParts = (s) => layout.parts[s] || [];
  const problemFull = (s, it) => n.items[s].includes(it) && (!layout.parts[s] || (n.parts[`${s}.${it}`] || []).length === allParts(s).length);
  const toggleSubject = (s) => edit((x) => {
    const all = subjectComplete(x, layout, s);
    x.items[s] = all ? [] : range(layout.items[s]);
    for (const it of range(layout.items[s])) {
      if (!layout.parts[s]) continue;
      if (all) delete x.parts[`${s}.${it}`]; else x.parts[`${s}.${it}`] = [...allParts(s)];
    }
  });
  const toggleItem = (s, it) => edit((x) => {
    const key = `${s}.${it}`;
    const full = x.items[s].includes(it) && (!layout.parts[s] || (x.parts[key] || []).length === allParts(s).length);
    if (full) { x.items[s] = x.items[s].filter((v) => v !== it); delete x.parts[key]; }
    else { if (!x.items[s].includes(it)) x.items[s] = [...x.items[s], it]; if (layout.parts[s]) x.parts[key] = [...allParts(s)]; }
  });
  const togglePart = (s, it, l) => edit((x) => {
    const key = `${s}.${it}`;
    const cur = x.items[s].includes(it) ? (x.parts[key] || []) : [];
    const next = cur.includes(l) ? cur.filter((v) => v !== l) : [...cur, l];
    if (next.length) { x.parts[key] = next; if (!x.items[s].includes(it)) x.items[s] = [...x.items[s], it]; }
    else { delete x.parts[key]; x.items[s] = x.items[s].filter((v) => v !== it); }
  });
  const pe = (el, val) => { if (el) el.indeterminate = val; }; // bifa „pe jumătate"

  return (
    <div role="group" aria-label="Exercițiile incluse" style={{ display: 'grid', gap: 8 }}>
      {[1, 2, 3].map((s) => {
        const all = subjectComplete(n, layout, s);
        const some = n.items[s].length > 0;
        return (
          <div key={s} style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '6px 10px', background: '#fff', border: '1px solid var(--border)', borderRadius: 9, padding: '7px 9px' }}>
            <label style={{ display: 'inline-flex', flexWrap: 'wrap', alignItems: 'center', gap: '2px 6px', fontWeight: 700, fontSize: '.82rem', color: 'var(--navy)', minWidth: 168, cursor: disabled ? 'default' : 'pointer' }}>
              <input type="checkbox" checked={all} ref={(el) => pe(el, some && !all)} disabled={disabled}
                onChange={() => toggleSubject(s)} aria-label={`${subjectName(s)} — toate exercițiile`} />
              <span style={{ whiteSpace: 'nowrap' }}>{subjectName(s)}</span>
              <span style={{ whiteSpace: 'nowrap', fontWeight: 500, fontSize: '.74rem', color: 'var(--text-muted)' }}>· {pointsLabel(selectionPoints(n, layout, s))}</span>
            </label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {range(layout.items[s]).map((it) => {
                const on = n.items[s].includes(it);
                if (!layout.parts[s]) {
                  return (
                    <label key={it} style={bifa(on, disabled)}>
                      <input type="checkbox" checked={on} disabled={disabled} onChange={() => toggleItem(s, it)}
                        aria-label={`${subjectName(s)}, exercițiul ${it}`} style={{ margin: 0 }} />
                      {it}.
                    </label>
                  );
                }
                const full = problemFull(s, it);
                return (
                  <div key={it} style={{ display: 'inline-flex', flexWrap: 'wrap', alignItems: 'center', gap: 3, border: '1px dashed var(--border)', borderRadius: 8, padding: '2px 4px' }}>
                    <label style={{ ...bifa(on, disabled), border: 'none', background: 'transparent', padding: '2px 2px' }}>
                      <input type="checkbox" checked={full} ref={(el) => pe(el, on && !full)} disabled={disabled}
                        onChange={() => toggleItem(s, it)} aria-label={`${subjectName(s)}, problema ${it} — toate subpunctele`} style={{ margin: 0 }} />
                      {it}.
                    </label>
                    {allParts(s).map((l) => {
                      const pOn = on && (n.parts[`${s}.${it}`] || []).includes(l);
                      return (
                        <label key={l} style={bifa(pOn, disabled)}>
                          <input type="checkbox" checked={pOn} disabled={disabled} onChange={() => togglePart(s, it, l)}
                            aria-label={`${subjectName(s)}, problema ${it}, subpunctul ${l})`} style={{ margin: 0 }} />
                          {l})
                        </label>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default function CombinedPdfGenerator({
  poolSize = 10,     // câte teste diferite se cer (unul pentru fiecare elev)
  category = '',     // categoria aleasă (Evaluare Națională / Bacalaureat)
  onCategory,        // (categorie) → categoria examenului generat
  onDone,            // (items, { format, category }) → testele generate (pentru testul pe grupă)
  onError,
  dataMode = 'keep', // 'keep' = decupate exact (fără AI) · 'modify' = AI, alte numere și notații
  publish = true,    // se publică și în „Biblioteca utilizatorilor"
}) {
  const ai = dataMode === 'modify';
  const [examType, setExamType] = useState(() => examFromCategory(category));
  // exercițiile bifate (implicit toate) — alegerile rapide de mai sus le bifează pe subiecte
  const [sel, setSel] = useState(() => fullSelection(examLayout(examFromCategory(category))));
  const [busy, setBusy] = useState(null);         // eticheta pasului în curs
  const [err, setErr] = useState(null);
  const [rezultat, setRezultat] = useState(null); // { teste, surse, ... }
  const [deschis, setDeschis] = useState(null);   // testul cu raportul desfăcut
  const [toateBusy, setToateBusy] = useState(false);
  // „🔢 Schimbă numerele": testele compuse de AI (JSON de examen, cu barem)
  const [rezultatAI, setRezultatAI] = useState(null);
  const [workSpace, setWorkSpace] = useState(true);
  // generatorul închis în timpul generării (altă sursă, alt conținut): ce s-a
  // salvat rămâne în „Testele mele", dar nu mai e raportat mai departe
  const viu = useRef(true);
  useEffect(() => { viu.current = true; return () => { viu.current = false; }; }, []);

  // categoria schimbată la pasul 1 → examenul de aici o urmează
  useEffect(() => {
    if (category === 'evaluare-nationala') setExamType('evaluare-nationala');
    else if (category === 'bacalaureat') setExamType((t) => (t.startsWith('bac-') ? t : 'bac-mate-info'));
  }, [category]);

  // examenul ales aici (EN / un profil de BAC) → categoria din „Teste diferite / elev"
  useEffect(() => {
    const c = (EXAM_SOURCES[examType] || {}).category;
    if (c && c !== category) onCategory?.(c);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [examType]);

  // alt examen (EN ↔ BAC) = altă structură (6 · 6 · 6 sau 6 · 2 · 2, cu subpuncte):
  // rămân bifate, întregi, subiectele care aveau ceva bifat
  useEffect(() => {
    setSel((cur) => {
      const subj = selectionSubjects(cur);
      return fullSelection(examLayout(examType), subj.length ? subj : [1, 2, 3]);
    });
  }, [examType]);

  const n = Math.max(1, Math.min(60, parseInt(poolSize, 10) || 1));
  const layout = examLayout(examType);
  const selN = normSelection(sel, layout);
  const subjects = selectionSubjects(selN);
  const complet = selectionComplete(selN, layout);
  const preset = presetOf(selN, layout);   // alegerea rapidă care corespunde bifelor (sau null)
  const alese = !preset && subjects.length > 0; // doar unele exerciții dintr-un subiect
  const puncte = selectionPoints(selN, layout);
  const sl = subjects.length ? subjectsLabel(subjects) : '';
  const eticheta = complet ? 'Subiectele I, II și III' : `${sl}${alese ? ', exerciții alese' : ''}`;
  const exam = EXAM_NAME[examType] || EXAM_NAME['evaluare-nationala'];
  const esteClasa = /^clasa-/.test(category || '');

  // ── „🔢 Schimbă numerele și notațiile": un test de examen compus de AI pe
  //    test (aiClient.generateExam, ca la „📄 Generează subiect examen" →
  //    „modifică datele"), din care rămân exercițiile bifate ──
  async function genereazaAI() {
    setErr(null); setRezultatAI(null); setDeschis(null);
    if (!subjects.length) { setErr('Bifează cel puțin un exercițiu.'); return; }
    const cfg = EXAM_SOURCES[examType] || EXAM_SOURCES['evaluare-nationala'];
    if (cfg.category !== category) onCategory?.(cfg.category);
    const selectie = selN;
    const info = { examen: exam.short, subiecte: complet ? 'toate subiectele' : eticheta };
    // mai multe teste → un SET: „Varianta 1…N", salvat ca un singur PDF (src/lib/testeSet.js)
    const multe = n > 1;
    const context = `${exam.short}${complet ? '' : ` · ${sl}`}${alese ? ' (exerciții alese)' : ''} · numere schimbate`;
    const topic = `${sl}${cfg.profile ? ` · M_${cfg.profile}` : ''} · numere schimbate`;
    const teste = [];
    const gata = async (extra = {}) => {
      let set = null;
      if (multe && teste.length > 1 && viu.current) {
        setBusy(`Salvez cele ${teste.length} teste într-un singur PDF…`);
        try {
          const exams = teste.map((t) => t.exam);
          const grila = exams.every(examIsGrila);
          const title = setTitle(teste.length, grila);
          const examSet = buildExamSet(exams, { title, context });
          const r = await aiClient.saveTestSet({
            kind: 'exam', title, category: cfg.category, topic, exam: examSet, grila, publish,
            children: teste.map((t) => ({ id: t.privateId, payload: { exam: t.exam } })),
          });
          set = { ...r, exam: examSet };
        } catch (e) { set = { error: e.message || 'setul nu s-a putut salva' }; }
      }
      setRezultatAI({ ...info, teste: [...teste], gata: true, total: teste.length, set, ...extra });
      if (viu.current && teste.length) onDone?.(teste.map((t) => ({ source: 'personal', refId: t.privateId, title: t.title, isFree: true })), { format: 'pdf', category: cfg.category });
    };
    try {
      let nr = multe ? 0 : await aiClient.nextCombinedTestNumber().catch(() => 1);
      for (let i = 0; i < n; i++) {
        if (!viu.current) return;
        setBusy(`${multe ? `Varianta ${i + 1}` : 'Testul'} din ${n}: AI-ul o compune din subiectele site-ului, cu alte numere și notații… (~1–2 minute)`);
        // eslint-disable-next-line no-await-in-loop
        const res = await aiClient.generateExam({ examType, dataMode: 'modify', instructions: '', chapters: [] });
        const titlu = multe ? variantTitle(`Test combinat — ${context}`, i + 1) : `Test combinat nr. ${nr} — ${context}`;
        const ex0 = filterExamBySelection(res.exam, selectie, { complete: complet });
        const { workSpace: _ws, ...rest } = ex0 || {};
        const ex = {
          ...rest,
          // varianta din set poartă „Varianta k" și pe foaie (o primește un elev)
          ...(multe ? { title: variantLabel(i + 1), subtitle: context, nameLine: true } : { title: titlu }),
          ...(workSpace ? {} : { workSpace: false }),
        };
        setBusy(`${multe ? `Varianta ${i + 1}` : 'Testul'} din ${n}: o salvez…`);
        // eslint-disable-next-line no-await-in-loop
        const privateId = await aiClient.saveLibraryItem({ kind: 'exam', title: titlu, category: cfg.category, topic, payload: { exam: ex } });
        let publicId = null; let publishError = null;
        // un set se publică o singură dată, întreg (la final); un test singur — acum
        if (publish && !multe) {
          try {
            // eslint-disable-next-line no-await-in-loop
            const r = await aiClient.publicPublish({ kind: 'exam', title: titlu, category: cfg.category, topic, payload: { exam: ex } });
            publicId = r?.id || null;
            if (publicId) aiClient.updateLibraryItem(privateId, { payload: { exam: ex, publicId } }).catch(() => {});
          } catch (e) { publishError = e.message || 'publicarea a eșuat'; }
        }
        teste.push({ privateId, publicId, publishError, title: titlu, exam: ex, nr, verification: res.verification || null });
        setRezultatAI({ ...info, teste: [...teste], gata: false, total: n });
        nr += 1;
      }
      await gata();
    } catch (e) {
      setErr(e.message || 'Generarea testelor a eșuat.');
      onError?.(e);
      if (teste.length) await gata({ intrerupt: true });
    } finally { setBusy(null); }
  }

  async function genereaza() {
    if (ai) { await genereazaAI(); return; }
    setErr(null); setRezultat(null); setDeschis(null);
    if (!subjects.length) { setErr('Bifează cel puțin un exercițiu.'); return; }
    const cfg = EXAM_SOURCES[examType] || EXAM_SOURCES['evaluare-nationala'];
    // testul pe grupă primește categoria examenului din care vin testele
    if (cfg.category !== category) onCategory?.(cfg.category);
    const selectie = selN;
    const info = { examen: exam.short, subiecte: complet ? 'toate subiectele' : eticheta };
    // mai multe teste → un SET: „Varianta 1…N" pe fiecare test, toate într-un
    // singur PDF salvat (și publicat) o dată; variantele rămân separat, ascunse,
    // pentru testul pe grupă (src/lib/testeSet.js)
    const multe = n > 1;
    const context = `${exam.short}${complet ? '' : ` · ${sl}`}${alese ? ' (exerciții alese)' : ''}`;
    const teste = [];
    let surse = [];
    let maxDiferite = Infinity;
    const gata = async (extra = {}) => {
      let set = null;
      if (multe && teste.length > 1 && viu.current) {
        setBusy(`Unesc cele ${teste.length} teste într-un singur PDF și îl salvez…`);
        try {
          const bytes = await mergePdfs(await Promise.all(teste.map(async (t) => new Uint8Array(await t.blob.arrayBuffer()))));
          const blob = new Blob([bytes], { type: 'application/pdf' });
          const grila = combinedIsGrila(examType, subjects);
          const title = setTitle(teste.length, grila);
          const r = await aiClient.saveTestSet({
            kind: 'pdf', title, category: cfg.category, topic: `${sl}${cfg.profile ? ` · M_${cfg.profile}` : ''}`, blob, grila, publish,
            extra: {
              text: setText(teste.map((t) => t.text)).slice(0, 60000),
              pageTexts: teste.flatMap((t) => t.pageTexts || []),
              pages: teste.reduce((sum, t) => sum + (t.pages || 0), 0),
              combined: { exam: examType, subjects, variants: teste.length, ...(complet ? {} : { selection: selectie }) },
            },
            children: teste.map((t) => ({ id: t.privateId, payload: t.payload })),
          });
          set = { ...r, blob, size: blob.size, pages: teste.reduce((sum, t) => sum + (t.pages || 0), 0) };
        } catch (e) { set = { error: e.message || 'setul nu s-a putut salva' }; }
      }
      setRezultat({ ...info, teste: [...teste], surse, maxDiferite, gata: true, total: teste.length, set, ...extra });
      if (viu.current && teste.length) onDone?.(teste.map((t) => ({ source: 'personal', refId: t.privateId, title: t.title, isFree: true })), { format: 'pdf', category: cfg.category });
    };
    try {
      setBusy('Caut subiectele-sursă ale examenului…');
      let q = supabase.from('content').select('id, title, file_url, is_free, subcategory')
        .eq('content_type', 'pdf').eq('category', cfg.category)
        .order('created_at', { ascending: false }).limit(400);
      if (cfg.profile) q = q.eq('profile', cfg.profile);
      const { data, error } = await q;
      if (error) throw new Error(error.message);
      const rows = (data || []).filter((r) => TEST_SUBCATS.has(r.subcategory || '') && !/barem/i.test(r.title || ''));
      if (rows.length < 2) throw new Error('Examenul ales are prea puține subiecte PDF pe site (minim 2 dintre variantele date, modele, simulări și testele de antrenament).');
      // mai multe surse decât la un singur subiect, ca testele să difere între ele
      const max = Math.min(12, Math.max(6, n + 2));
      const src = await fetchPdfSources(stratifyBySubcategory(rows), getUrlFor, {
        max, perSubCap: Math.ceil(max / 2), onProgress: setBusy, ordered: true, probe: probeExamPdf,
      });
      if (src.length < 2) throw new Error('Nu am putut descărca suficiente subiecte-sursă cu structură de examen (minim 2).');
      const prep = await prepareExamSources(src, { onProgress: setBusy });
      surse = prep.list.map((a) => a.label);
      maxDiferite = maxDistinctTests(prep.list, subjects, selectie);
      const planuri = planCombinations(prep.list, { count: n, subjects, selection: selectie });
      setBusy('Pregătesc subiectele-sursă…');
      const docs = await openSourceDocs(prep.list);
      let nr = multe ? 0 : await aiClient.nextCombinedTestNumber().catch(() => 1);
      const topic = `${sl}${cfg.profile ? ` · M_${cfg.profile}` : ''}`;

      for (const plan of planuri) {
        if (!viu.current) return;
        const eticheta2 = multe ? variantLabel(plan.index) : null;
        const titlu = multe ? variantTitle(`Test combinat — ${context}`, plan.index) : `Test combinat nr. ${nr} — ${context}`;
        const nrTest = nr;
        setBusy(`${multe ? eticheta2 : `Testul ${plan.index}`} din ${planuri.length}: compun PDF-ul…`);
        // eslint-disable-next-line no-await-in-loop
        const r = await composeExamPdf(prep, plan, {
          subjects, srcDocs: docs, selection: selectie,
          // testul complet (coperta oficială): „Varianta k" într-o casetă sus, în dreapta
          label: eticheta2,
          // testele parțiale: antet scurt în locul copertei (care vorbește de toate subiectele)
          header: complet ? null : (latime, info2) => makeHeaderPng({
            title: exam.head,
            subtitle: `Test de antrenament · ${sl}${alese ? ' (exerciții alese)' : ''} — ${pointsLabel(info2?.points ?? puncte)}`,
            right: multe ? eticheta2 : `Test combinat nr. ${nrTest}`,
            rightBold: multe,
          }, { widthPt: latime }),
        });
        const blob = new Blob([r.bytes], { type: 'application/pdf' });
        setBusy(`${multe ? eticheta2 : `Testul ${plan.index}`} din ${planuri.length}: o salvez${publish && !multe ? ' și o public în bibliotecă' : ''}…`);
        // eslint-disable-next-line no-await-in-loop
        const s2 = await aiClient.saveCombinedPdf({
          title: titlu, category: cfg.category, topic, blob,
          // un set se publică o singură dată, întreg (la final)
          publish: publish && !multe,
          extra: {
            // textul testului (doar exercițiile așezate) — îl citește Profesorul Virtual
            sources: r.sources, text: r.text, pageTexts: r.pageTexts, pages: r.pages,
            combined: { exam: examType, subjects, nr: nrTest, ...(multe ? { variant: plan.index } : {}), report: r.report, points: r.points, ...(complet ? {} : { selection: selectie }) },
          },
        });
        teste.push({
          ...s2, nr: nrTest, variant: multe ? plan.index : null, blob, size: r.size, pages: r.pages, report: r.report, duplicate: plan.duplicate,
          points: r.points, intregi: (r.wholeFallback || []).length, text: r.text, pageTexts: r.pageTexts,
        });
        setRezultat({ ...info, teste: [...teste], surse, maxDiferite, gata: false, total: planuri.length });
        nr += 1;
      }
      await gata();
    } catch (e) {
      setErr(e.message || 'Generarea testelor a eșuat.');
      onError?.(e);
      // ce s-a salvat până la eroare rămâne folosibil (și e deja în „Testele mele")
      if (teste.length) await gata({ intrerupt: true });
    } finally { setBusy(null); }
  }

  async function descarcaToate() {
    if (!rezultat?.teste?.length) return;
    setToateBusy(true); setErr(null);
    try {
      const bytes = await mergePdfs(await Promise.all(rezultat.teste.map(async (t) => new Uint8Array(await t.blob.arrayBuffer()))));
      descarca(new Blob([bytes], { type: 'application/pdf' }), `teste-combinate-${slug(rezultat.examen)}-${rezultat.teste.length}.pdf`);
    } catch (e) { setErr('Nu am putut uni PDF-urile: ' + (e.message || 'eroare')); }
    finally { setToateBusy(false); }
  }

  function vezi(t) {
    const url = URL.createObjectURL(t.blob);
    window.open(url, '_blank', 'noopener');
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }

  const box = { border: '2px dashed var(--gold)', borderRadius: 12, background: 'rgba(232,185,49,.06)', padding: 14, marginTop: 12 };
  const lbl = { fontSize: '.78rem', fontWeight: 700, color: 'var(--navy)', margin: '10px 0 6px' };
  const publicate = rezultat ? rezultat.teste.filter((t) => t.publicId).length : 0;

  const crediteAI = CREDITE_TEST_EXAMEN_AI * n;

  return (
    <div style={box}>
      {ai ? (
        <>
          <div style={{ fontSize: '.86rem', fontWeight: 700, color: 'var(--navy)', marginBottom: 4 }}>
            🔢 {n} {n === 1 ? 'test' : 'teste'} din subiectele de examen ale site-ului — cu numerele și notațiile schimbate (AI)
          </div>
          <p style={{ fontSize: '.79rem', color: 'var(--text-light)', margin: '0 0 6px', lineHeight: 1.55 }}>
            Ca la <strong>„📄 Generează subiect examen" → „modifică datele"</strong>: fiecare test îl compune AI-ul din
            subiectele site-ului (variante date, modele, simulări), cu <strong>alte numere și notații</strong>, și îl
            recalculează — cu <strong>barem</strong>. Rămân doar exercițiile bifate mai jos. <strong>Un apel AI pe test</strong>:
            {' '}~{fmtEstimare(CREDITE_TEST_EXAMEN_AI)} pe test.
            <br />{n > 1
              ? <>Toate cele {n} teste se <strong>salvează într-un singur PDF</strong>, fiecare test cu <strong>„Varianta 1", „Varianta 2"…</strong>{publish ? <>; PDF-ul se <strong>publică</strong> în „Biblioteca utilizatorilor"</> : ''}. Se tipărește cu sau fără barem.</>
              : <>Testul se <strong>salvează</strong> în „Testele și exercițiile mele"{publish ? <>, se <strong>publică</strong> în „Biblioteca utilizatorilor"</> : ''} și se poate <strong>tipări</strong> (PDF), cu sau fără barem.</>}
          </p>
        </>
      ) : (
        <>
          <div style={{ fontSize: '.86rem', fontWeight: 700, color: 'var(--navy)', marginBottom: 4 }}>
            📎 {n} {n === 1 ? 'test PDF combinat' : 'teste PDF combinate'} exact din subiectele de examen ale site-ului
          </div>
          <p style={{ fontSize: '.79rem', color: 'var(--text-light)', margin: '0 0 6px', lineHeight: 1.55 }}>
            Ca la <strong>„📄 Generează subiect examen" → „Combină exact"</strong>: exercițiile sunt <strong>decupate din
            subiectele PDF ale site-ului</strong> (variante date, modele, simulări, teste de antrenament) și așezate pe
            <strong> aceeași poziție</strong> — exercițiul 3 de la Subiectul II vine dintre exercițiile 3 de la Subiectul II.
            Redactarea e identică cu originalele, fără AI și fără cost. <strong>Testele diferă între ele</strong>: pe fiecare
            poziție, alt test-sursă.
            <br />{n > 1
              ? <>Toate cele {n} teste se <strong>salvează într-un singur PDF</strong>, fiecare test cu <strong>„Varianta 1", „Varianta 2"…</strong> (pe copertă sau în antet){publish ? <>; PDF-ul se <strong>publică</strong> în „Biblioteca utilizatorilor"</> : ''} și se poate <strong>descărca</strong>.</>
              : <>PDF-ul se <strong>salvează</strong> în „Testele și exercițiile mele"{publish ? <>, se <strong>publică</strong> în „Biblioteca utilizatorilor"</> : ''} și se poate <strong>descărca</strong>.</>}
          </p>
        </>
      )}

      <div style={lbl}>Examenul</div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {EXAM_TYPES.map((t) => (
          <button key={t.id} type="button" style={chip(examType === t.id)} disabled={!!busy}
            onClick={() => setExamType(t.id)} title={t.desc}>{t.label}</button>
        ))}
      </div>
      {esteClasa && (
        <div style={{ fontSize: '.74rem', color: '#b26a00', marginTop: 6 }}>
          Combinarea folosește subiectele oficiale de examen (EN sau BAC) — testele vor avea categoria examenului ales.
        </div>
      )}

      <div style={lbl}>Ce subiecte intră în fiecare test</div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {SUBJECT_CHOICES.map((c) => (
          <button key={c.id} type="button" style={chip(preset === c.id)} disabled={!!busy}
            onClick={() => setSel(fullSelection(layout, c.subjects))} aria-pressed={preset === c.id}>{c.label}</button>
        ))}
      </div>

      <div style={lbl}>
        Exercițiile incluse — bifează-le pe cele pe care le vrei{layout.parts[2] ? ' (la Subiectele II și III, și subpunctele)' : ''}
      </div>
      <BifeExercitii layout={layout} sel={sel} onChange={setSel} disabled={!!busy} />
      <div style={{ fontSize: '.74rem', color: 'var(--text-muted)', marginTop: 6, lineHeight: 1.5 }}>
        {!subjects.length
          ? <span style={{ color: '#b71c1c' }}>Bifează cel puțin un exercițiu.</span>
          : complet
            ? <>Testul complet păstrează <strong>coperta oficială</strong> a unuia dintre subiectele-sursă (la BAC, antetul probei) — 90 de puncte + 10 din oficiu.</>
            : <>
                <strong>{alese ? selectionSummary(selN, layout) : sl}</strong> — {pointsLabel(puncte)}. În locul copertei (care vorbește de toate subiectele și de timpul examenului), fiecare test primește un <strong>antet scurt</strong>: titlul, subiectele și „Numele și prenumele".
                {alese && <> Un subiect din care lipsește ceva are titlul cu punctajul bifat; exercițiile își păstrează numărul din subiectul oficial{layout.parts[2] ? ', iar la o problemă cu doar unele subpuncte intră enunțul ei și subpunctele bifate' : ''}.</>}
              </>}
      </div>

      {ai && <OptiuneSpatiuLucru value={workSpace} onChange={setWorkSpace} compact style={{ marginTop: 10 }} />}

      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', marginTop: 12 }}>
        <button type="button" className="btn btn-primary" onClick={genereaza} disabled={!!busy || !subjects.length}>
          {busy ? 'Se generează…' : ai
            ? `🔢 Generează ${n} ${n === 1 ? 'test' : 'teste'} cu numerele schimbate (${subjects.length ? eticheta : 'nimic bifat'})`
            : `📎 Generează ${n} ${n === 1 ? 'test PDF' : 'teste PDF'} (${subjects.length ? eticheta : 'nimic bifat'})`}
        </button>
        {(ai ? rezultatAI?.gata : rezultat?.gata) && !busy && (
          <button type="button" className="btn btn-outline btn-sm" onClick={genereaza}>🔄 Generează alt set</button>
        )}
      </div>
      {ai && !busy && (
        <div style={{ fontSize: '.74rem', color: 'var(--text-muted)', marginTop: 6 }}>
          Cost estimat: ~{fmtEstimare(crediteAI)} pentru {n} {n === 1 ? 'test' : 'teste'} ({n} {n === 1 ? 'apel' : 'apeluri'} AI){n > 10 ? ' — pentru mai puține credite, păstrează datele (combinarea exactă e gratuită)' : ''}.
        </div>
      )}
      {busy && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10, fontSize: '.8rem', color: 'var(--text-muted)' }}>
          <div className="spinner" style={{ width: 16, height: 16 }} /> {busy}
        </div>
      )}
      {err && <div style={{ marginTop: 10, fontSize: '.82rem', color: '#b71c1c' }}>⚠️ {err}</div>}

      {/* Testele compuse de AI (numere schimbate) */}
      {ai && rezultatAI && rezultatAI.teste.length > 0 && (
        <ListaTesteExam rezultat={rezultatAI} publish={publish} workSpace={workSpace} />
      )}

      {/* Testele create */}
      {!ai && rezultat && rezultat.teste.length > 0 && (
        <div style={{ marginTop: 12, background: 'rgba(39,174,96,.08)', border: '1px solid rgba(39,174,96,.35)', borderRadius: 10, padding: 12 }}>
          <div style={{ fontWeight: 700, color: '#1e7e34', fontSize: '.86rem', marginBottom: 4 }}>
            {rezultat.gata ? '✅' : '⏳'} {rezultat.teste.length}{rezultat.gata ? '' : ` din ${rezultat.total}`} {rezultat.teste.length === 1 ? 'test PDF' : (rezultat.gata ? 'teste PDF diferite' : 'variante')} — {rezultat.examen} · {rezultat.subiecte}
          </div>
          {rezultat.gata && (
            <SetSalvat set={rezultat.set} count={rezultat.teste.length} publish={publish}>
              {rezultat.set && rezultat.set.blob && (
                <>
                  <button type="button" className="btn btn-sm btn-primary" onClick={() => descarca(rezultat.set.blob, `${slug(rezultat.set.title)}.pdf`)}>
                    ⬇ Descarcă PDF-ul cu toate cele {rezultat.teste.length} variante
                  </button>
                  <button type="button" className="btn btn-sm btn-outline" onClick={() => vezi(rezultat.set)}>👁 Vezi</button>
                  <span style={{ fontSize: '.72rem', color: 'var(--text-muted)', alignSelf: 'center' }}>
                    {rezultat.set.pages} pagini · {marime(rezultat.set.size)}
                  </span>
                </>
              )}
            </SetSalvat>
          )}
          {!(rezultat.set && !rezultat.set.error) && (
            <p style={{ fontSize: '.77rem', color: 'var(--text-muted)', margin: '0 0 8px', lineHeight: 1.5 }}>
              Salvate în „Testele și exercițiile mele"{publish ? <> · publicate în „Biblioteca utilizatorilor": {publicate} din {rezultat.teste.length}
              {publicate < rezultat.teste.length && rezultat.gata ? ' (restul le poți publica din „Testele și exercițiile mele" → 🏛️ Publică)' : ''}.
              {' '}În bibliotecă sunt ⭐ premium, ca orice material publicat; elevii tăi le primesc gratuit prin testul pe grupă.</> : '.'}
            </p>
          )}
          {rezultat.intrerupt && (
            <div style={{ fontSize: '.77rem', color: '#b26a00', marginBottom: 8 }}>
              ⚠️ Generarea s-a oprit înainte de capăt — au rămas {rezultat.teste.length} teste, folosibile.
            </div>
          )}
          {rezultat.teste.some((t) => t.intregi) && (
            <div style={{ fontSize: '.77rem', color: '#b26a00', marginBottom: 8 }}>
              ⚠️ La unele probleme, subpunctele nu s-au putut separa în niciun PDF-sursă — au intrat întregi (vezi „▸ Sursele" la fiecare test).
            </div>
          )}
          {rezultat.gata && Number.isFinite(rezultat.maxDiferite) && rezultat.maxDiferite < rezultat.teste.length && (
            <div style={{ fontSize: '.77rem', color: '#b26a00', marginBottom: 8 }}>
              ⚠️ Din subiectele găsite se pot face cel mult {rezultat.maxDiferite} teste diferite cu {rezultat.subiecte} — unele teste se repetă.
            </div>
          )}
          {rezultat.gata && rezultat.teste.length > 1 && !(rezultat.set && !rezultat.set.error) && (
            <button type="button" className="btn btn-outline btn-sm" style={{ marginBottom: 8 }} onClick={descarcaToate} disabled={toateBusy}>
              {toateBusy ? 'Unesc PDF-urile…' : `⬇ Descarcă toate testele într-un singur PDF (de tipărit)`}
            </button>
          )}
          <div style={{ display: 'grid', gap: 6, maxHeight: 360, overflowY: 'auto' }}>
            {rezultat.teste.map((t, i) => (
              <div key={t.privateId || i} style={{ background: '#fff', border: '1px solid var(--border)', borderRadius: 8, padding: '7px 10px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <div style={{ flex: '1 1 220px', minWidth: 0 }}>
                    <div style={{ fontWeight: 600, color: 'var(--navy)', fontSize: '.83rem' }}>📄 {t.title}</div>
                    <div style={{ fontSize: '.72rem', color: 'var(--text-muted)' }}>
                      {t.pages} {t.pages === 1 ? 'pagină' : 'pagini'} · {marime(t.size)} · {t.report.length} {t.report.length === 1 ? 'exercițiu' : 'exerciții'}
                      {t.points ? ` · ${pointsLabel(t.points)}` : ''}
                      {t.publicId ? ' · 🏛️ în bibliotecă' : ''}
                      {t.publishError ? <span style={{ color: '#b26a00' }}> · nepublicat ({t.publishError})</span> : null}
                      {t.duplicate ? <span style={{ color: '#b26a00' }}> · identic cu un test anterior</span> : null}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                    <button type="button" className="btn btn-sm btn-primary" onClick={() => descarca(t.blob, `${slug(t.title)}.pdf`)}>⬇ Descarcă</button>
                    <button type="button" className="btn btn-sm btn-outline" onClick={() => vezi(t)}>👁 Vezi</button>
                    <button type="button" className="btn btn-sm btn-outline" onClick={() => setDeschis(deschis === i ? null : i)}>
                      {deschis === i ? '▾ Sursele' : '▸ Sursele'}
                    </button>
                  </div>
                </div>
                {deschis === i && (
                  <div style={{ marginTop: 6, fontSize: '.74rem', color: 'var(--text-muted)', whiteSpace: 'pre-wrap' }}>
                    {t.report.join('\n')}
                  </div>
                )}
              </div>
            ))}
          </div>
          {rezultat.surse?.length > 0 && (
            <details style={{ marginTop: 8, fontSize: '.74rem', color: 'var(--text-muted)' }}>
              <summary style={{ cursor: 'pointer' }}>Subiectele-sursă folosite ({rezultat.surse.length})</summary>
              <div style={{ marginTop: 4, whiteSpace: 'pre-wrap' }}>{rezultat.surse.join('\n')}</div>
            </details>
          )}
        </div>
      )}
    </div>
  );
}
