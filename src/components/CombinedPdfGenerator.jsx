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
  SUBJECT_CHOICES, subjectsLabel, subjectsPoints, isFullTest,
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

export default function CombinedPdfGenerator({
  poolSize = 10,     // câte teste se cer (= câte intră în bazin)
  category = '',     // categoria aleasă la pasul 1 al testului pe grupă
  onCategory,        // (categorie) → testul pe grupă primește categoria examenului generat
  onDone,            // (items) → testele generate intră bifate în bazin
  onError,
}) {
  const [examType, setExamType] = useState(() => examFromCategory(category));
  const [subjId, setSubjId] = useState('toate');
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

  const n = Math.max(1, Math.min(60, parseInt(poolSize, 10) || 1));
  const alegere = SUBJECT_CHOICES.find((c) => c.id === subjId) || SUBJECT_CHOICES[0];
  const subjects = alegere.subjects;
  const complet = isFullTest(subjects);
  const exam = EXAM_NAME[examType] || EXAM_NAME['evaluare-nationala'];
  const esteClasa = /^clasa-/.test(category || '');

  async function genereaza() {
    setErr(null); setRezultat(null); setDeschis(null);
    const cfg = EXAM_SOURCES[examType] || EXAM_SOURCES['evaluare-nationala'];
    // testul pe grupă primește categoria examenului din care vin testele
    if (cfg.category !== category) onCategory?.(cfg.category);
    const sl = subjectsLabel(subjects);
    const info = { examen: exam.short, subiecte: complet ? 'toate subiectele' : sl };
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
      maxDiferite = maxDistinctTests(prep.list, subjects);
      const planuri = planCombinations(prep.list, { count: n, subjects });
      setBusy('Pregătesc subiectele-sursă…');
      const docs = await openSourceDocs(prep.list);
      let nr = await aiClient.nextCombinedTestNumber().catch(() => 1);
      const topic = `${sl}${cfg.profile ? ` · M_${cfg.profile}` : ''}`;

      for (const plan of planuri) {
        if (!viu.current) return;
        const titlu = `Test combinat nr. ${nr} — ${exam.short}${complet ? '' : ` · ${sl}`}`;
        const nrTest = nr;
        setBusy(`Testul ${plan.index} din ${planuri.length}: compun PDF-ul…`);
        // eslint-disable-next-line no-await-in-loop
        const r = await composeExamPdf(prep, plan, {
          subjects, srcDocs: docs,
          // testele parțiale: antet scurt în locul copertei (care vorbește de toate subiectele)
          header: complet ? null : (latime) => makeHeaderPng({
            title: exam.head,
            subtitle: `Test de antrenament · ${sl} (${subjectsPoints(subjects)} de puncte)`,
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
            combined: { exam: examType, subjects, nr: nrTest, report: r.report },
          },
        });
        teste.push({ ...s, nr: nrTest, blob, size: r.size, pages: r.pages, report: r.report, duplicate: plan.duplicate });
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
          <button key={c.id} type="button" style={chip(subjId === c.id)} disabled={!!busy}
            onClick={() => setSubjId(c.id)} aria-pressed={subjId === c.id}>{c.label}</button>
        ))}
      </div>
      <div style={{ fontSize: '.74rem', color: 'var(--text-muted)', marginTop: 6, lineHeight: 1.5 }}>
        {complet
          ? <>Testul complet păstrează <strong>coperta oficială</strong> a unuia dintre subiectele-sursă (la BAC, antetul probei) — 90 de puncte + 10 din oficiu.</>
          : <>{subjectsLabel(subjects)} — {subjectsPoints(subjects)} de puncte. În locul copertei (care vorbește de toate subiectele și de timpul examenului), fiecare test primește un <strong>antet scurt</strong>: titlul, „{subjectsLabel(subjects)}" și „Numele și prenumele".</>}
      </div>

      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', marginTop: 12 }}>
        <button type="button" className="btn btn-primary" onClick={genereaza} disabled={!!busy}>
          {busy ? 'Se generează…' : `📎 Generează ${n} ${n === 1 ? 'test PDF' : 'teste PDF'} (${complet ? 'Subiectele I, II și III' : subjectsLabel(subjects)})`}
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
                      {t.pages} {t.pages === 1 ? 'pagină' : 'pagini'} · {marime(t.size)} · {t.report.length} exerciții
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
