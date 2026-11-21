// =====================================================================
// src/components/BaremeClasa.jsx — fila „📋 Bareme" de la fiecare clasă (15 nov. 2026)
//
// Cererea: „Adaugă, la fiecare clasă (a V-a…a XII-a), o secțiune nouă «📋 Bareme» (în
// navigarea clasei, lângă capitole): arată toate baremele existente pentru
// exercițiile/fișele clasei (…) adminul poate lega manual un barem de un exercițiu de
// clasă (…) o dată legat, baremul trebuie folosit automat de corectarea existentă."
//
//   · ELEVUL (și vizitatorul): baremele clasei, pe capitole (pictograma capitolului), cu
//     fișa căreia îi aparțin — ca referință; profesorul virtual le folosește la corectare.
//     Secțiunea se poate ascunde elevilor din Admin (bifa de mai jos → app_settings).
//   · ADMINUL: toate fișele PDF ale clasei, cu baremul lor și cine l-a legat (🔒 admin,
//     🤖 botul, ✅ automat după titlu, 📎 inclus în fișă, „de verificat" — orice alt
//     marcaj); 💡 propunerile după titlu (un clic sau toate odată — doar unde nu e nicio
//     legătură), ⚙ alege alt barem, 📤 încarcă baremul (PDF), ↺ automat.
// Serverul: api/bareme.js (legăturile stau în ai_pdf_text, ca la examene).
// =====================================================================
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiPost } from '../lib/api';
import { supabase } from '../lib/supabase';
import { safeFileName } from '../lib/contentMeta';
import { Pictograma } from '../lib/pictograme';

// ─── datele secțiunii (folosite și de ContentPage, pentru fila din bară) ─────
export function useBaremeClasa(category, { on = true, user = null } = {}) {
  const [st, setSt] = useState({ data: null, err: null, loading: false });
  const load = useCallback(async () => {
    setSt((s) => ({ ...s, loading: true, err: null }));
    try {
      const data = await apiPost('/api/bareme', { action: 'clasa', category });
      setSt({ data, err: null, loading: false });
    } catch (e) { setSt({ data: null, err: e.message || 'Nu am putut încărca baremele.', loading: false }); }
  }, [category]);
  useEffect(() => { if (on) load(); }, [on, load, user?.id]);
  const setData = useCallback((data) => setSt((s) => ({ ...s, data })), []);
  return { ...st, reload: load, setData };
}

// cine a legat baremul — eticheta din Admin
const CUM = {
  admin: { t: '🔒 legat de admin', c: 'bc-p-admin' },
  bot: { t: '🤖 legat de botul de examene', c: 'bc-p-bot' },
  'claude-skill': { t: '✨ generat automat (Claude), verificat după barem', c: 'bc-p-skill' },
  automat: { t: '✅ găsit automat după titlu', c: 'bc-p-auto' },
  inclus: { t: '📎 baremul e în aceeași fișă', c: 'bc-p-auto' },
};
const eticheta = (b) => (b && (CUM[b.cum] || { t: `🤖 legat automat (${b.cum}) — verifică-l`, c: 'bc-p-verif' }));

