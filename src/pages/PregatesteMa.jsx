// =====================================================================
// src/pages/PregatesteMa.jsx — „🎯 PREGĂTEȘTE-MĂ DE EXAMEN" (8 nov. 2026)
// Ruta: /pregateste-ma
//
// Cererea (8 nov.): un buton care amintește zilnic, printr-o notificare, să rezolvi
// un test; progresul cu XP în Arena și clasament, simplu, cu promovare și alte
// răsplăți; contează și o parte dintr-un test.
//
// 13 nov. 2026 — „🗺️ HARTA PREGĂTIRII": „pune în «pregătește-mă de examen» un plan
// de pregătire cu exerciții în ordine (…) Planul să se poată vedea ca o hartă pe
// care s-au parcurs exerciții (…) Păstrează liga și XP, dar introdu harta de
// pregătire - planul de parcurs." Pagina:
//   · ținta: un examen (EN, BAC M1/M2/M3) SAU o clasă (a V-a … a XII-a);
//   · PASUL DE AZI = pasul curent din plan (testul zilei): ▶ Începe / Continuă /
//     ↻ Mai încearcă; după câteva încercări „⏭ Treci mai departe"; la testele PDF,
//     cele patru moduri de a trimite rezolvarea (pe PDF, în chat, pe foaia de
//     lucru, cu poza); seria de zile, săptămâna, ziua bifată de la 3 exerciții;
//   · HARTA (src/components/HartaPlan.jsx): toți pașii, pe etape, pe o pagină de
//     caiet; un clic pe un pas → fișa lui (jos), cu butoanele;
//   · după o pauză: „continui de unde ai rămas" (seria se ia de la capăt, planul nu);
//   · răsplățile (XP, 🪙, liga din Arenă, insignele), „🔔 Amintește-mi", ultimele zile.
// 13 nov. 2026 (după-amiaza) — „împarte harta în două: prima dată harta exercițiilor
// interactive și a doua harta exercițiilor PDF" + „păstrează doar subiecte de examen
// cu corectare după barem": 1 · 🧩 harta exercițiilor interactive, 2 · 📄 harta
// subiectelor PDF cu barem (la clasă: fișele PDF cu barem). Fiecare hartă are pasul
// ei; pasul de azi vine din harta 1, iar după ce o termini, din harta 2. Cu Premium,
// harta 2 se poate lucra și în paralel.
// Ziua se bifează pe server (api/_lib/pregatireZilnica.js); planul:
// api/_lib/planPregatire.js. API: /api/gamificare → 'pregatire', 'pregatire_alege'
// (examen sau clasă), 'plan_sari', 'pregatire_notificari' / 'pregatire_notificari_proba'.
// (Altceva decât „Pregătirea de examen" cu Prof. Tudor, /meditatii/pregatire —
// ședințele live pe barem; pagina trimite și acolo.)
// =====================================================================
import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { aiClient } from '../lib/aiClient';
import { arenaChanged, onArenaChange } from '../lib/arena';
import { AmintireZilnica } from '../components/MisiuneZilnica';
import HartaPlan, { urlPas } from '../components/HartaPlan';
import '@fontsource/caveat/700.css';   // nota „de mână", notițele de pe hartă

const card = {
  background: 'var(--white)', border: '1px solid var(--border)',
  borderRadius: 'var(--radius-lg)', padding: '18px 20px', boxShadow: 'var(--shadow-sm)',
};
const eticheta = { fontSize: '0.72rem', letterSpacing: '0.06em', textTransform: 'uppercase', fontWeight: 800 };
const fmtNota = (n) => Number(n).toFixed(2).replace('.', ',');
const ziua = (iso) => {
  try { return new Date(`${iso}T12:00:00`).toLocaleDateString('ro-RO', { weekday: 'short', day: 'numeric', month: 'short' }); }
  catch { return iso; }
};
const ori = (n) => (n === 1 ? 'o dată' : `de ${n} ori`);

const TEXTE_AMINTIRE = {
  actiune: 'pregatire_notificari', actiuneProba: 'pregatire_notificari_proba', pushLs: 'pz_push_ep',
  intrebare: 'Vrei să-ți amintesc de pasul zilei?',
  dacaNu: 'dacă n-ai lucrat încă azi',
  doarCand: 'doar în zilele în care n-ai lucrat încă',
  sql: 'supabase/pregatire_zilnica.sql', inactiv: 'Amintirile pregătirii nu sunt active',
};

// modurile de a trimite rezolvarea unui test PDF (src/pages/PDFViewer.jsx → ?mod=)
const MODURI_PDF = [
  { mod: 'pdf', icon: '✏️', label: 'Pe PDF', titlu: 'Scrii direct pe test, apoi „✅ Corectează"' },
  { mod: 'chat', icon: '💬', label: 'În chat', titlu: 'Scrii răspunsurile în formularul din chat' },
  { mod: 'foaie', icon: '✍️', label: 'Foaia de lucru', titlu: 'Scrii de mână pe foaia de lucru, lângă test' },
  { mod: 'poza', icon: '📷', label: 'Cu poza', titlu: 'Fotografiezi rezolvarea de pe caiet' },
];

// cerculețul unei zile din săptămână
function Zi({ z }) {
  const facut = z.stare === 'facut', azi = z.stare === 'azi', ratat = z.stare === 'ratat';
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, minWidth: 30 }}
      title={facut ? `${z.day}: ziua bifată` : azi ? 'Azi — pasul te așteaptă' : ratat ? `${z.day}: fără pregătire` : z.day}>
      <span style={{ fontSize: '.68rem', fontWeight: 700, color: azi ? 'var(--navy)' : 'var(--text-muted)' }}>{z.label}</span>
      <span aria-hidden style={{
        width: 32, height: 32, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: '.9rem', fontWeight: 800,
        background: facut ? 'linear-gradient(135deg, var(--gold), var(--gold-light))' : azi ? '#fff' : ratat ? 'var(--cream-dark)' : 'var(--cream)',
        color: facut ? 'var(--navy)' : 'var(--text-muted)',
        border: azi ? '2px solid var(--navy)' : '2px solid transparent',
        animation: azi ? 'pzPuls 2s ease-in-out infinite' : 'none',
      }}>{facut ? '✓' : ratat ? '·' : ''}</span>
    </div>
  );
}

