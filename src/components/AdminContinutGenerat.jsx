// =====================================================================
// src/components/AdminContinutGenerat.jsx — Admin → „🤖 Conținut generat" (21 nov. 2026)
//
// Ce a produs skill-ul „examenmate-continut" (task-urile programate): bareme pentru PDF-urile
// fără barem, teste interactive pentru PDF-uri, fișe după fișierele model, variante EN,
// explicații la grila EN și testele interactive verificate/corectate.
//   · ce a trecut verificarea după barem e DEJA pe site → „↩ Anulează" îl retrage;
//   · ciornele (ce n-a trecut toate verificările) → „✅ Aprobă și publică" / „✕ Respinge";
//   · problemele (eșuate, conflicte) și testele verificate fără schimbări — de citit.
// Serverul: api/continut-generat.js → api/_lib/continutGenerat.js (supabase/continut_generat.sql).
// =====================================================================
import { useCallback, useEffect, useState } from 'react';
import { apiPost } from '../lib/api';

const GRUPURI = [
  { id: 'ciorne', label: '📝 Ciorne' },
  { id: 'publicate', label: '✅ Publicate' },
  { id: 'probleme', label: '⚠️ Probleme' },
  { id: 'verificate', label: '🔍 Verificate' },
  { id: 'inchise', label: '🗄 Respinse / anulate' },
  { id: 'toate', label: 'Toate' },
];
const STARE = {
  in_lucru: { t: 'în lucru', c: 'acg-st-info' },
  publicat: { t: '✅ publicat direct', c: 'acg-st-ok' },
  aprobat: { t: '✅ aprobat de tine', c: 'acg-st-ok' },
  ciorna: { t: '📝 ciornă', c: 'acg-st-ciorna' },
  respins: { t: 'respins', c: 'acg-st-gri' },
  anulat: { t: 'anulat', c: 'acg-st-gri' },
  esuat: { t: '⚠️ eșuat', c: 'acg-st-rau' },
  conflict: { t: '⚠️ conflict', c: 'acg-st-rau' },
  verificat: { t: '🔍 verificat — fără schimbări', c: 'acg-st-info' },
  nimic: { t: 'nimic de făcut', c: 'acg-st-gri' },
};
const ROL = {
  material: '📄 Materialul', material_alb: '⬜ Fără dreptunghiul negru', barem: '📋 Baremul', interactiv: '🧩 Testul interactiv',
  explicatii: '💡 Explicațiile', inlocuire: '🧩 Testul corectat', test: '🧩 Testul', vechi: '🧩 Testul vechi',
  lectie: '🎥 Lecția live (scriptul)', subiect: '📄 Subiectul',
};
const cand = (iso) => { try { return new Date(iso).toLocaleString('ro-RO', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }); } catch { return ''; } };
const linkSursa = (s) => (s ? (s.content_type === 'interactive' ? `/exercitiu?id=${s.id}` : `/pdf-viewer?id=${s.id}`) : null);

// verificările din manifest, ca listă scurtă (✓ / ✗ la valorile da/nu)
function Verificari({ v }) {
  if (!v || typeof v !== 'object') return null;
  const intrari = Object.entries(v);
  if (!intrari.length) return null;
  const val = (x) => (x === true ? '✓' : x === false ? '✗' : typeof x === 'object' && x !== null ? JSON.stringify(x) : String(x));
  return (
    <details className="acg-ver">
      <summary>Verificările ({intrari.length})</summary>
      <ul>{intrari.map(([k, x]) => <li key={k}><b>{k}</b>: <span className={x === false ? 'acg-rau' : ''}>{val(x)}</span></li>)}</ul>
    </details>
  );
}

