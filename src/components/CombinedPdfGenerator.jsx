// =====================================================================
// src/components/CombinedPdfGenerator.jsx — „⚡ Generează acum testele" în PDF
//
// Se deschide în „👥 Test pe grupă", la pasul „Alege numărul de teste și de
// unde vin", când profesorul bifează „⚡ Generează acum testele" și formatul e
// 📄 PDF (cerut pe 31 oct. 2026). Face atâtea teste PDF câte se cer în bazin,
// fiecare COMBINAT EXACT din subiectele PDF ale site-ului — ca la „📄 Generează
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
//   • testele intră bifate în bazinul testului pe grupă (sursa „🧩 Testele
//     generate de mine"), ca variantele interactive (src/components/VariantGenerator.jsx).
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
function BifeExercitii({ layout, sel, onChange, disabled }) {
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
  poolSize = 10,     // câte teste se cer (= câte intră în bazin)
  category = '',     // categoria aleasă la pasul 1 al testului pe grupă
  onCategory,        // (categorie) → testul pe grupă primește categoria examenului generat
  onDone,            // (items) → testele generate intră bifate în bazin
  onError,
}) {
  const [examType, setExamType] = useState(() => examFromCategory(category));
  // exercițiile bifate (implicit toate) — alegerile rapide de mai sus le bifează pe subiecte
  const [sel, setSel] = useState(() => fullSelection(examLayout(examFromCategory(category))));
  const [busy, setBusy] = useState(null);         // eticheta pasului în curs
  const [err, setErr] = useState(null);
  const [rezultat, setRezultat] = useState(null); // { teste, surse, ... }
  const [deschis, setDeschis] = useState(null);   // testul cu raportul desfăcut
  const [toateBusy, setToateBusy] = useState(false);
  // generatorul închis în timpul generării (alt format, „Generează acum" debifat):
  // ce s-a salvat rămâne în „Testele mele", dar nu mai intră în bazinul testului
  const viu = useRef(true);
  useEffect(() => { viu.current = true; return () => { viu.current = false; }; }, []);

  // categoria schimbată la pasul 1 → examenul de aici o urmează
  useEffect(() => {
    if (category === 'evaluare-nationala') setExamType('evaluare-nationala');
    else if (category === 'bacalaureat') setExamType((t) => (t.startsWith('bac-') ? t : 'bac-mate-info'));
  }, [category]);

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

  async function genereaza() {
    setErr(null); setRezultat(null); setDeschis(null);
    if (!subjects.length) { setErr('Bifează cel puțin un exercițiu.'); return; }
    const cfg = EXAM_SOURCES[examType] || EXAM_SOURCES['evaluare-nationala'];
    // testul pe grupă primește categoria examenului din care vin testele
    if (cfg.category !== category) onCategory?.(cfg.category);
    const selectie = selN;
    const info = { examen: exam.short, subiecte: complet ? 'toate subiectele' : eticheta };
    const teste = [];
    let surse = [];
    let maxDiferite = Infinity;
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
      let nr = await aiClient.nextCombinedTestNumber().catch(() => 1);
      const topic = `${sl}${cfg.profile ? ` · M_${cfg.profile}` : ''}`;

      for (const plan of planuri) {
        if (!viu.current) return;
        const titlu = `Test combinat nr. ${nr} — ${exam.short}${complet ? '' : ` · ${sl}`}${alese ? ' (exerciții alese)' : ''}`;
        const nrTest = nr;
        setBusy(`Testul ${plan.index} din ${planuri.length}: compun PDF-ul…`);
        // eslint-disable-next-line no-await-in-loop
        const r = await composeExamPdf(prep, plan, {
          subjects, srcDocs: docs, selection: selectie,
          // testele parțiale: antet scurt în locul copertei (care vorbește de toate subiectele)
          header: complet ? null : (latime, info2) => makeHeaderPng({
            title: exam.head,
            subtitle: `Test de antrenament · ${sl}${alese ? ' (exerciții alese)' : ''} — ${pointsLabel(info2?.points ?? puncte)}`,
            right: `Test combinat nr. ${nrTest}`,
          }, { widthPt: latime }),
        });
        const blob = new Blob([r.bytes], { type: 'application/pdf' });
        setBusy(`Testul ${plan.index} din ${planuri.length}: îl salvez în „Testele mele" și îl public în bibliotecă…`);
        // eslint-disable-next-line no-await-in-loop
        const s = await aiClient.saveCombinedPdf({
          title: titlu, category: cfg.category, topic, blob,
          extra: {
            // textul testului (doar exercițiile așezate) — îl citește Profesorul Virtual
            sources: r.sources, text: r.text, pageTexts: r.pageTexts, pages: r.pages,
            combined: { exam: examType, subjects, nr: nrTest, report: r.report, points: r.points, ...(complet ? {} : { selection: selectie }) },
          },
        });
        teste.push({
          ...s, nr: nrTest, blob, size: r.size, pages: r.pages, report: r.report, duplicate: plan.duplicate,
          points: r.points, intregi: (r.wholeFallback || []).length,
        });
        setRezultat({ ...info, teste: [...teste], surse, maxDiferite, gata: false, total: planuri.length });
        nr += 1;
      }
      setRezultat({ ...info, teste: [...teste], surse, maxDiferite, gata: true, total: teste.length });
      if (viu.current) onDone?.(teste.map((t) => ({ source: 'personal', refId: t.privateId, title: t.title, isFree: true })));
    } catch (e) {
      setErr(e.message || 'Generarea testelor a eșuat.');
      onError?.(e);
      // ce s-a salvat până la eroare rămâne folosibil (și e deja în „Testele mele")
      if (teste.length) {
        setRezultat({ ...info, teste: [...teste], surse, maxDiferite, gata: true, total: teste.length, intrerupt: true });
        if (viu.current) onDone?.(teste.map((t) => ({ source: 'personal', refId: t.privateId, title: t.title, isFree: true })));
      }
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

  return (
    <div style={box}>
      <div style={{ fontSize: '.86rem', fontWeight: 700, color: 'var(--navy)', marginBottom: 4 }}>
        📎 Generează acum testele — {n} {n === 1 ? 'test PDF combinat' : 'teste PDF combinate'} din subiectele site-ului
      </div>
      <p style={{ fontSize: '.79rem', color: 'var(--text-light)', margin: '0 0 6px', lineHeight: 1.55 }}>
        Ca la <strong>„📄 Generează subiect examen" → „Combină exact"</strong>: exercițiile sunt <strong>decupate din
        subiectele PDF ale site-ului</strong> (variante date, modele, simulări, teste de antrenament) și așezate pe
        <strong> aceeași poziție</strong> — exercițiul 3 de la Subiectul II vine dintre exercițiile 3 de la Subiectul II.
        Redactarea e identică cu originalele, fără AI și fără cost. <strong>Testele diferă între ele</strong>: pe fiecare
        poziție, alt test-sursă.
        <br />Fiecare PDF se <strong>salvează</strong> în „Testele și exercițiile mele", se <strong>publică</strong> în
        „Biblioteca utilizatorilor" și se poate <strong>descărca</strong>.
      </p>

      <div style={lbl}>Examenul</div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {EXAM_TYPES.map((t) => (
          <button key={t.id} type="button" style={chip(examType === t.id)} disabled={!!busy}
            onClick={() => setExamType(t.id)} title={t.desc}>{t.label}</button>
        ))}
      </div>
      {esteClasa && (
        <div style={{ fontSize: '.74rem', color: '#b26a00', marginTop: 6 }}>
          Combinarea folosește subiectele oficiale de examen (EN sau BAC) — testul pe grupă va avea categoria examenului ales.
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

      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', marginTop: 12 }}>
        <button type="button" className="btn btn-primary" onClick={genereaza} disabled={!!busy || !subjects.length}>
          {busy ? 'Se generează…' : `📎 Generează ${n} ${n === 1 ? 'test PDF' : 'teste PDF'} (${subjects.length ? eticheta : 'nimic bifat'})`}
        </button>
        {rezultat?.gata && !busy && (
          <button type="button" className="btn btn-outline btn-sm" onClick={genereaza}>🔄 Generează alt set</button>
        )}
      </div>
      {busy && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10, fontSize: '.8rem', color: 'var(--text-muted)' }}>
          <div className="spinner" style={{ width: 16, height: 16 }} /> {busy}
        </div>
      )}
      {err && <div style={{ marginTop: 10, fontSize: '.82rem', color: '#b71c1c' }}>⚠️ {err}</div>}

      {/* Testele create */}
      {rezultat && rezultat.teste.length > 0 && (
        <div style={{ marginTop: 12, background: 'rgba(39,174,96,.08)', border: '1px solid rgba(39,174,96,.35)', borderRadius: 10, padding: 12 }}>
          <div style={{ fontWeight: 700, color: '#1e7e34', fontSize: '.86rem', marginBottom: 4 }}>
            {rezultat.gata ? '✅' : '⏳'} {rezultat.teste.length}{rezultat.gata ? '' : ` din ${rezultat.total}`} {rezultat.teste.length === 1 ? 'test PDF' : 'teste PDF'} — {rezultat.examen} · {rezultat.subiecte}
          </div>
          <p style={{ fontSize: '.77rem', color: 'var(--text-muted)', margin: '0 0 8px', lineHeight: 1.5 }}>
            {rezultat.gata && <>Sunt deja bifate în bazinul testului pe grupă — apasă „🔗 Creează linkul testului" mai jos. </>}
            Salvate în „Testele și exercițiile mele" · publicate în „Biblioteca utilizatorilor": {publicate} din {rezultat.teste.length}
            {publicate < rezultat.teste.length && rezultat.gata ? ' (restul le poți publica din „Testele și exercițiile mele" → 🏛️ Publică)' : ''}.
            {' '}În bibliotecă sunt ⭐ premium, ca orice material publicat; elevii tăi le primesc gratuit prin testul pe grupă.
          </p>
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
          {rezultat.gata && rezultat.teste.length > 1 && (
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
