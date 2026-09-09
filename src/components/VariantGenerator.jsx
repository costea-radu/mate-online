// =====================================================================
// src/components/VariantGenerator.jsx — „⚡ Generează acum testele"
//
// Se deschide în „👥 Test pe grupă", la pasul „Alege numărul de teste și de
// unde vin", când profesorul bifează sursa „⚡ Generează acum testele".
// Aduce ACOLO, în pagină, formularul din „🧩 Generează exerciții/teste
// interactive/PDF" (src/components/InteractiveGenForm.jsx — același component,
// ca alegerile să fie identice în ambele locuri) și face, dintr-o singură
// generare, atâtea VARIANTE câte teste s-au cerut în bazin:
//
//   • aceleași probleme în toate variantele, dar în ALTĂ ORDINE — problema de
//     la punctul 1 la o variantă e la punctul 4 la alta;
//   • la grilă, ALTĂ literă corectă — o problemă cu răspunsul a) are la altă
//     variantă răspunsul b), c) sau d).
//
// Fiecare variantă se salvează în „Testele și exercițiile mele"
// (ai_personal_items, kind='interactive') și intră automat, bifată, în bazinul
// testului pe grupă — sursa „🧩 Testele generate de mine".
//
// Amestecul propriu-zis: src/lib/testVariante.js (makeVariants).
// =====================================================================
import { useEffect, useState } from 'react';
import { aiClient } from '../lib/aiClient';
import InteractiveGenForm, { useInteractiveGen } from './InteractiveGenForm';
import { makeVariants, numeVarianta } from '../lib/testVariante';
import { invatăDinReal, crediteDinCost, fmtEstimare } from '../lib/aiCost';
import { MathText } from './AITutor';

const LITERE = 'abcdefghij';

export default function VariantGenerator({
  poolSize = 10,          // câte variante se cer (= câte teste intră în bazin)
  category = '',          // categoria aleasă la pasul 1 al testului pe grupă
  durationMin = 0,        // timpul de lucru ales la pasul 5 (0 = fără limită)
  onDone,                 // (items) → testele generate intră bifate în bazin
  onError,
}) {
  const [busy, setBusy] = useState(null);      // eticheta pasului în curs
  const [err, setErr] = useState(null);
  const [rezultat, setRezultat] = useState(null); // { titlu, variante:[{...}] }
  const [cost, setCost] = useState(null);         // costul REAL, întors de server
  const [vizibila, setVizibila] = useState(null); // varianta deschisă la „vezi"

  const g = useInteractiveGen({ kind: 'test', count: 10, qtype: 'grila', category, output: 'interactive' });
  const { setCategory, setDurationMin } = g;

  // categoria și timpul de lucru se iau din pașii testului pe grupă
  useEffect(() => { setCategory(category || ''); }, [category, setCategory]);
  useEffect(() => { if (durationMin) setDurationMin(durationMin); }, [durationMin, setDurationMin]);

  const nVariante = Math.max(1, Math.min(60, parseInt(poolSize, 10) || 1));

  async function genereaza() {
    setErr(null); setRezultat(null); setVizibila(null); setCost(null);
    try {
      setBusy(`Se generează testul… (${g.itemCount > 10 ? '~30–60s' : '~20s'})`);
      const res = await aiClient.generateInteractive(g.payload({ kind: 'test', count: g.itemCount }));
      // costul real al generării (variantele nu mai costă nimic — amestecul
      // se face aici, în browser) + calibrarea estimării de sub buton
      setCost(crediteDinCost(res.cost));
      invatăDinReal(res.cost, { kind: 'test', count: g.itemCount, qtype: g.qtype });
      const qs = res.questions || [];
      if (!qs.length) throw new Error('Generatorul nu a întors nicio întrebare. Încearcă din nou sau schimbă capitolele.');
      const titlu = res.title || `Test · ${g.itemCount} itemi`;

      const variante = makeVariants(qs, nVariante);
      const meta = g.quizMeta();
      const salvate = [];
      for (const v of variante) {
        setBusy(`Salvez varianta ${v.index} din ${variante.length}…`);
        const title = numeVarianta(titlu, v.index);
        // eslint-disable-next-line no-await-in-loop
        const id = await aiClient.saveLibraryItem({
          kind: 'interactive', title, category: g.category || null, topic: g.topicShort,
          payload: { questions: v.questions, meta, variantaDin: titlu, variantaNr: v.index, variante: variante.length },
        });
        salvate.push({ source: 'personal', refId: id, title, isFree: true, questions: v.questions });
      }
      setRezultat({ titlu, variante: salvate, itemi: qs.length });
      onDone?.(salvate);
    } catch (e) {
      setErr(e.message); onError?.(e);
    } finally { setBusy(null); }
  }

  const box = { border: '2px dashed var(--gold)', borderRadius: 12, background: 'rgba(232,185,49,.06)', padding: 14, marginTop: 12 };

  return (
    <div style={box}>
      <div style={{ fontSize: '.86rem', fontWeight: 700, color: 'var(--navy)', marginBottom: 4 }}>
        ⚡ Generează acum testele — {nVariante} {nVariante === 1 ? 'variantă' : 'variante'} ale aceluiași test
      </div>
      <p style={{ fontSize: '.79rem', color: 'var(--text-light)', margin: '0 0 10px', lineHeight: 1.55 }}>
        AI-ul face <strong>un singur test</strong>, iar noi îl dăm în {nVariante} variante:
        aceleași probleme la toți elevii, dar <strong>în altă ordine</strong> (problema de la punctul 1
        la un elev e la punctul 4 la altul) și, la grilă, <strong>cu altă literă corectă</strong>
        (o problemă cu răspunsul a) are la alt test răspunsul b), c) sau d)). Nu se mai poate copia de
        la coleg, deși toți dau același test.
        <br />Variantele se salvează și în „Testele și exercițiile mele", ca să le poți refolosi sau tipări.
      </p>

      {/* ACELAȘI formular ca la „🧩 Generează exerciții/teste interactive/PDF" */}
      <InteractiveGenForm g={g} showOutput={false}
        cardStyle={{ background: '#fff', border: '1px solid var(--border)', borderRadius: 12, padding: 16, marginBottom: 0 }}
        costExtra={<span>— <strong>atât, pentru toate cele {nVariante} variante</strong>: AI-ul e chemat o singură dată, iar amestecul se face în pagină, fără cost</span>}>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
          <button className="btn btn-primary" onClick={genereaza} disabled={!!busy || !!g.srcBusy}>
            {busy || `✨ Generează testul în ${nVariante} ${nVariante === 1 ? 'variantă' : 'variante'} (${g.itemCount} itemi)`}
          </button>
          {rezultat && !busy && (
            <button className="btn btn-outline btn-sm" onClick={genereaza}>🔄 Alt test</button>
          )}
        </div>
        {g.qtype === 'redactare' && (
          <div style={{ fontSize: '.76rem', color: '#b26a00', marginTop: 8 }}>
            ⚠️ La „cu redactarea răspunsului" nu există variante de răspuns, deci între teste diferă
            doar <strong>ordinea problemelor</strong>. Pentru litere corecte diferite, alege „🔘 Doar grilă" sau „🔀 Mixt".
          </div>
        )}
        {busy && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10, fontSize: '.8rem', color: 'var(--text-muted)' }}>
            <div className="spinner" style={{ width: 16, height: 16 }} /> {busy}
          </div>
        )}
        {err && <div style={{ marginTop: 10, fontSize: '.82rem', color: '#b71c1c' }}>⚠️ {err}</div>}
      </InteractiveGenForm>

      {/* Variantele create */}
      {rezultat && (
        <div style={{ marginTop: 12, background: 'rgba(39,174,96,.08)', border: '1px solid rgba(39,174,96,.35)', borderRadius: 10, padding: 12 }}>
          <div style={{ fontWeight: 700, color: '#1e7e34', fontSize: '.86rem', marginBottom: 6 }}>
            ✅ {rezultat.variante.length} variante gata — „{rezultat.titlu}" · {rezultat.itemi} itemi
            {cost ? <span style={{ fontWeight: 600, color: 'var(--text-muted)' }}> · au costat {fmtEstimare(cost)} în total</span> : null}
          </div>
          <p style={{ fontSize: '.77rem', color: 'var(--text-muted)', margin: '0 0 8px' }}>
            Sunt deja bifate în bazinul testului pe grupă. Apasă „🔗 Creează linkul testului" mai jos.
          </p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {rezultat.variante.map((v, i) => (
              <button key={v.refId || i} type="button" onClick={() => setVizibila(vizibila === i ? null : i)}
                style={{
                  padding: '5px 10px', borderRadius: 999, cursor: 'pointer', fontSize: '.78rem', fontWeight: 700,
                  border: `1.5px solid ${vizibila === i ? 'var(--navy)' : 'var(--border)'}`,
                  background: vizibila === i ? 'var(--navy)' : '#fff', color: vizibila === i ? '#fff' : 'var(--navy)',
                }}>
                {vizibila === i ? '▾ ' : '▸ '}Varianta {i + 1}
              </button>
            ))}
          </div>
          {vizibila != null && rezultat.variante[vizibila] && (
            <PreviewVarianta v={rezultat.variante[vizibila]} nr={vizibila + 1} />
          )}
        </div>
      )}
    </div>
  );
}

