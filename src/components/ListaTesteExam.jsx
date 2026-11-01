// =====================================================================
// src/components/ListaTesteExam.jsx — lista testelor generate ca „exam"
// (JSON tipăribil — src/lib/examPrint.js), la „👥 Teste diferite / elev":
//   • testele din subiectele de examen cu „🔢 numerele schimbate" (AI);
//   • testele din fișele claselor 5–12, în format PDF.
// Fiecare test: „📄 PDF" (varianta elevului) și, dacă are rezolvări, „📝 Barem".
// Mai multe teste = un SET, salvat ca UN SINGUR PDF („25 de teste grilă
// diferite, pentru 25 de elevi", fiecare test cu „Varianta k" — src/lib/testeSet.js):
// deasupra, „📄 PDF — toate cele N variante" și „📝 Baremul tuturor variantelor".
// =====================================================================
import { useState } from 'react';
import { printExam, printExams } from '../lib/examPrint';
import VerificationNote from './VerificationNote';

const nrItemi = (ex) => (ex?.subjects || []).reduce((n, s) => n + (s.items || []).length, 0);
// testul are ce pune în barem? (răspunsuri / rezolvări — testele din fișe cu
// datele păstrate nu au: exercițiile sunt copiate exact din fișă)
export const areBarem = (ex) => (ex?.subjects || []).some((s) => (s.items || []).some((it) =>
  (it.answer != null && String(it.answer).trim()) || (it.solution && String(it.solution).trim())
  || (Array.isArray(it.parts) && it.parts.some((p) => p && p.solution))));