export default function AdminContinutGenerat({ s }) {
  const [grup, setGrup] = useState('ciorne');
  const [procedura, setProcedura] = useState('');
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState(null);
  const [lucru, setLucru] = useState(null);          // id-ul unității la care se lucrează
  const [linkuri, setLinkuri] = useState({});        // id → { fisiere, vechi, site }

  const load = useCallback(async () => {
    setErr('');
    try {
      const r = await apiPost('/api/continut-generat', { action: 'lista', grup, procedura: procedura || null });
      setData(r);
    } catch (e) { setErr(e.message); setData(null); }
  }, [grup, procedura]);
  useEffect(() => { load(); }, [load]);

  async function veziFisiere(u) {
    if (linkuri[u.id]) { setLinkuri((l) => { const n = { ...l }; delete n[u.id]; return n; }); return; }
    setLucru(u.id);
    try {
      const r = await apiPost('/api/continut-generat', { action: 'linkuri', id: u.id });
      setLinkuri((l) => ({ ...l, [u.id]: r }));
    } catch (e) { setMsg({ type: 'error', text: e.message }); }
    finally { setLucru(null); }
  }

  async function actiune(u, action) {
    let motiv;
    if (action === 'aproba' && !window.confirm(`Publici pe site „${u.titlu}"?`)) return;
    if (action === 'anuleaza' && !window.confirm(`Retragi de pe site „${u.titlu}"?\n\nSe șterg rândurile create (materialul, baremul, testul, legăturile); la un test corectat revine fișierul vechi.`)) return;
    if (action === 'respinge') {
      motiv = window.prompt(`Respingi ciorna „${u.titlu}"? (fișierele ei se șterg)\n\nMotivul (opțional):`, '');
      if (motiv === null) return;
    }
    setLucru(u.id);
    setMsg(null);
    try {
      await apiPost('/api/continut-generat', { action, id: u.id, ...(motiv ? { motiv } : {}) });
      const text = { aproba: `✅ „${u.titlu}" e publicat pe site.`, respinge: `„${u.titlu}" a fost respins.`, anuleaza: `↩ „${u.titlu}" a fost retras de pe site.` }[action];
      setMsg({ type: 'success', text });
      setLinkuri((l) => { const n = { ...l }; delete n[u.id]; return n; });
      load();
    } catch (e) { setMsg({ type: 'error', text: e.message }); }
    finally { setLucru(null); }
  }

  const proceduri = (data && data.proceduri) || {};
  const numarare = (data && data.numarare) || {};
  const unitati = (data && data.unitati) || [];

  return (
    <div style={s.card}>
      <div style={s.cardTitle}>🤖 Conținut generat — skill-ul de conținut</div>
      <p className="acg-intro">
        Ce produc task-urile programate. Ce a trecut <b>verificarea după barem</b> e deja pe site (îl poți retrage cu „↩ Anulează");
        restul intră aici ca <b>ciornă</b> și apare pe site doar după „✅ Aprobă și publică".
      </p>

      <div className="acg-bara">
        <div className="acg-seg" role="tablist" aria-label="Ce arăt">
          {GRUPURI.map((g) => (
            <button key={g.id} type="button" role="tab" aria-selected={grup === g.id} className={grup === g.id ? 'activ' : ''} onClick={() => setGrup(g.id)}>
              {g.label}{numarare[g.id] ? <span className="acg-nr">{numarare[g.id]}</span> : null}
            </button>
          ))}
        </div>
        <select style={{ ...s.select, width: 'auto', minWidth: 220 }} value={procedura} onChange={(e) => setProcedura(e.target.value)} aria-label="Procedura">
          <option value="">Toate procedurile</option>
          {Object.entries(proceduri).map(([k, p]) => <option key={k} value={k}>{k} · {p.titlu}</option>)}
        </select>
        <button type="button" style={s.btnSecondary} onClick={load}>↻ Reîncarcă</button>
      </div>

      {msg && <div style={s.alert(msg.type)}>{msg.text}</div>}
      {err && <div style={s.alert('error')}>{err}</div>}
      {data && data.setup === false && <div style={s.alert('error')}>{data.hint}</div>}
      {!data && !err && <p className="acg-gol">Se încarcă…</p>}
      {data && data.setup !== false && !unitati.length && (
        <p className="acg-gol">{grup === 'ciorne' ? 'Nicio ciornă de aprobat.' : 'Nimic aici deocamdată.'}</p>
      )}

      <div className="acg-lista">
        {unitati.map((u) => {
          const st = STARE[u.status] || { t: u.status, c: 'acg-st-gri' };
          const p = proceduri[u.procedura] || {};
          const l = linkuri[u.id];
          const areFisiere = u.fisiere && Object.keys(u.fisiere).length > 0;
          return (
            <div key={u.id} className="acg-unit">
              <div className="acg-cap">
                <span className="acg-proc" title={p.titlu}>{u.procedura} · {p.scurt || 'procedura'}</span>
                <span className={`acg-st ${st.c}`}>{st.t}</span>
                <span className="acg-cand">{cand(u.creat_la)}</span>
              </div>
              <div className="acg-titlu">{u.titlu}</div>
              {u.sursa && (
                <div className="acg-sursa">pornind de la: <a href={linkSursa(u.sursa)} target="_blank" rel="noreferrer">{u.sursa.title}</a></div>
              )}
              {u.motiv && <div className="acg-motiv">{u.status === 'ciorna' ? 'De ce e ciornă: ' : ''}{u.motiv}</div>}
              {u.eroare && <div className="acg-eroare">Eroare: {u.eroare}</div>}
              <Verificari v={u.verificari} />

              <div className="acg-butoane">
                {(areFisiere || ['publicat', 'aprobat'].includes(u.status)) && (
                  <button type="button" style={s.btnSecondary} disabled={lucru === u.id} onClick={() => veziFisiere(u)}>
                    {l ? '▲ Ascunde fișierele' : '👁 Fișierele'}
                  </button>
                )}
                {u.status === 'ciorna' && (
                  <>
                    <button type="button" style={s.btnPrimary} disabled={lucru === u.id} onClick={() => actiune(u, 'aproba')}>✅ Aprobă și publică</button>
                    <button type="button" style={s.btnDanger} disabled={lucru === u.id} onClick={() => actiune(u, 'respinge')}>✕ Respinge</button>
                  </>
                )}
                {['publicat', 'aprobat'].includes(u.status) && (
                  <button type="button" style={s.btnDanger} disabled={lucru === u.id} onClick={() => actiune(u, 'anuleaza')}>↩ Anulează</button>
                )}
                {lucru === u.id && <span className="acg-gol">Se lucrează…</span>}
              </div>

              {l && (
                <div className="acg-linkuri">
                  {Object.entries(l.fisiere || {}).map(([rol, url]) => (
                    url ? <a key={rol} href={url} target="_blank" rel="noreferrer">{ROL[rol] || rol}</a> : <span key={rol} className="acg-gol">{ROL[rol] || rol}: lipsă</span>
                  ))}
                  {l.vechi && <a href={l.vechi} target="_blank" rel="noreferrer">{ROL.vechi}</a>}
                  {(l.site || []).map((x) => <a key={`${x.rol}-${x.url}`} href={x.url} target="_blank" rel="noreferrer">🌐 pe site: {ROL[x.rol] || x.rol}</a>)}
                  {!Object.keys(l.fisiere || {}).length && !(l.site || []).length && <span className="acg-gol">Nicio legătură.</span>}
                </div>
              )}
            </div>
          );
        })}
      </div>
      <style>{CSS}</style>
    </div>
  );
}

const CSS = `
.acg-intro{font-size:.88rem;color:#5a6170;margin:0 0 14px;line-height:1.5}
.acg-bara{display:flex;flex-wrap:wrap;gap:10px;align-items:center;margin-bottom:14px}
.acg-seg{display:flex;flex-wrap:wrap;gap:6px}
.acg-seg button{border:1.5px solid #dde1e8;background:#fff;color:var(--navy);border-radius:20px;padding:6px 12px;font-size:.82rem;font-weight:600;cursor:pointer}
.acg-seg button.activ{background:var(--navy);color:#fff;border-color:var(--navy)}
.acg-nr{display:inline-block;margin-left:6px;background:var(--gold);color:var(--navy-dark);border-radius:10px;padding:0 7px;font-size:.72rem;font-weight:800}
.acg-lista{display:flex;flex-direction:column;gap:12px}
.acg-unit{border:1px solid #e6e9ef;border-radius:12px;padding:12px 14px;background:#fff}
.acg-cap{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-bottom:6px}
.acg-proc{font-size:.74rem;font-weight:800;color:#5a6170;background:#f0f4f8;border-radius:20px;padding:2px 10px}
.acg-st{font-size:.74rem;font-weight:800;border-radius:20px;padding:2px 10px}
.acg-st-ok{background:#e8f5e9;color:#2e7d32}.acg-st-ciorna{background:#fff3e0;color:#e65100}
.acg-st-rau{background:#fce4ec;color:#c62828}.acg-st-info{background:#e3f2fd;color:#0d47a1}.acg-st-gri{background:#eceff1;color:#546e7a}
.acg-cand{font-size:.76rem;color:#8e95a3;margin-left:auto}
.acg-titlu{font-weight:700;color:var(--navy);font-size:.95rem}
.acg-sursa{font-size:.82rem;color:#5a6170;margin-top:3px}
.acg-motiv{font-size:.84rem;margin-top:6px;background:#fffaf0;border-radius:8px;padding:6px 10px;color:#6b5400}
.acg-eroare{font-size:.84rem;margin-top:6px;background:#fce4ec;border-radius:8px;padding:6px 10px;color:#c62828}
.acg-ver{margin-top:6px;font-size:.82rem}.acg-ver summary{cursor:pointer;color:#5a6170}
.acg-ver ul{margin:6px 0 0;padding-left:18px}.acg-ver li{word-break:break-word}
.acg-rau{color:#c62828;font-weight:700}
.acg-butoane{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-top:10px}
.acg-linkuri{display:flex;flex-wrap:wrap;gap:8px;margin-top:8px}
.acg-linkuri a{font-size:.82rem;background:#f7f9fc;border:1px solid #e6e9ef;border-radius:8px;padding:5px 10px;text-decoration:none;color:var(--navy)}
.acg-gol{font-size:.84rem;color:#8e95a3}
`;