// ─── Cum arată o variantă (enunțurile în ordinea ei + litera corectă) ───────
function PreviewVarianta({ v, nr }) {
  return (
    <div style={{ marginTop: 10, background: '#fff', border: '1px solid var(--border)', borderRadius: 8, padding: 12, maxHeight: 320, overflowY: 'auto' }}>
      <div style={{ fontSize: '.78rem', fontWeight: 700, color: 'var(--navy)', marginBottom: 8 }}>
        Varianta {nr} — ordinea problemelor și litera corectă sunt doar ale acestei variante
      </div>
      {(v.questions || []).map((q, i) => (
        <div key={i} style={{ borderBottom: '1px solid var(--border)', padding: '6px 0' }}>
          <div style={{ display: 'flex', gap: 8, fontSize: '.82rem' }}>
            <strong style={{ color: 'var(--navy)', flexShrink: 0 }}>{i + 1}.</strong>
            <div style={{ minWidth: 0, flex: 1 }}><MathText text={q.statement} /></div>
          </div>
          {Array.isArray(q.options) && q.options.length > 0 && (
            <div style={{ marginLeft: 22, marginTop: 3, display: 'grid', gap: 2 }}>
              {q.options.map((o, oi) => (
                <div key={oi} style={{ display: 'flex', gap: 6, fontSize: '.78rem', color: oi === Number(q.answer) ? '#1e7e34' : 'var(--text-light)', fontWeight: oi === Number(q.answer) ? 700 : 400 }}>
                  <span style={{ flexShrink: 0 }}>{LITERE[oi]}){oi === Number(q.answer) ? ' ✓' : ''}</span>
                  <div style={{ minWidth: 0 }}><MathText text={String(o)} /></div>
                </div>
              ))}
            </div>
          )}
          {!Array.isArray(q.options) && (
            <div style={{ marginLeft: 22, fontSize: '.78rem', color: '#1e7e34', fontWeight: 700 }}>Răspuns: {String(q.answer ?? '')}</div>
          )}
        </div>
      ))}
    </div>
  );
}