// SETUL salvat ca UN SINGUR PDF („25 de teste grilă diferite, pentru 25 de elevi",
// src/lib/testeSet.js) — cu butoanele lui (`children`)
export function SetSalvat({ set, count, publish = true, children = null }) {
  if (!set) return null;
  if (set.error) {
    return (
      <div style={{ fontSize: '.78rem', color: '#b26a00', marginBottom: 8 }}>
        ⚠️ Testele nu s-au putut uni într-un singur PDF ({set.error}) — au rămas salvate separat, în „Testele și exercițiile mele".
      </div>
    );
  }
  return (
    <div style={{ background: '#fff', border: '2px solid rgba(39,174,96,.55)', borderRadius: 10, padding: '9px 11px', marginBottom: 10 }}>
      <div style={{ fontWeight: 800, color: 'var(--navy)', fontSize: '.88rem' }}>📚 Salvate într-un singur PDF: „{set.title}"</div>
      <div style={{ fontSize: '.75rem', color: 'var(--text-muted)', margin: '3px 0 7px', lineHeight: 1.5 }}>
        Fiecare test începe cu <strong>„Varianta 1", „Varianta 2"…</strong> (până la „Varianta {count}"). În „Testele și exercițiile mele" apare doar acest PDF
        {publish ? (set.publicId
          ? <> · 🏛️ publicat în „Biblioteca utilizatorilor"{set.publicTitle && set.publicTitle !== set.title ? ` ca „${set.publicTitle}"` : ''}</>
          : set.publishError ? <span style={{ color: '#b26a00' }}> · nepublicat ({set.publishError}) — îl poți publica din „Testele și exercițiile mele"</span> : null) : null}
        . Variantele sunt păstrate și separat, ascunse în spatele lui: pe ele le folosește „👥 Test interactiv pe grupă", câte una pentru fiecare elev.
      </div>
      {children && <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>{children}</div>}
    </div>
  );
}

export default function ListaTesteExam({ rezultat, publish = true, titlu = null, workSpace }) {
  const [deschis, setDeschis] = useState(null);
  if (!rezultat || !rezultat.teste?.length) return null;
  const teste = rezultat.teste;
  const cuBarem = teste.some((t) => areBarem(t.exam));
  const publicate = teste.filter((t) => t.publicId).length;
  const ws = typeof workSpace === 'boolean' ? workSpace : undefined;
  const set = rezultat.set && !rezultat.set.error ? rezultat.set : null;
  return (
    <div style={{ marginTop: 12, background: 'rgba(39,174,96,.08)', border: '1px solid rgba(39,174,96,.35)', borderRadius: 10, padding: 12 }}>
      <div style={{ fontWeight: 700, color: '#1e7e34', fontSize: '.86rem', marginBottom: 4 }}>
        {rezultat.gata ? '✅' : '⏳'} {teste.length}{rezultat.gata ? '' : ` din ${rezultat.total}`} {teste.length === 1 ? 'test' : (rezultat.gata ? 'teste diferite' : 'variante')}
        {titlu ? ` — ${titlu}` : rezultat.examen ? ` — ${rezultat.examen} · ${rezultat.subiecte}` : ''}
      </div>
      {rezultat.gata && (
        <SetSalvat set={rezultat.set} count={teste.length} publish={publish}>
          {set && set.exam && (
            <>
              <button type="button" className="btn btn-sm btn-primary" onClick={() => printExam(set.exam, { workSpace: ws })}>📄 PDF — toate cele {teste.length} variante</button>
              {cuBarem && <button type="button" className="btn btn-sm btn-outline" onClick={() => printExam(set.exam, { withSolutions: true })}>📝 Baremul tuturor variantelor</button>}
            </>
          )}
        </SetSalvat>
      )}
      <p style={{ fontSize: '.77rem', color: 'var(--text-muted)', margin: '0 0 8px', lineHeight: 1.5 }}>
        {set ? null : <>Salvate în „Testele și exercițiile mele"
          {publish ? <> · publicate în „Biblioteca utilizatorilor": {publicate} din {teste.length}{publicate < teste.length && rezultat.gata ? ' (restul le poți publica din „Testele și exercițiile mele" → 🏛️ Publică)' : ''}</> : ''}. </>}
        Se tipăresc din fereastra de print („Salvează ca PDF").
        {!cuBarem && <> Exercițiile sunt copiate exact din fișe, deci testele <strong>nu au barem</strong> — pentru rezolvări, alege „🔢 Schimbă numerele" sau formatul interactiv.</>}
      </p>
      {rezultat.intrerupt && (
        <div style={{ fontSize: '.77rem', color: '#b26a00', marginBottom: 8 }}>
          ⚠️ Generarea s-a oprit înainte de capăt — au rămas {teste.length} teste, folosibile.
        </div>
      )}
      {rezultat.gata && !set && teste.length > 1 && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
          <button type="button" className="btn btn-outline btn-sm" onClick={() => printExams(teste.map((t) => t.exam), { workSpace: ws, title: `${teste.length} teste` })}>
            🖨 Tipărește toate testele ({teste.length}, fiecare de la pagină nouă)
          </button>
          {cuBarem && (
            <button type="button" className="btn btn-outline btn-sm" onClick={() => printExams(teste.map((t) => t.exam), { withSolutions: true, title: `Barem · ${teste.length} teste` })}>
              📝 Toate baremele
            </button>
          )}
        </div>
      )}
      <div style={{ display: 'grid', gap: 6, maxHeight: 360, overflowY: 'auto' }}>
        {teste.map((t, i) => (
          <div key={t.privateId || i} style={{ background: '#fff', border: '1px solid var(--border)', borderRadius: 8, padding: '7px 10px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <div style={{ flex: '1 1 220px', minWidth: 0 }}>
                <div style={{ fontWeight: 600, color: 'var(--navy)', fontSize: '.83rem' }}>📄 {t.title}</div>
                <div style={{ fontSize: '.72rem', color: 'var(--text-muted)' }}>
                  {nrItemi(t.exam)} {nrItemi(t.exam) === 1 ? 'exercițiu' : 'exerciții'}
                  {t.exam?.totalPoints ? ` · ${t.exam.totalPoints} de puncte` : ''}
                  {t.exam?.durationMin ? ` · ${t.exam.durationMin} min` : ''}
                  {t.repeats ? <span style={{ color: '#b26a00' }}> · {t.repeats} {t.repeats === 1 ? 'exercițiu repetat' : 'exerciții repetate'} din testele de dinainte</span> : null}
                  {t.publicId ? ' · 🏛️ în bibliotecă' : ''}
                  {t.publishError ? <span style={{ color: '#b26a00' }}> · nepublicat ({t.publishError})</span> : null}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                <button type="button" className="btn btn-sm btn-primary" onClick={() => printExam(t.exam, { workSpace: ws })}>📄 PDF</button>
                {areBarem(t.exam) && (
                  <button type="button" className="btn btn-sm btn-outline" onClick={() => printExam(t.exam, { withSolutions: true })}>📝 Barem</button>
                )}
                {t.verification && (
                  <button type="button" className="btn btn-sm btn-outline" onClick={() => setDeschis(deschis === i ? null : i)}>
                    {deschis === i ? '▾ Verificarea' : '▸ Verificarea'}
                  </button>
                )}
              </div>
            </div>
            {deschis === i && t.verification && <VerificationNote report={t.verification} style={{ marginTop: 6, marginBottom: 0 }} />}
          </div>
        ))}
      </div>
    </div>
  );
}