// cele două hărți, în ordine (planPregatire.js → HARTI)
const HARTI = {
  interactiv: { nr: 1, icon: '🧩', scurt: 'Harta interactivă', nume: 'Exerciții interactive' },
  pdf: { nr: 2, icon: '📄', scurt: 'Harta PDF', nume: 'Subiecte PDF cu barem' },
};
const NR_HARTI = ['interactiv', 'pdf'];

// ce s-a întâmplat la un pas, într-o propoziție
function descriere(n, { esteCurent, reguli }) {
  const prag = n.tip === 'pdf' ? reguli?.pragPdf ?? 50 : reguli?.pragInteractiv ?? 70;
  if (!n.accesibil && n.stare !== 'trecut') {
    return n.tip === 'pdf'
      ? '⭐ Subiectele PDF le corectează profesorul virtual după barem — fac parte din abonamentul Premium.'
      : '⭐ Exercițiu din abonamentul Premium.';
  }
  if (n.stare === 'trecut') return `✓ Trecut${n.pct != null ? ` cu ${n.pct}%` : ''}${n.incercari > 1 ? ` (din ${n.incercari} încercări)` : ''}. Îl poți relua oricând.`;
  if (n.stare === 'sarit') return `⏭ Ai trecut mai departe după ${n.incercari} încercări (ultima: ${n.pct ?? 0}%). Îl poți relua oricând.`;
  if (n.stare === 'incercat') return `Ai încercat ${ori(n.incercari)} · ultima dată ${n.pct ?? 0}% — pasul e trecut de la ${prag}%.`;
  if (n.stare === 'inceput') return 'L-ai început și nu l-ai terminat — continuă de unde ai rămas.';
  if (!n.deschis) return '🔒 Se deschide după pasul tău de acum.';
  return esteCurent ? 'Pasul tău de acum.' : 'Neînceput.';
}

// butoanele unui pas: deschiderea (la PDF, modul de rezolvare) și „⏭ Treci mai departe"
function ActiuniPas({ n, esteCurent, plan, busy, onDeschide, onSari, onLaPasulMeu, mare = false }) {
  if (!n.accesibil && n.stare !== 'trecut') {
    return (
      <div className="pz-act">
        <Link to="/preturi" className={`btn btn-primary${mare ? ' btn-lg' : ''}`}>⭐ Vezi abonamentele</Link>
      </div>
    );
  }
  if (!n.deschis) {
    return (
      <div className="pz-act">
        <button type="button" className="btn btn-outline" onClick={onLaPasulMeu}>↩ Du-mă la pasul meu</button>
      </div>
    );
  }
  const reguli = plan?.reguli || {};
  const ramase = Math.max(0, (reguli.incercariSarire ?? 3) - (n.incercari || 0));
  const label = n.stare === 'trecut' || n.stare === 'sarit' ? '↻ Reia'
    : n.stare === 'incercat' ? '↻ Mai încearcă'
      : n.stare === 'inceput' ? '▶ Continuă' : (esteCurent ? '▶ Începe' : '▶ Deschide');
  return (
    <>
      {n.tip === 'pdf' ? (
        <>
          <div style={{ fontSize: '.8rem', color: 'var(--text-light)', margin: '2px 0 8px' }}>Cum trimiți rezolvarea?</div>
          <div className="pz-moduri" role="group" aria-label="Cum trimiți rezolvarea testului">
            {MODURI_PDF.map((m, k) => (
              <button key={m.mod} type="button" className={`pz-mod${k === 0 ? ' prim' : ''}`} title={m.titlu}
                onClick={() => onDeschide(urlPas(n, m.mod), n)}>
                <span aria-hidden="true">{m.icon}</span> {m.label}
              </button>
            ))}
          </div>
        </>
      ) : (
        <div className="pz-act">
          <button type="button" className={`btn btn-primary${mare ? ' btn-lg' : ''}`} onClick={() => onDeschide(urlPas(n), n)}>{label}</button>
        </div>
      )}
      {esteCurent && n.stare === 'incercat' && (
        n.poateSari ? (
          <div className="pz-sari">
            <span>Ai încercat {ori(n.incercari)}. Poți rămâne aici până îl treci sau poți merge mai departe — îl găsești oricând pe hartă.</span>
            <button type="button" className="btn btn-sm btn-outline" disabled={busy} onClick={() => onSari(n)}>⏭ Treci mai departe</button>
          </div>
        ) : (
          <div className="pz-sari mic">
            Mai {ramase === 1 ? 'ai o încercare' : `ai ${ramase} încercări`} până poți trece mai departe — sau îl treci acum.
          </div>
        )
      )}
    </>
  );
}

// alegerea țintei: un examen sau o clasă
function AlegereTinta({ p, busy, onAlege }) {
  const ales = p?.examen?.id;
  return (
    <div className="pz-alege">
      <div className="pz-grup">
        <div className="pz-grup-tit">Examen</div>
        <div className="pz-chips">
          {(p?.examene || []).map((e) => (
            <button key={e.id} type="button" disabled={busy}
              className={`pz-chip${ales === e.id ? ' on' : ''}`} onClick={() => onAlege(e.id)}>
              {e.id === 'evaluare-nationala' ? '📘' : '🎓'} {e.label}
              <small>{e.id === 'evaluare-nationala' ? 'clasa a VIII-a' : 'clasa a XII-a'}{p?.sugestie === e.id ? ' · ales în „Planul meu"' : ''}</small>
            </button>
          ))}
        </div>
      </div>
      <div className="pz-grup">
        <div className="pz-grup-tit">sau o clasă</div>
        <div className="pz-clase">
          {(p?.clase || []).map((c) => (
            <button key={c.id} type="button" disabled={busy} title={c.label}
              className={`pz-clasa${ales === c.id ? ' on' : ''}`} onClick={() => onAlege(c.id)}>
              {c.label.replace('Clasa a ', '').replace('-a', '')}
            </button>
          ))}
        </div>
        <div className="pz-nota-mica">La o clasă: întâi exercițiile interactive ale ei, apoi ale claselor dinainte; pe a doua hartă, fișele PDF cu barem.</div>
      </div>
    </div>
  );
}