// ─── elevul: un barem, cu fișa lui ───────────────────────────────────────────
function IntrareElev({ x, rows, user, isPremium, Card }) {
  const b = x.barem;
  const row = b.cum === 'inclus' ? rows.get(x.fisa.id) : rows.get(b.id);
  return (
    <div className="bc-intrare">
      {x.fisa && (
        <div className="bc-pentru">
          {b.cum === 'inclus'
            ? <>📎 Baremul e chiar în fișă (la sfârșitul ei)</>
            : <>pentru fișa <Link to={`/pdf-viewer?id=${encodeURIComponent(x.fisa.id)}`} state={{ returnTo: window.location.pathname, returnTab: 'bareme' }}>„{x.fisa.title}"</Link></>}
        </div>
      )}
      {row && Card
        ? <Card item={row} isPremium={isPremium} user={user} progress={null} forceTab="bareme" />
        : (
          <div className="bc-min">
            <span>📋 {b.title}</span>
            <Link className="btn btn-sm btn-outline" to={`/pdf-viewer?id=${encodeURIComponent(b.id)}`}>Deschide</Link>
          </div>
        )}
    </div>
  );
}

function VedereElev({ data, rows, user, isPremium, Card }) {
  const caps = (data.capitole || []).map((c) => ({ ...c, intrari: c.intrari.filter((x) => x.barem) })).filter((c) => c.intrari.length);
  if (!caps.length) {
    return (
      <div className="empty-state">
        <div className="empty-state-icon">📋</div>
        <h3>Încă nu sunt bareme pentru clasa {data.clasa}</h3>
        <p>Baremele fișelor apar aici pe măsură ce le adăugăm. Profesorul virtual te corectează și până atunci.</p>
      </div>
    );
  }
  return (
    <>
      <p className="bc-intro">
        Baremele fișelor clasei {data.clasa}, pe capitole. Profesorul virtual le folosește când îți corectează
        rezolvarea (<b>✏️ Pe PDF</b>, <b>🎓 Cere corectarea</b>) — deschide-le după ce ai lucrat fișa.
      </p>
      {caps.map((c) => (
        <section key={c.id} className="bc-cap">
          <h3><span className="bc-ic"><Pictograma nume={c.icon} size={22} /></span>{c.titlu}<small>{c.intrari.length}</small></h3>
          {c.intrari.map((x, i) => <IntrareElev key={`${x.barem.id}-${x.fisa ? x.fisa.id : i}`} x={x} rows={rows} user={user} isPremium={isPremium} Card={Card} />)}
        </section>
      ))}
    </>
  );
}

// ─── adminul: o fișă, cu baremul ei și acțiunile ─────────────────────────────
function RandAdmin({ x, data, category, act, busy }) {
  const [alege, setAlege] = useState('');
  const f = x.fisa;
  const b = x.barem;
  const et = eticheta(b);
  const ocupat = busy === (f ? f.id : (b && b.id));

  async function incarca(ev) {
    const file = ev.target.files && ev.target.files[0];
    ev.target.value = '';
    if (!file) return;
    if (!/\.pdf$/i.test(file.name) && file.type !== 'application/pdf') { act.mesaj('Baremul se încarcă ca PDF (cu text, nu scanat — profesorul virtual îi citește textul).', true); return; }
    await act.run(f.id, async () => {
      const bucket = f.is_free ? 'content-files-free' : 'content-files';
      const path = `pdf/${category}/${Date.now()}_${safeFileName(file.name) || 'barem.pdf'}`;
      const { error } = await supabase.storage.from(bucket).upload(path, file, { contentType: 'application/pdf' });
      if (error) throw new Error(`Încărcarea a eșuat: ${error.message}`);
      const { data: u } = supabase.storage.from(bucket).getPublicUrl(path);
      return apiPost('/api/bareme', { action: 'incarca', contentId: f.id, fileUrl: u.publicUrl, title: `Barem — ${f.title}` });
    }, `📋 Baremul pentru „${f.title}" e încărcat și legat.`);
  }

  // un barem fără fișă: îl poți lega de o fișă a clasei fără barem
  if (!f) {
    const libere = [];
    for (const c of data.capitole || []) for (const y of c.intrari) if (y.fisa && !y.barem) libere.push(y.fisa);
    return (
      <div className="bc-rand bc-rand-orfan">
        <div className="bc-r1"><b>📋 {b.title}</b><span className="bc-pill bc-p-orfan">fără fișă</span></div>
        {libere.length > 0 && (
          <div className="bc-act">
            <select value={alege} onChange={(e) => setAlege(e.target.value)} aria-label="Fișa căreia îi aparține baremul">
              <option value="">— leagă de fișa… —</option>
              {libere.map((y) => <option key={y.id} value={y.id}>{y.title}</option>)}
            </select>
            <button type="button" className="btn btn-sm btn-primary" disabled={!alege || ocupat}
              onClick={() => act.run(b.id, () => apiPost('/api/bareme', { action: 'leaga', contentId: alege, baremId: b.id }), '🔒 Legat.')}>Leagă</button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className={`bc-rand${b ? '' : ' bc-rand-fara'}`}>
      <div className="bc-r1">
        <Link to={`/pdf-viewer?id=${encodeURIComponent(f.id)}`} state={{ returnTo: window.location.pathname, returnTab: 'bareme' }} className="bc-fisa">📄 {f.title}</Link>
        {!f.is_free && <span className="bc-pill bc-p-prem">Premium</span>}
      </div>
      <div className="bc-r2">
        {b ? (
          <>
            <span className={`bc-pill ${et.c}`}>{et.t}</span>
            {b.cum !== 'inclus' && <Link to={`/pdf-viewer?id=${encodeURIComponent(b.id)}`} state={{ returnTo: window.location.pathname, returnTab: 'bareme' }} className="bc-barem">📋 {b.title}</Link>}
          </>
        ) : x.propunere ? (
          <span className="bc-pill bc-p-prop">💡 propunere după titlu: „{x.propunere.title}"</span>
        ) : (
          <span className="bc-pill bc-p-fara">fără barem</span>
        )}
      </div>
      <div className="bc-act">
        {x.propunere && !b && (
          <button type="button" className="btn btn-sm btn-primary" disabled={ocupat}
            onClick={() => act.run(f.id, () => apiPost('/api/bareme', { action: 'leaga', contentId: f.id, baremId: x.propunere.id }), '🔒 Legat.')}>✓ Leagă propunerea</button>
        )}
        {(data.bareme || []).length > 0 && (
          <>
            <select value={alege} onChange={(e) => setAlege(e.target.value)} aria-label={`Baremul fișei ${f.title}`}>
              <option value="">⚙ alege baremul…</option>
              {data.bareme.map((o) => <option key={o.id} value={o.id}>{o.title}{o.folosit ? ` (folosit de ${o.folosit})` : ''}</option>)}
            </select>
            <button type="button" className="btn btn-sm btn-outline" disabled={!alege || ocupat}
              onClick={() => act.run(f.id, () => apiPost('/api/bareme', { action: 'leaga', contentId: f.id, baremId: alege }), '🔒 Legat.')}>Leagă</button>
          </>
        )}
        <label className={`btn btn-sm btn-outline bc-up${ocupat ? ' dis' : ''}`} title="PDF cu text (nu scanat): profesorul virtual îi citește textul la corectare">
          📤 {b ? 'Alt barem (PDF)' : 'Încarcă baremul (PDF)'}
          <input type="file" accept="application/pdf,.pdf" onChange={incarca} disabled={ocupat} hidden />
        </label>
        {x.manual && (
          <button type="button" className="btn btn-sm btn-outline" disabled={ocupat} title="Șterge legătura manuală; corectarea caută din nou automat (după titlu)"
            onClick={() => act.run(f.id, () => apiPost('/api/bareme', { action: 'dezleaga', contentId: f.id }), '↺ Înapoi la potrivirea automată.')}>↺ Automat</button>
        )}
        {ocupat && <span className="bc-lucru">se salvează…</span>}
      </div>
    </div>
  );
}

const FILTRE = [
  { id: 'toate', t: 'Toate' },
  { id: 'fara', t: 'Fără barem' },
  { id: 'cu', t: 'Cu barem' },
  { id: 'prop', t: '💡 Propuneri' },
];

function VedereAdmin({ data, setData, category }) {
  const [filtru, setFiltru] = useState('toate');
  const [busy, setBusy] = useState(null);
  const [msg, setMsg] = useState(null);
  const act = useMemo(() => ({
    mesaj: (text, err = false) => setMsg({ text, err }),
    run: async (cheie, fn, ok) => {
      setBusy(cheie); setMsg(null);
      try { const d = await fn(); if (d && d.capitole) setData(d); if (ok) setMsg({ text: typeof ok === 'function' ? ok(d) : ok, err: false }); }
      catch (e) { setMsg({ text: e.message || 'Eroare.', err: true }); }
      finally { setBusy(null); }
    },
  }), [setData]);
  const s = data.stats || { fise: 0, cuBarem: 0, bareme: 0, propuneri: 0 };
  const potrivit = (x) => (filtru === 'toate') || (filtru === 'fara' && x.fisa && !x.barem) || (filtru === 'cu' && x.fisa && x.barem) || (filtru === 'prop' && x.propunere);
  const caps = (data.capitole || []).map((c) => ({ ...c, intrari: c.intrari.filter(potrivit) })).filter((c) => c.intrari.length);
  return (
    <div className="bc-admin">
      <div className="bc-adm-cap">
        <div>
          <b>⚙ Bareme · clasa {data.clasa}</b>
          <span>{s.fise} {s.fise === 1 ? 'fișă PDF' : 'fișe PDF'} · <b>{s.cuBarem}</b> cu barem · {s.bareme} {s.bareme === 1 ? 'barem încărcat' : 'bareme încărcate'}</span>
        </div>
        <label className="bc-viz" title="Elevii văd fila „📋 Bareme” (doar baremele, ca referință). Debifat: baremele se folosesc doar la corectare.">
          <input type="checkbox" checked={!!data.vizibil} disabled={busy === 'viz'}
            onChange={(e) => act.run('viz', () => apiPost('/api/bareme', { action: 'vizibil', vizibil: e.target.checked, category }), e.target.checked ? 'Secțiunea e vizibilă elevilor.' : 'Secțiunea e ascunsă elevilor (baremele se folosesc doar la corectare).')} />
          Vizibilă elevilor (toate clasele)
        </label>
      </div>
      <p className="bc-adm-hint">
        Baremul legat aici e cel folosit de corectare — Profesorul Virtual, „✏️ Pe PDF", „🎓 Cere corectarea" (ai_pdf_text, ca la examene).
        Legăturile puse de tine (🔒) nu le schimbă nimic automat.
      </p>
      <div className="bc-filtre">
        {FILTRE.map((f) => (
          <button key={f.id} type="button" className={`bc-chip${filtru === f.id ? ' on' : ''}`} onClick={() => setFiltru(f.id)}>
            {f.t}{f.id === 'fara' ? ` (${s.fise - s.cuBarem})` : f.id === 'cu' ? ` (${s.cuBarem})` : f.id === 'prop' ? ` (${s.propuneri})` : ''}
          </button>
        ))}
        {s.propuneri > 0 && (
          <button type="button" className="btn btn-sm btn-primary" disabled={!!busy}
            onClick={() => act.run('toate', () => apiPost('/api/bareme', { action: 'leaga_propuneri', category }), (d) => `🔒 ${d && d.legate ? d.legate : 0} ${d && d.legate === 1 ? 'fișă legată' : 'fișe legate'} de baremul propus.`)}>
            ✓ Leagă toate propunerile ({s.propuneri})
          </button>
        )}
      </div>
      {msg && <div className={`bc-msg${msg.err ? ' err' : ''}`}>{msg.text}</div>}
      {!caps.length && <div className="bc-gol">Nimic de arătat la filtrul ales.</div>}
      {caps.map((c) => (
        <section key={c.id} className="bc-cap">
          <h3><span className="bc-ic"><Pictograma nume={c.icon} size={22} /></span>{c.titlu}<small>{c.intrari.length}</small></h3>
          {c.intrari.map((x, i) => <RandAdmin key={x.fisa ? x.fisa.id : `b-${x.barem.id}-${i}`} x={x} data={data} category={category} act={act} busy={busy} />)}
        </section>
      ))}
    </div>
  );
}

// `Card` = ContentCard din ContentPage (primit ca prop: fără import circular)
export default function BaremeClasa({ category, stare, items = [], user = null, isPremium = false, Card = null }) {
  const { data, err, loading, reload, setData } = stare;
  const [caElev, setCaElev] = useState(false);
  const rows = useMemo(() => new Map((items || []).map((r) => [r.id, r])), [items]);
  if (loading && !data) return <div style={{ display: 'flex', justifyContent: 'center', padding: '60px 0' }}><div className="spinner" /></div>;
  if (err && !data) {
    return (
      <div className="empty-state">
        <div className="empty-state-icon">📋</div>
        <h3>Baremele nu s-au putut încărca</h3>
        <p>{err} <button type="button" className="btn btn-sm btn-outline" onClick={reload}>Reîncearcă</button></p>
      </div>
    );
  }
  if (!data) return null;
  return (
    <div className="bc">
      <style>{CSS}</style>
      {data.admin && (
        <div className="bc-mod">
          <button type="button" className={`bc-chip${!caElev ? ' on' : ''}`} onClick={() => setCaElev(false)}>⚙ Administrare</button>
          <button type="button" className={`bc-chip${caElev ? ' on' : ''}`} onClick={() => setCaElev(true)}>👁 Cum o văd elevii{data.vizibil ? '' : ' (ascunsă acum)'}</button>
        </div>
      )}
      {data.admin && !caElev
        ? <VedereAdmin data={data} setData={setData} category={category} />
        : <VedereElev data={data} rows={rows} user={user} isPremium={isPremium} Card={Card} />}
    </div>
  );
}

const CSS = `
.bc{margin-top:8px}
.bc-intro{font-size:.86rem;color:var(--text-light);line-height:1.55;margin:4px 2px 14px}
.bc-cap{margin:0 0 18px}
.bc-cap h3{display:flex;align-items:center;gap:8px;font-family:var(--font-display);color:var(--navy);font-size:1.05rem;margin:0 0 8px}
.bc-cap h3 small{font-family:var(--font-body);font-size:.72rem;font-weight:800;color:var(--navy-dark);background:var(--gold);border-radius:99px;padding:1px 8px}
.bc-ic{display:inline-flex;width:30px;height:30px;border-radius:50%;align-items:center;justify-content:center;background:#fdfbf4;border:1.5px solid var(--cream-dark);color:var(--navy);flex-shrink:0}
.bc-intrare{margin-bottom:4px}
.bc-pentru{font-size:.76rem;color:var(--text-muted);margin:0 4px 4px;font-weight:600}
.bc-pentru a{color:var(--navy)}
.bc-min{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:12px 14px;background:#fff;border:1.5px solid #eef0f4;border-radius:10px;margin-bottom:8px;font-weight:600;color:var(--navy)}
.bc-mod{display:flex;gap:6px;flex-wrap:wrap;margin:0 0 12px}
.bc-chip{border:1.5px solid var(--border);background:#fff;color:var(--navy);border-radius:99px;padding:4px 12px;font-size:.78rem;font-weight:700;cursor:pointer;font-family:var(--font-body)}
.bc-chip.on{background:var(--navy);border-color:var(--navy);color:#fff}
.bc-admin{display:block}
.bc-adm-cap{display:flex;justify-content:space-between;align-items:flex-start;gap:10px 16px;flex-wrap:wrap;background:#f7f9fc;border:1px solid var(--border);border-radius:12px;padding:10px 14px}
.bc-adm-cap > div{display:grid;gap:2px}
.bc-adm-cap > div b{color:var(--navy)}
.bc-adm-cap > div span{font-size:.8rem;color:var(--text-light)}
.bc-viz{display:inline-flex;align-items:center;gap:6px;font-size:.8rem;font-weight:700;color:var(--navy);cursor:pointer}
.bc-adm-hint{font-size:.76rem;color:var(--text-muted);margin:8px 2px 10px;line-height:1.5}
.bc-filtre{display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin-bottom:12px}
.bc-msg{font-size:.82rem;font-weight:600;color:#1e7e34;background:#f0f9f1;border:1px solid #cfe8d4;border-radius:8px;padding:6px 10px;margin-bottom:10px}
.bc-msg.err{color:#b71c1c;background:#fdecea;border-color:#f5c6cb}
.bc-gol{font-size:.84rem;color:var(--text-muted);padding:12px 4px}
.bc-rand{display:grid;grid-template-columns:minmax(0,1fr);gap:6px;padding:10px 12px;background:#fff;border:1.5px solid #eef0f4;border-radius:10px;margin-bottom:8px}
.bc-rand > *{min-width:0}
.bc-rand-fara{border-style:dashed}
.bc-rand-orfan{background:#fffdf5}
.bc-r1{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.bc-r1 b{color:var(--navy);font-size:.9rem}
.bc-fisa{font-weight:700;color:var(--navy);font-size:.9rem;text-decoration:none}
.bc-fisa:hover{text-decoration:underline}
.bc-r2{display:flex;align-items:center;gap:6px 10px;flex-wrap:wrap}
.bc-barem{font-size:.8rem;font-weight:600;color:var(--navy)}
.bc-pill{display:inline-block;font-size:.72rem;font-weight:700;border-radius:99px;padding:2px 9px;white-space:normal}
.bc-p-admin{background:#e8eaf6;color:#283593}
.bc-p-bot{background:#e3f2fd;color:#0d47a1}
.bc-p-skill{background:#f3e5f5;color:#6a1b9a}
.bc-p-auto{background:#e8f5e9;color:#1b5e20}
.bc-p-verif{background:#fff3e0;color:#e65100}
.bc-p-prop{background:#fffbea;color:#8a6d1a}
.bc-p-fara{background:#f4f5f7;color:var(--text-muted)}
.bc-p-orfan{background:#fffbea;color:#8a6d1a}
.bc-p-prem{background:#fff3e0;color:#e65100}
.bc-act{display:flex;flex-wrap:wrap;gap:6px;align-items:center}
.bc-act select{max-width:100%;min-width:0;width:auto;flex:1 1 180px;border:1px solid var(--border);border-radius:7px;padding:5px 7px;font-size:.78rem;background:#fff;text-overflow:ellipsis}
.bc-up{cursor:pointer}
.bc-up.dis{opacity:.5;pointer-events:none}
.bc-lucru{font-size:.74rem;color:var(--text-muted)}
@media (min-width:900px){.bc-act select{flex:0 1 380px}}
@media (max-width:600px){.bc-act select{flex-basis:100%;width:100%}}
`;