// fișa pasului ales pe hartă (jos, peste pagină); `harta` = harta pasului (numerotarea e a ei)
function FisaPas({ n, harta, plan, busy, onInchide, onDeschide, onSari, onLaPasulMeu }) {
  const esteCurent = harta?.curent === n.i;
  const et = (harta?.etape || []).find((e) => e.id === n.etapa);
  const h = HARTI[n.harta] || HARTI.interactiv;
  return (
    <div className="pz-fisa" role="dialog" aria-label={`${h.scurt}, pasul ${n.i + 1}: ${n.titlu}`}>
      <button type="button" className="pz-fisa-x" onClick={onInchide} aria-label="Închide">✕</button>
      <div className="pz-fisa-et">{h.icon} {h.scurt} · {et ? et.titlu : ''} · pasul {n.i + 1} din {harta?.total}{n.nou ? ' · ' : ''}{n.nou && <span className="pz-nou">nou în site</span>}</div>
      <div className="pz-fisa-tit">{n.titlu}</div>
      <div className="pz-fisa-st">{descriere(n, { esteCurent, reguli: plan.reguli })}</div>
      <ActiuniPas n={n} esteCurent={esteCurent} plan={plan} busy={busy} onDeschide={onDeschide} onSari={onSari} onLaPasulMeu={onLaPasulMeu} />
    </div>
  );
}

// toată harta (în afară de ce e deja trecut) e cu Premium — la harta PDF, fără abonament
const hartaBlocata = (h) => !!h && h.ramasePremium > 0 && h.ramasePremium + h.trecute >= h.total;

// ce mai rămâne de făcut cu Premium, după ce elevul a terminat tot ce e gratuit
function ceRamaneCuPremium(plan) {
  const nPdf = plan?.pdf?.ramasePremium || 0, nInt = plan?.interactiv?.ramasePremium || 0;
  const pasi = (n) => (n === 1 ? 'un pas' : `${n} pași`);
  if (nPdf && nInt) return `Mai ai ${pasi(nPdf + nInt)} cu Premium: subiectele PDF corectate după barem și exercițiile interactive din abonament.`;
  if (nPdf) return `Harta subiectelor PDF (${pasi(nPdf)}), corectate după barem de profesorul virtual, se deschide cu Premium.`;
  return `Mai ai ${nInt === 1 ? 'un exercițiu interactiv' : `${nInt} exerciții interactive`} din abonamentul Premium.`;
}
// „… se deschide(u) cu" (urmează legătura „Premium"), sub progresul hărților
function seDeschideCu(plan) {
  const nInt = plan?.interactiv?.ramasePremium || 0;
  const ex = (n) => (n === 1 ? 'un exercițiu interactiv' : `${n} exerciții interactive`);
  if (hartaBlocata(plan?.pdf)) {
    return nInt ? `Harta subiectelor PDF și ${ex(nInt)} se deschid cu` : 'Harta subiectelor PDF, corectate după barem de profesorul virtual, se deschide cu';
  }
  const n = nInt + (plan?.pdf?.ramasePremium || 0);
  return n === 1 ? 'Un pas din abonament se deschide cu' : `${n} pași din abonament se deschid cu`;
}

// progresul unei hărți, pe un rând (sub pasul de azi)
function ProgresHarta({ id, h, laClasa = false }) {
  const m = HARTI[id];
  if (!h || !h.total) return null;
  const blocata = hartaBlocata(h);
  return (
    <div className="pz-prog">
      <div className="pz-prog-r">
        <span className="pz-prog-n"><b>{m.nr}</b> {m.icon} {id === 'pdf' && laClasa ? 'Fișe PDF cu barem' : m.nume}</span>
        <span>{blocata ? '⭐ cu Premium' : `${h.trecute} din ${h.total}${h.sarite ? ` · ${h.sarite} ${h.sarite === 1 ? 'sărit' : 'săriți'}` : ''} · ${h.procent}%`}</span>
      </div>
      <div className="pz-bara" aria-hidden="true"><span style={{ width: `${blocata ? 0 : h.procent}%` }} /></div>
    </div>
  );
}

export default function PregatesteMa() {
  const { user, isAdmin, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const [p, setP] = useState(null);
  const [notif, setNotif] = useState(null);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const [schimba, setSchimba] = useState(false);
  const [ales, setAles] = useState(null);   // pasul ales pe o hartă: { harta, id }

  const load = useCallback(async () => {
    if (!user) return;
    try {
      const r = await aiClient.gamificare({ action: 'pregatire' });
      setP(r?.pregatire || null);
      if (r?.notificari) setNotif(r.notificari);
      setErr(null);
    } catch (e) { setErr(e?.message || 'Nu am putut încărca pregătirea.'); }
  }, [user]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => onArenaChange(() => load()), [load]);
  useEffect(() => {
    const reia = () => { if (document.visibilityState === 'visible') load(); };
    document.addEventListener('visibilitychange', reia);
    return () => document.removeEventListener('visibilitychange', reia);
  }, [load]);

  async function alege(examen) {
    setBusy(true); setErr(null);
    try {
      const r = await aiClient.gamificare({ action: 'pregatire_alege', examen });
      setP(r?.pregatire || null);
      setSchimba(false);
      setAles(null);
      arenaChanged();
    } catch (e) { setErr(e?.message || 'Nu am putut salva alegerea.'); }
    finally { setBusy(false); }
  }

  async function sari(n) {
    setBusy(true); setErr(null);
    try {
      const r = await aiClient.gamificare({ action: 'plan_sari', contentId: n.id });
      setP(r?.pregatire || null);
      setAles(null);
    } catch (e) { setErr(e?.message || 'Nu am putut trece mai departe.'); }
    finally { setBusy(false); }
  }

  // deschide un pas; „Înapoi" din vizualizator revine aici
  const deschide = (url, n) => { if (url) navigate(url, { state: { returnTo: '/pregateste-ma', scrollToCardId: n?.id || null } }); };

  const header = (
    <div className="page-header pz-header">
      <div className="container">
        <div className="breadcrumb"><Link to="/">Acasă</Link><span>›</span><span>Pregătește-mă de examen</span></div>
        <h1>🎯 Pregătește-mă de examen</h1>
        <p>Planul tău, pe două hărți: întâi exercițiile interactive, apoi subiectele PDF corectate după barem. Lucrezi zilnic, primești XP și urci în ligă.</p>
      </div>
    </div>
  );

  const stil = (
    <style>{`
@keyframes pzPuls{0%,100%{box-shadow:0 0 0 0 rgba(15,43,68,.35)}50%{box-shadow:0 0 0 6px rgba(15,43,68,0)}}
.pz-grid{display:grid;gap:18px}
/* calculator: pasul de azi și harta în stânga, răsplățile în dreapta; telefon: pasul, harta, apoi răsplățile */
.pz-main{display:grid;grid-template-columns:minmax(0,1.6fr) minmax(0,1fr);grid-template-areas:"pas side" "harta side";gap:18px;align-items:start}
.pz-a-pas{grid-area:pas}.pz-a-side{grid-area:side;display:grid;gap:18px}.pz-a-harta{grid-area:harta;min-width:0}
@media (max-width: 900px){.pz-main{grid-template-columns:minmax(0,1fr);grid-template-areas:"pas" "harta" "side"}}
.pz-alege{display:grid;gap:14px;margin-top:12px}
.pz-grup-tit{font-size:.74rem;font-weight:800;color:var(--text-muted);margin-bottom:6px}
.pz-chips{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:10px}
.pz-chip{padding:10px 14px;border-radius:12px;font-weight:800;font-size:.9rem;border:2px solid var(--border);background:#fff;color:var(--navy);cursor:pointer;text-align:left}
.pz-chip.on,.pz-clasa.on{border-color:var(--gold);background:rgba(232,185,49,.14)}
.pz-chip small{display:block;font-weight:600;color:var(--text-muted);font-size:.72rem;margin-top:2px}
.pz-clase{display:flex;flex-wrap:wrap;gap:8px}
.pz-clasa{min-width:52px;padding:9px 10px;border-radius:12px;border:2px solid var(--border);background:#fff;color:var(--navy);font-weight:800;font-family:var(--font-display);font-size:1rem;cursor:pointer}
.pz-nota-mica{font-size:.76rem;color:var(--text-muted);margin-top:6px}
.pz-act{display:flex;gap:10px;flex-wrap:wrap;align-items:center}
.pz-moduri{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px}
@media (max-width: 560px){.pz-moduri{grid-template-columns:repeat(2,minmax(0,1fr))}}
.pz-mod{display:flex;align-items:center;justify-content:center;gap:6px;padding:10px 8px;border-radius:12px;border:2px solid var(--navy);background:#fff;color:var(--navy);font-weight:800;font-size:.84rem;cursor:pointer;min-height:44px}
.pz-mod.prim{background:var(--navy);color:#fff}
.pz-mod:hover{box-shadow:var(--shadow)}
.pz-sari{display:flex;gap:10px;align-items:center;justify-content:space-between;flex-wrap:wrap;margin-top:12px;padding:10px 12px;border-radius:12px;background:rgba(198,40,40,.06);border:1px dashed rgba(198,40,40,.35);font-size:.84rem;color:#7a2020;line-height:1.45}
.pz-sari span{flex:1 1 240px}
.pz-sari.mic{background:transparent;border:none;padding:0;margin-top:10px;color:var(--text-light);font-size:.8rem}
.pz-bara{height:8px;border-radius:99px;background:var(--cream-dark);overflow:hidden;margin-top:6px}
.pz-bara span{display:block;height:100%;border-radius:99px;background:linear-gradient(90deg,var(--navy),var(--navy-light))}
.pz-ins{display:flex;align-items:center;gap:8px;border-radius:12px;padding:8px 10px;border:1.5px solid var(--border);background:var(--cream)}
.pz-ins.on{border-color:var(--gold);background:rgba(232,185,49,.10)}
.pz-ins.off{filter:grayscale(1);opacity:.55}
.pz-nou{background:#2e7d32;color:#fff;border-radius:99px;padding:1px 7px;font-size:.68rem;font-weight:800}
.pz-harta-cap{display:flex;align-items:baseline;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-bottom:10px}
.pz-harta-cap h2{font-family:var(--font-display);color:var(--navy);font-size:1.35rem;margin:0}
.pz-fisa{position:fixed;left:50%;transform:translateX(-50%);bottom:calc(var(--bara-jos-h, 0px) + 12px);width:min(560px,calc(100vw - 20px));z-index:1502;background:#fff;border:1px solid var(--border);border-top:4px solid var(--gold);border-radius:16px;box-shadow:var(--shadow-lg);padding:14px 16px 16px;max-height:70vh;overflow:auto}
.pz-fisa-x{position:absolute;top:8px;right:10px;border:none;background:none;font-size:1rem;cursor:pointer;color:var(--text-muted);width:32px;height:32px}
.pz-fisa-et{font-size:.74rem;font-weight:700;color:var(--text-muted);padding-right:30px}
.pz-fisa-tit{font-weight:800;color:var(--navy);font-size:1.05rem;margin:4px 30px 6px 0;line-height:1.3}
.pz-fisa-st{font-size:.86rem;color:var(--text-light);margin-bottom:12px;line-height:1.5}
.pz-pauza{display:flex;gap:12px;align-items:center;flex-wrap:wrap;justify-content:space-between}
/* cele două hărți: 1 · interactive, 2 · PDF cu barem — numărul scris de mână, ca etapele de pe margine */
.pz-progs{display:grid;gap:10px;margin-top:14px}
.pz-prog-r{display:flex;justify-content:space-between;align-items:baseline;gap:10px;font-size:.8rem;color:var(--text-light);font-weight:700}
.pz-prog-n{color:var(--navy)}
.pz-prog-n b{font-family:"Caveat",cursive;color:#c62828;font-size:1.15rem;margin-right:3px}
.pz-harta-n + .pz-harta-n{margin-top:28px;padding-top:20px;border-top:1px dashed var(--cream-dark)}
.pz-h3{display:flex;align-items:baseline;gap:8px;flex-wrap:wrap;font-family:var(--font-display);color:var(--navy);font-size:1.14rem;margin:0 0 2px}
.pz-h3-nr{font-family:"Caveat",cursive;color:#c62828;font-size:1.7rem;line-height:1;min-width:16px}
.pz-h3 small{font-family:var(--font-body);font-size:.78rem;font-weight:800;color:var(--text-light);margin-left:auto}
.pz-h3-sub{font-size:.84rem;color:var(--text-light);margin:2px 0 10px;line-height:1.5;max-width:72ch}
.pz-stare{display:flex;gap:10px;align-items:center;justify-content:space-between;flex-wrap:wrap;padding:10px 12px;border-radius:12px;background:#fff;border:1px solid var(--border);font-size:.84rem;color:var(--navy);line-height:1.45;margin-bottom:10px}
.pz-stare span{flex:1 1 240px}
.pz-gol{padding:14px 16px;border-radius:14px;border:1.5px dashed var(--cream-dark);background:#fdfbf4;font-size:.86rem;color:var(--text-light);line-height:1.5}
`}</style>
  );

  if (authLoading) {
    return <>{header}<div className="content-list"><div className="container" style={{ padding: '40px 0', textAlign: 'center', color: 'var(--text-light)' }}>Se încarcă…</div></div></>;
  }

  if (!user) {
    return (
      <>
        {header}
        <div className="content-list"><div className="container">
          <div style={{ ...card, textAlign: 'center', padding: 36 }}>
            <div style={{ fontSize: '2.2rem' }}>🗺️🔥🏆</div>
            <h2 style={{ fontFamily: 'var(--font-display)', color: 'var(--navy)', margin: '10px 0 6px' }}>Harta ta până la examen</h2>
            <p style={{ color: 'var(--text-light)', maxWidth: 580, margin: '0 auto 18px', lineHeight: 1.6 }}>
              Alegi examenul (Evaluarea Națională sau BAC) sau clasa și primești exercițiile în ordine, pe două hărți:
              întâi cele interactive (capitole, exerciții pe subiecte, teste interactive), apoi subiectele de examen PDF,
              corectate după barem. Fiecare zi lucrată îți aduce XP, o serie de zile la rând și un loc în liga
              săptămânii — iar noi îți amintim de pasul zilei.
            </p>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
              <Link to="/inregistrare" className="btn btn-primary">Creează cont gratuit</Link>
              <Link to="/autentificare" className="btn btn-outline">Am deja cont</Link>
            </div>
          </div>
        </div></div>
      </>
    );
  }

  if (!p && !err) {
    return <>{header}<div className="content-list"><div className="container"><div style={{ ...card, color: 'var(--text-light)' }}>🗺️ Se pregătește harta…</div></div></div></>;
  }

  if (p && p.activ === false) {
    return (
      <>
        {header}
        <div className="content-list"><div className="container">
          <div style={{ ...card, borderColor: isAdmin ? 'var(--danger)' : 'var(--border)' }}>
            {isAdmin
              ? <><strong style={{ color: 'var(--danger)' }}>Pregătirea zilnică nu e activă.</strong> Rulează <code>supabase/pregatire_zilnica.sql</code> în Supabase → SQL Editor.{p.mesaj && <div style={{ fontSize: '.8rem', color: 'var(--text-muted)', marginTop: 6 }}>{p.mesaj}</div>}</>
              : 'Pregătirea zilnică pornește în curând. Până atunci, testele de examen le găsești la Evaluarea Națională și Bacalaureat.'}
          </div>
        </div></div>
      </>
    );
  }

  const lucrat = !!p?.lucrat;
  const t = p?.test;
  const r = p?.recompensa || {};
  // cele două hărți (api/_lib/planPregatire.js → vedere): plan.interactiv, plan.pdf, plan.pas
  const arePlan = p?.plan && p.plan.interactiv && p.plan.pdf;
  const plan = arePlan && (p.plan.interactiv.noduri || []).length + (p.plan.pdf.noduri || []).length > 0 ? p.plan : null;
  const noduri = {};
  for (const h of NR_HARTI) noduri[h] = plan ? (plan[h].noduri || []).map((n, i) => ({ ...n, i, harta: h })) : [];
  const curentDin = (h) => (plan && plan[h] && plan[h].curent >= 0 ? noduri[h][plan[h].curent] || null : null);
  // pasul zilei: din harta interactivă; după ce e gata, din harta PDF
  const hartaPas = plan?.pas?.harta && noduri[plan.pas.harta] ? plan.pas.harta : null;
  const pas = hartaPas ? curentDin(hartaPas) : null;
  const etapaPas = pas ? plan[hartaPas].etape.find((e) => e.id === pas.etapa) : null;
  // harta PDF are pasul ei; cu Premium se lucrează și în paralel
  const pasPdf = curentDin('pdf');
  const nodAles = ales && plan ? (noduri[ales.harta] || []).find((n) => n.id === ales.id) || null : null;
  const alege1 = (h) => (n) => setAles((cur) => (cur && cur.id === n.id ? null : { harta: h, id: n.id }));
  const laPasulMeu = (h) => {
    const tinta = curentDin(typeof h === 'string' ? h : hartaPas) || pas;
    setAles(null);
    if (tinta) setTimeout(() => document.getElementById(`pas-${tinta.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 60);
  };
  const ramasePremium = plan ? (plan.interactiv.ramasePremium || 0) + (plan.pdf.ramasePremium || 0) : 0;
  const pdfBlocata = !!plan && hartaBlocata(plan.pdf);
  const laClasa = p?.examen?.tip === 'clasa';

  // progresul zilei (bifa de la 3 exerciții), sub pasul de azi
  const progresZi = lucrat ? (
    <div style={{ fontSize: '.86rem', color: '#1e7e34', fontWeight: 600, marginBottom: 10, lineHeight: 1.5 }}>
      ✅ Ziua e bifată{p.xpPrimit ? ` · +${p.xpPrimit} XP` : ''}{p.undeA ? ` · ai lucrat la: ${p.undeA}` : ''}. Poți merge mai departe pe hartă — fiecare exercițiu îți aduce XP.
    </div>
  ) : p?.itemi > 0 ? (
    <div style={{ fontSize: '.86rem', color: '#9a5b00', fontWeight: 600, marginBottom: 10 }}>
      Azi ai lucrat la {p.itemi} {p.itemi === 1 ? 'exercițiu' : 'exerciții'} — încă {Math.max(1, (p.prag || 3) - p.itemi)} și ziua e bifată.
    </div>
  ) : (
    <div style={{ fontSize: '.86rem', color: 'var(--text-light)', marginBottom: 10, lineHeight: 1.5 }}>
      Ziua se bifează de la <strong>{p?.prag || 3} exerciții</strong> lucrate — contează și o parte dintr-un test.
    </div>
  );

  return (
    <>
      {header}
      {stil}
      <div className="content-list">
        <div className="container pz-grid">
          {err && <div style={{ ...card, borderColor: 'var(--danger)', color: 'var(--danger)' }}>{err}</div>}

          {p?.alegeExamen ? (
            <div style={{ ...card, borderColor: 'var(--gold)', borderWidth: 2 }}>
              <div style={{ ...eticheta, color: 'var(--gold-dim)' }}>Primul pas</div>
              <h2 style={{ fontFamily: 'var(--font-display)', color: 'var(--navy)', margin: '6px 0 4px', fontSize: '1.35rem' }}>Pentru ce te pregătești?</h2>
              <p style={{ color: 'var(--text-light)', margin: 0, fontSize: '.92rem', lineHeight: 1.55 }}>
                Primești două hărți: întâi exercițiile interactive, în ordinea din site (la examen — capitolele, exercițiile
                pe subiecte și testele interactive), apoi subiectele de examen PDF, corectate după barem. Treci de la un pas
                la altul când îl rezolvi, sau după câteva încercări.
              </p>
              <AlegereTinta p={p} busy={busy} onAlege={alege} />
            </div>
          ) : p && (
            <>
              {p.pauza && pas && (
                <div style={{ ...card, background: 'var(--cream)' }} className="pz-pauza">
                  <div style={{ fontSize: '.92rem', color: 'var(--navy)', lineHeight: 1.5 }}>
                    <strong>Bine ai revenit!</strong> Seria de zile o iei de la capăt, dar planul te așteaptă exact unde l-ai lăsat: <strong>pasul {pas.i + 1}</strong> din {hartaPas === 'pdf' ? 'harta subiectelor PDF' : 'harta exercițiilor interactive'}.
                  </div>
                  <button type="button" className="btn btn-sm btn-primary" onClick={() => deschide(pas.tip === 'pdf' ? urlPas(pas, 'pdf') : urlPas(pas), pas)}>▶ Continuă</button>
                </div>
              )}

              <div className="pz-main">
                {/* ─── Pasul de azi ─── */}
                <div className="pz-a-pas" style={{ ...card, borderColor: lucrat ? 'var(--success)' : 'var(--gold)', borderWidth: 2 }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
                    <div style={{ ...eticheta, color: lucrat ? 'var(--success)' : 'var(--gold-dim)' }}>
                      🗺️ Pasul de azi{lucrat ? ' · ziua e bifată' : ''}
                    </div>
                    <button type="button" onClick={() => setSchimba((v) => !v)}
                      style={{ background: 'none', border: '1px solid var(--border)', borderRadius: 999, padding: '3px 10px', fontSize: '.76rem', fontWeight: 700, color: 'var(--navy)', cursor: 'pointer' }}
                      title="Schimbă examenul sau clasa">
                      {p.examen?.label} ✎
                    </button>
                  </div>

                  {schimba && (
                    <div style={{ background: 'var(--cream)', borderRadius: 12, padding: '10px 12px', marginTop: 10 }}>
                      <div style={{ fontSize: '.82rem', color: 'var(--text-light)' }}>
                        Alege alt examen sau altă clasă — harta se schimbă pe loc; ce ai rezolvat rămâne rezolvat.
                      </div>
                      <AlegereTinta p={p} busy={busy} onAlege={alege} />
                    </div>
                  )}

                  <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', alignItems: 'center', marginTop: 12 }}>
                    <div style={{ textAlign: 'center', minWidth: 92 }}>
                      <div style={{ fontSize: '2.1rem', fontWeight: 800, color: 'var(--navy)', lineHeight: 1 }}>🔥 {p.serie || 0}</div>
                      <div style={{ fontSize: '.74rem', color: 'var(--text-muted)', marginTop: 4 }}>{p.serie === 1 ? 'zi la rând' : 'zile la rând'}</div>
                    </div>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }} aria-label="Zilele din săptămâna aceasta">
                      {(p.saptamana || []).map((z) => <Zi key={z.day} z={z} />)}
                    </div>
                  </div>

                  <div style={{ marginTop: 14, padding: '14px 16px', borderRadius: 14, background: lucrat ? 'rgba(39,174,96,0.08)' : 'rgba(232,185,49,0.10)' }}>
                    {pas ? (
                      <>
                        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', fontSize: '.76rem', color: 'var(--text-light)', fontWeight: 700 }}>
                          <span style={{ borderRadius: 999, padding: '2px 8px', background: '#fff', border: '1px solid var(--border)', color: 'var(--navy)' }}>
                            {HARTI[hartaPas].icon} {HARTI[hartaPas].scurt}
                          </span>
                          <span>{etapaPas?.titlu} · pasul {pas.i + 1} din {plan[hartaPas].total}</span>
                          {pas.nou && <span className="pz-nou">nou în site</span>}
                        </div>
                        <div style={{ fontWeight: 800, color: 'var(--navy)', fontSize: '1.1rem', margin: '8px 0 4px' }}>{pas.titlu}</div>
                        <div style={{ fontSize: '.86rem', color: 'var(--text-light)', marginBottom: 8, lineHeight: 1.5 }}>{descriere(pas, { esteCurent: true, reguli: plan.reguli })}</div>
                        {progresZi}
                        {p.nota != null && (
                          <div style={{ fontSize: '.84rem', marginBottom: 10, color: 'var(--navy)' }}>
                            Nota de azi: <strong style={{ color: '#c62828', fontFamily: '"Caveat", cursive', fontSize: '1.25rem' }}>{fmtNota(p.nota)}</strong>
                            <span style={{ color: 'var(--text-muted)' }}> · o vezi doar tu (în Arenă nu apar note)</span>
                          </div>
                        )}
                        <ActiuniPas n={pas} esteCurent plan={plan} busy={busy} mare onDeschide={deschide} onSari={sari} onLaPasulMeu={() => laPasulMeu(hartaPas)} />
                      </>
                    ) : plan?.terminat ? (
                      <>
                        <div style={{ fontWeight: 800, color: 'var(--navy)', fontSize: '1.08rem', marginBottom: 6 }}>
                          🏁 {ramasePremium ? 'Ai terminat tot ce e gratuit în plan!' : 'Ai parcurs ambele hărți!'}
                        </div>
                        <div style={{ fontSize: '.86rem', color: 'var(--text-light)', lineHeight: 1.5, marginBottom: 10 }}>
                          {ramasePremium ? ceRamaneCuPremium(plan) : 'Poți relua pașii sub prag sau alege altă țintă.'}
                          {t ? ` Pentru azi, o recapitulare: „${t.titlu}".` : ''}
                        </div>
                        {progresZi}
                        <div className="pz-act">
                          {t && <button type="button" className="btn btn-primary" onClick={() => deschide(t.url, { id: t.id })}>▶ Recapitulare</button>}
                          {ramasePremium > 0 && <Link to="/preturi" className="btn btn-outline">⭐ Premium</Link>}
                        </div>
                      </>
                    ) : t ? (
                      <>
                        <div style={{ fontWeight: 800, color: 'var(--navy)', fontSize: '1.08rem', margin: '0 0 6px' }}>{t.titlu}</div>
                        {progresZi}
                        <div className="pz-act">
                          <button type="button" className="btn btn-primary btn-lg" onClick={() => deschide(t.url, { id: t.id })}>
                            {lucrat ? '↻ Mai lucrează' : p.itemi > 0 ? '▶ Continuă' : '▶ Începe'}
                          </button>
                        </div>
                      </>
                    ) : (
                      <div style={{ fontSize: '.9rem', color: 'var(--text-light)' }}>
                        Nu am găsit încă exerciții pentru {p.examen?.label}{!p.premium ? ' printre cele gratuite' : ''}. Alege altă țintă.
                      </div>
                    )}
                  </div>

                  {plan && (
                    <div className="pz-progs" aria-label="Cât ai parcurs din fiecare hartă">
                      {NR_HARTI.map((h) => <ProgresHarta key={h} id={h} h={plan[h]} laClasa={laClasa} />)}
                      {ramasePremium > 0 && (
                        <div style={{ fontSize: '.78rem', color: 'var(--text-muted)', marginTop: 2 }}>
                          ⭐ {seDeschideCu(plan)}{' '}
                          <Link to="/preturi" style={{ color: 'var(--navy)', fontWeight: 700 }}>Premium</Link>.
                        </div>
                      )}
                    </div>
                  )}

                  <AmintireZilnica notif={notif} setNotif={setNotif} isAdmin={isAdmin} texte={TEXTE_AMINTIRE} />
                </div>

                {/* ─── Răsplățile ─── */}
                <div className="pz-a-side">
                  <div style={card}>
                    <div style={{ ...eticheta, color: 'var(--text-muted)' }}>🏆 Ce câștigi</div>
                    <ul style={{ margin: '10px 0 0', paddingLeft: 18, fontSize: '.88rem', color: 'var(--text-light)', lineHeight: 1.65 }}>
                      <li><strong>+{r.xp ?? 25} XP și {r.coins ?? 5} 🪙</strong> pentru fiecare zi bifată (+{r.bun ?? 10} XP la {r.pragBun ?? 80}% sau mai mult).</li>
                      <li>La fiecare <strong>{r.seriePas ?? 7} zile la rând</strong>: încă +{r.serieXp ?? 40} XP și {r.serieMonede ?? 15} 🪙.</li>
                      <li>Punctele intră în <strong>liga săptămânii</strong> din Arenă: primii 3 promovează luni (🥉 → 🥈 → 🥇 → 💎 → 👑).</li>
                      <li>Insigne pentru serii și pentru zilele de pregătire.</li>
                    </ul>
                    <div style={{ marginTop: 12, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      <Link to="/arena" className="btn btn-sm btn-primary">⚔️ Clasamentul din Arenă</Link>
                    </div>
                    <div style={{ fontSize: '.76rem', color: 'var(--text-muted)', marginTop: 10 }}>
                      Zile bifate: <strong>{p.total || 0}</strong>{p.record ? ` · record: ${p.record} ${p.record === 1 ? 'zi' : 'zile'} la rând` : ''}.
                    </div>
                  </div>

                  <div style={card}>
                    <div style={{ ...eticheta, color: 'var(--text-muted)' }}>🏅 Insignele pregătirii</div>
                    <div style={{ display: 'grid', gap: 8, marginTop: 10 }}>
                      {(p.insigneToate || []).map((b) => {
                        const are = (p.insigne || []).some((x) => x.id === b.id);
                        return (
                          <div key={b.id} className={`pz-ins ${are ? 'on' : 'off'}`} title={b.desc}>
                            <span style={{ fontSize: '1.3rem' }}>{b.icon}</span>
                            <div style={{ lineHeight: 1.3 }}>
                              <div style={{ fontWeight: 800, fontSize: '.84rem', color: 'var(--navy)' }}>{b.name}{are ? ' ✓' : ''}</div>
                              <div style={{ fontSize: '.72rem', color: 'var(--text-muted)' }}>{b.desc}</div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>

                {/* ─── 🗺️ Harta pregătirii: 1 · exercițiile interactive, 2 · subiectele PDF cu barem ─── */}
                {plan && (
                  <section className="pz-a-harta" aria-labelledby="pz-harta-tit">
                    <div className="pz-harta-cap">
                      <h2 id="pz-harta-tit">🗺️ Harta pregătirii · {p.examen?.label}</h2>
                      <span style={{ fontSize: '.8rem', color: 'var(--text-light)' }}>
                        Treci la pasul următor de la {plan.reguli?.pragInteractiv ?? 70}% (subiectele PDF: nota 5) sau după {plan.reguli?.incercariSarire ?? 3} încercări.
                      </span>
                    </div>

                    <div className="pz-harta-n" aria-labelledby="pz-h-int">
                      <h3 className="pz-h3" id="pz-h-int">
                        <span className="pz-h3-nr" aria-hidden="true">1</span> 🧩 Exerciții interactive
                        <small>{plan.interactiv.trecute} din {plan.interactiv.total}</small>
                      </h3>
                      <p className="pz-h3-sub">
                        {laClasa
                          ? `Exercițiile interactive ale ${String(p.examen?.label || '').replace('Clasa', 'clasei')}, apoi ale claselor dinainte, în ordinea din site.`
                          : 'Capitolele, exercițiile pe subiecte și testele interactive, în ordinea din site.'}
                      </p>
                      {plan.interactiv.terminat && plan.pdf.total > 0 && (
                        <div className="pz-stare"><span>🏁 Ai terminat harta exercițiilor interactive{pdfBlocata ? '.' : ' — pasul zilei vine acum din harta subiectelor PDF.'}</span></div>
                      )}
                      {plan.interactiv.total > 0
                        ? <HartaPlan plan={plan.interactiv} alesId={ales?.harta === 'interactiv' ? ales.id : null} onAlege={alege1('interactiv')} />
                        : <div className="pz-gol">Încă nu avem exerciții interactive pentru {p.examen?.label}. Apar aici singure, pe măsură ce le adăugăm.</div>}
                    </div>

                    <div className="pz-harta-n" aria-labelledby="pz-h-pdf">
                      <h3 className="pz-h3" id="pz-h-pdf">
                        <span className="pz-h3-nr" aria-hidden="true">2</span> 📄 {laClasa ? 'Fișe PDF cu barem' : 'Subiecte de examen PDF, cu barem'}
                        {plan.pdf.total > 0 && <small>{pdfBlocata ? '⭐ cu Premium' : `${plan.pdf.trecute} din ${plan.pdf.total}`}</small>}
                      </h3>
                      <p className="pz-h3-sub">
                        {laClasa
                          ? `Fișele PDF ale ${String(p.examen?.label || '').replace('Clasa', 'clasei')} și ale claselor dinainte care au barem.`
                          : `Variantele${String(p.examen?.id || '').startsWith('bac') ? ', testele de antrenament' : ''} și simulările care au barem.`}
                        {' '}Profesorul virtual le corectează după barem; trimiți rezolvarea pe PDF, în chat, pe foaia de lucru sau cu poza.
                      </p>
                      {plan.pdf.total === 0 ? (
                        <div className="pz-gol">
                          {laClasa
                            ? `Încă nu avem fișe PDF cu barem pentru ${String(p.examen?.label || '').replace('Clasa', 'clasa')} și clasele dinainte. Apar aici singure, când le adăugăm.`
                            : `Încă nu avem subiecte cu barem legat pentru ${p.examen?.label}. Apar aici singure, pe măsură ce le legăm.`}
                        </div>
                      ) : (
                        <>
                          {pdfBlocata ? (
                            <div className="pz-stare">
                              <span>⭐ Harta subiectelor PDF se deschide cu Premium: profesorul virtual corectează fiecare subiect după barem.</span>
                              <Link to="/preturi" className="btn btn-sm btn-primary">⭐ Vezi abonamentele</Link>
                            </div>
                          ) : plan.pdf.terminat ? (
                            <div className="pz-stare"><span>🏁 Ai parcurs toate subiectele cu barem. Le poți relua oricând.</span></div>
                          ) : pasPdf && hartaPas !== 'pdf' ? (
                            <div className="pz-stare">
                              <span>Poți lucra și la harta asta, în paralel — pasul zilei rămâne pe harta exercițiilor interactive până o termini.</span>
                              <button type="button" className="btn btn-sm btn-outline" onClick={() => setAles({ harta: 'pdf', id: pasPdf.id })}>📄 Subiectul de acum: pasul {pasPdf.i + 1}</button>
                            </div>
                          ) : null}
                          <HartaPlan plan={plan.pdf} legenda={false} alesId={ales?.harta === 'pdf' ? ales.id : null} onAlege={alege1('pdf')} />
                        </>
                      )}
                    </div>

                    {!plan.coloana && isAdmin && (
                      <div style={{ fontSize: '.78rem', color: 'var(--danger)', marginTop: 6 }}>
                        Admin: rulează <code>supabase/plan_pregatire.sql</code> — fără el, „⏭ Treci mai departe" nu se poate salva.
                      </div>
                    )}
                  </section>
                )}
              </div>

            </>
          )}

          {/* ─── Ultimele zile (doar pentru elev; nota nu apare nicăieri altundeva public) ─── */}
          {p && !p.alegeExamen && (p.ultimele || []).length > 0 && (
            <div style={card}>
              <div style={{ ...eticheta, color: 'var(--text-muted)' }}>🗓️ Ultimele zile de pregătire</div>
              <div style={{ display: 'grid', gap: 2, marginTop: 10 }}>
                {p.ultimele.map((u) => (
                  <div key={u.zi} style={{ display: 'grid', gridTemplateColumns: '110px 1fr auto', gap: 10, alignItems: 'center', padding: '7px 8px', borderRadius: 8, background: 'var(--cream)', fontSize: '.86rem' }}>
                    <span style={{ color: 'var(--text-muted)' }}>{ziua(u.zi)}</span>
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--navy)', fontWeight: 600 }}>✓ {u.titlu}</span>
                    <span style={{ color: 'var(--text-light)', whiteSpace: 'nowrap' }}>{u.itemi} ex.{u.nota != null ? ` · ${fmtNota(u.nota)}` : ''}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ─── Altfel de pregătire: cu Prof. Tudor (ședințele pe barem) ─── */}
          <div style={{ ...card, background: 'var(--cream)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
            <div style={{ fontSize: '.9rem', color: 'var(--text-light)', maxWidth: 640 }}>
              <strong style={{ color: 'var(--navy)' }}>Vrei să lucrezi cu un profesor?</strong>{' '}
              La „Pregătirea de examen" cu Prof. Tudor treci prin examen exercițiu cu exercițiu, explicat pe baremul oficial,
              iar la Meditații live rezolvă zilnic câte un subiect la tablă.
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <Link to="/meditatii/pregatire" className="btn btn-sm btn-outline">🎓 Cu Prof. Tudor</Link>
              <Link to="/meditatii" className="btn btn-sm btn-outline">🔴 Meditații live</Link>
            </div>
          </div>
        </div>
      </div>

      {nodAles && plan && (
        <FisaPas n={nodAles} harta={plan[nodAles.harta]} plan={plan} busy={busy} onInchide={() => setAles(null)}
          onDeschide={deschide} onSari={sari} onLaPasulMeu={() => laPasulMeu(nodAles.harta)} />
      )}
    </>
  );
}
