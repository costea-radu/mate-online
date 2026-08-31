// =====================================================================
// src/components/DueluriPanel.jsx — duelurile 1-la-1 din Arena (pasul 3)
// Provocări primite/trimise, dueluri active, bilanț și istoricul recent.
// API: /api/duel (list · optiuni · create · respond · set_open)
// =====================================================================
import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { aiClient } from '../lib/aiClient';
import { arenaChanged } from '../lib/arena';

const card = {
  background: 'var(--white)', border: '1px solid var(--border)',
  borderRadius: 'var(--radius-lg)', padding: '18px 20px', boxShadow: 'var(--shadow-sm)',
};
const rand = {
  display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10,
  padding: '10px 12px', borderRadius: 10, background: 'var(--cream)', marginBottom: 8,
};

// „fractii" trebuie să găsească „Fracții": comparăm fără diacritice.
function faraDiacritice(s) {
  return String(s || '').toLowerCase()
    .replace(/[ăâ]/g, 'a').replace(/î/g, 'i').replace(/[șş]/g, 's').replace(/[țţ]/g, 't')
    .replace(/\s+/g, ' ').trim();
}

function cuCateOre(deadline) {
  if (!deadline) return null;
  const ore = Math.round((new Date(deadline) - Date.now()) / 3600000);
  if (ore <= 0) return 'expiră acum';
  if (ore < 24) return `${ore} h rămase`;
  return `${Math.round(ore / 24)} zile rămase`;
}

export default function DueluriPanel() {
  const navigate = useNavigate();
  const [d, setD] = useState(null);
  const [optiuni, setOptiuni] = useState(null);
  const [formOpen, setFormOpen] = useState(false);
  const [coleg, setColeg] = useState('');
  const [exercitiu, setExercitiu] = useState('');
  const [cauta, setCauta] = useState('');
  const [mod, setMod] = useState('interactive');       // 🧩 interactive · 📄 PDF
  const [cautaColeg, setCautaColeg] = useState('');   // caută pe oricine de pe site
  const [gasitiColegi, setGasitiColegi] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  const load = useCallback(async () => {
    try { setD(await aiClient.duel({ action: 'list' })); }
    catch (e) { setErr(e?.message || 'Nu am putut încărca duelurile.'); }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Adversarul acceptă provocarea pe calculatorul LUI — fără asta, „Rezolvă
  // acum" apărea abia după ce reîncărcai pagina. Reîmprospătăm la revenirea în
  // tab și din minut în minut (doar cu tabul vizibil, ca să nu batem serverul).
  useEffect(() => {
    const reia = () => { if (document.visibilityState === 'visible') load(); };
    document.addEventListener('visibilitychange', reia);
    window.addEventListener('focus', reia);
    const t = setInterval(reia, 60000);
    return () => {
      document.removeEventListener('visibilitychange', reia);
      window.removeEventListener('focus', reia);
      clearInterval(t);
    };
  }, [load]);

  // Căutare de persoane în tot site-ul (nu doar printre colegi), cu o mică
  // pauză după tastare ca să nu batem serverul la fiecare literă.
  useEffect(() => {
    const q = cautaColeg.trim();
    if (q.length < 3) { setGasitiColegi(null); return undefined; }
    const t = setTimeout(() => {
      aiClient.duel({ action: 'cauta', q })
        .then((r) => setGasitiColegi(r.items || []))
        .catch(() => setGasitiColegi([]));
    }, 350);
    return () => clearTimeout(t);
  }, [cautaColeg]);

  async function deschideForm() {
    setFormOpen((v) => !v);
    setErr(null);
    if (!optiuni) {
      try { setOptiuni(await aiClient.duel({ action: 'optiuni' })); }
      catch (e) { setErr(e?.message || 'Nu am putut încărca lista de colegi.'); }
    }
  }

  async function provoaca() {
    if (!coleg || !exercitiu) { setErr('Alege colegul și exercițiul.'); return; }
    setBusy(true); setErr(null);
    try {
      await aiClient.duel({ action: 'create', opponentId: coleg, contentId: exercitiu });
      setFormOpen(false); setColeg(''); setExercitiu('');
      await load();
    } catch (e) { setErr(e?.message || 'Provocarea nu s-a putut trimite.'); }
    finally { setBusy(false); }
  }

  async function raspunde(id, accept) {
    setBusy(true); setErr(null);
    try { await aiClient.duel({ action: 'respond', id, accept }); await load(); }
    catch (e) { setErr(e?.message || 'Nu am putut răspunde.'); }
    finally { setBusy(false); }
  }

  async function comutaAcceptarea() {
    setBusy(true);
    try { await aiClient.duel({ action: 'set_open', open: !d.accept }); await load(); }
    catch { /* ignorăm */ }
    finally { setBusy(false); }
  }

  // Ce apare în dreapta unui duel: „Rezolvă acum" cât timp n-ai trimis nimic,
  // „Continuă duelul" dacă ai doar salvarea automată de la jumătate (rezultat
  // provizoriu — duelul rămâne deschis), altfel textul cu procentul trimis.
  function actiune(x, asteptare) {
    if (x.provizoriu) {
      return (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ fontSize: '0.8rem', color: 'var(--text-light)' }}
            title="Salvare automată. Apasă „Verifică” în exercițiu ca rezultatul să fie final.">
            💾 salvat {x.scorulMeu.pct}%
          </span>
          <button onClick={() => joaca(x)} className="btn btn-sm btn-primary">Continuă duelul</button>
        </span>
      );
    }
    if (x.amJucat) return <span style={{ fontSize: '0.85rem', color: 'var(--text-light)' }}>{asteptare(x)}</span>;
    return <button onClick={() => joaca(x)} className="btn btn-sm btn-primary">Rezolvă acum</button>;
  }

  function joaca(d1) {
    arenaChanged();
    const ruta = d1.material.tip === 'pdf' ? '/pdf-viewer' : '/exercitiu';
    navigate(`${ruta}?id=${d1.material.id}&duel=${d1.id}`);
  }

  // Dacă încărcarea a eșuat, arătăm eroarea — altfel panoul dispărea din
  // pagină fără nicio explicație.
  if (!d) {
    return err ? (
      <div style={{ ...card, borderColor: 'var(--danger)' }}>
        <div style={{ fontFamily: 'var(--font-display)', fontSize: '1.25rem', marginBottom: 6 }}>⚔️ Dueluri</div>
        <div style={{ color: 'var(--danger)', fontSize: '0.88rem' }}>{err}</div>
      </div>
    ) : null;
  }

  const nimic = !d.primite.length && !d.trimise.length && !d.active.length && !d.incheiate.length;
  // Lista completă a modului ales (interactive / PDF) vine de pe server, fără
  // bareme; căutarea se face aici, în pagină, deci e instantanee.
  const lista = (optiuni?.materiale?.[mod]) || [];
  const q = faraDiacritice(cauta);
  const gasite = q ? lista.filter((x) => faraDiacritice(`${x.titlu} ${x.categorie}`).includes(q)) : lista;
  const alesMaterial = exercitiu
    ? [...(optiuni?.materiale?.interactive || []), ...(optiuni?.materiale?.pdf || [])].find((x) => x.id === exercitiu)
    : null;
  // lista de persoane: rezultatele căutării dacă s-a căutat, altfel colegii mei
  const listaPersoane = gasitiColegi !== null ? gasitiColegi : (optiuni?.colegi || []);

  return (
    <div style={card}>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10, marginBottom: 12 }}>
        <div style={{ fontFamily: 'var(--font-display)', fontSize: '1.25rem' }}>⚔️ Dueluri</div>
        {(d.bilant.castigate > 0 || d.bilant.pierdute > 0) && (
          <span style={{ fontSize: '0.82rem', color: 'var(--text-light)' }}>
            {d.bilant.castigate}V – {d.bilant.pierdute}Î
          </span>
        )}
        <button onClick={deschideForm} className="btn btn-sm btn-primary" style={{ marginLeft: 'auto' }}>
          {formOpen ? 'Renunță' : '⚔️ Provoacă un coleg'}
        </button>
      </div>

      {err && <div style={{ color: 'var(--danger)', fontSize: '0.85rem', marginBottom: 10 }}>{err}</div>}

      {formOpen && (
        <div style={{ ...rand, flexDirection: 'column', alignItems: 'stretch', gap: 10, background: 'var(--cream)' }}>
          {!optiuni ? <span style={{ color: 'var(--text-light)' }}>Se încarcă…</span> : (
            <>
              {(
                <>
                  <label style={{ fontSize: '0.85rem', fontWeight: 700 }}>Pe cine provoci?
                    <input value={cautaColeg} onChange={(e) => setCautaColeg(e.target.value)}
                      placeholder="caută pe oricine de pe site (min. 3 litere)…"
                      style={{ display: 'block', width: '100%', marginTop: 4, padding: '8px 10px', borderRadius: 8, border: '1px solid var(--border)' }} />
                    <select value={coleg} onChange={(e) => setColeg(e.target.value)}
                      size={Math.min(6, Math.max(3, listaPersoane.length + 1))}
                      style={{ display: 'block', width: '100%', marginTop: 6, padding: '6px', borderRadius: 8, border: '1px solid var(--border)' }}>
                      {!listaPersoane.length && <option value="">— niciun rezultat —</option>}
                      {listaPersoane.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.nume}{c.rol && c.rol !== 'elev' ? ` (${c.rol})` : ''}
                        </option>
                      ))}
                    </select>
                    <span style={{ fontWeight: 400, fontSize: '0.76rem', color: 'var(--text-muted)' }}>
                      {gasitiColegi
                        ? `${gasitiColegi.length} ${gasitiColegi.length === 1 ? 'persoană găsită' : 'persoane găsite'}`
                        : optiuni.colegi.length
                          ? `${optiuni.colegi.length} colegi în lista ta · scrie un nume pentru a căuta în tot site-ul`
                          : 'Nu ai colegi în listă — caută pe oricine de pe site după nume.'}
                    </span>
                  </label>
                  <div>
                    <div style={{ fontSize: '0.85rem', fontWeight: 700, marginBottom: 6 }}>La ce material?</div>

                    {/* DOUĂ MODURI: exerciții interactive și teste PDF.
                        Listele vin întregi de pe server (toate materialele
                        site-ului, fără bareme), deci filtrarea de mai jos e
                        instantanee — nicio cerere în plus la tastare. */}
                    <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
                      {[
                        { id: 'interactive', et: '🧩 Interactive' },
                        { id: 'pdf', et: '📄 PDF' },
                      ].map((m) => (
                        <button key={m.id} type="button" onClick={() => { setMod(m.id); setCauta(''); }}
                          style={{
                            flex: 1, padding: '7px 10px', borderRadius: 999, cursor: 'pointer',
                            fontSize: '0.82rem', fontWeight: 700,
                            border: `1px solid ${mod === m.id ? 'var(--gold)' : 'var(--border)'}`,
                            background: mod === m.id ? 'rgba(232,185,49,0.18)' : '#fff',
                            color: mod === m.id ? 'var(--navy)' : 'var(--text-light)',
                          }}>
                          {m.et}
                          {optiuni.total && optiuni.total[m.id] ? (
                            <span style={{ fontWeight: 500, opacity: 0.7 }}> · {optiuni.total[m.id]}</span>
                          ) : null}
                        </button>
                      ))}
                    </div>

                    <input value={cauta} onChange={(e) => setCauta(e.target.value)}
                      placeholder={mod === 'pdf'
                        ? 'caută un test PDF după titlu sau clasă (ex. 2026, bacalaureat)…'
                        : 'caută un exercițiu interactiv după titlu sau clasă (ex. fracții, clasa-7)…'}
                      style={{ display: 'block', width: '100%', padding: '8px 10px', borderRadius: 8, border: '1px solid var(--border)' }} />

                    {/* materialul ales rămâne la vedere, chiar dacă schimbi modul */}
                    {alesMaterial && (
                      <div style={{ marginTop: 8 }}>
                        <button type="button" onClick={() => setExercitiu('')} title="renunță la material"
                          style={{
                            display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer',
                            border: '1px solid var(--border)', background: 'rgba(232,185,49,0.16)',
                            borderRadius: 999, padding: '4px 10px', fontSize: '0.78rem', maxWidth: '100%',
                          }}>
                          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 240 }}>
                            {alesMaterial.tip === 'pdf' ? '📄' : '🧩'} {alesMaterial.titlu}
                          </span>
                          <span style={{ color: 'var(--text-muted)', fontWeight: 700 }}>✕</span>
                        </button>
                      </div>
                    )}

                    <div style={{ maxHeight: 220, overflowY: 'auto', marginTop: 8, border: '1px solid var(--border)', borderRadius: 8, background: '#fff' }}>
                      {gasite.slice(0, 400).map((x) => (
                        <button key={x.id} type="button" onClick={() => setExercitiu(x.id)}
                          style={{
                            display: 'flex', gap: 8, alignItems: 'center', width: '100%', textAlign: 'left',
                            padding: '6px 10px', fontSize: '0.86rem', cursor: 'pointer',
                            border: 'none', borderBottom: '1px solid var(--border)',
                            background: exercitiu === x.id ? 'rgba(232,185,49,0.16)' : 'transparent',
                            fontWeight: exercitiu === x.id ? 700 : 400,
                          }}>
                          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {x.tip === 'pdf' ? '📄' : '🧩'} {x.titlu}
                          </span>
                          <span style={{ marginLeft: 'auto', color: 'var(--text-muted)', fontSize: '0.75rem', flexShrink: 0 }}>
                            {x.categorie}{x.gratuit ? '' : ' · premium'}
                          </span>
                        </button>
                      ))}
                      {!gasite.length && (
                        <div style={{ padding: 10, color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                          {cauta.trim()
                            ? `Niciun rezultat pentru „${cauta.trim()}" în ${mod === 'pdf' ? 'testele PDF' : 'exercițiile interactive'}. Încearcă alt cuvânt sau schimbă modul.`
                            : 'Nu există materiale de acest tip.'}
                        </div>
                      )}
                    </div>

                    <span style={{ fontWeight: 400, fontSize: '0.76rem', color: 'var(--text-muted)' }}>
                      {gasite.length} {gasite.length === 1 ? 'rezultat' : 'rezultate'}
                      {lista.length ? ` din ${lista.length} ${mod === 'pdf' ? 'teste PDF' : 'exerciții interactive'} de pe site` : ''}
                      {gasite.length > 400 ? ' · scrie mai multe litere ca să restrângi lista' : ''}
                    </span>
                  </div>

                  <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                    Amândoi primiți același exercițiu și aveți {optiuni.ore} de ore. Câștigă procentul; la egalitate, timpul.
                    Profesorul Virtual e închis în timpul duelului. Maximum {optiuni.maxPeZi} provocări pe zi.
                  </div>
                  <button onClick={provoaca} disabled={busy} className="btn btn-sm btn-primary" style={{ alignSelf: 'flex-start' }}>
                    Trimite provocarea
                  </button>
                </>
              )}
            </>
          )}
        </div>
      )}

      {d.primite.map((x) => (
        <div key={x.id} style={{ ...rand, background: 'rgba(232,185,49,0.14)' }}>
          <strong>⚔️ {x.adversar.nume} te-a provocat</strong>
          <span style={{ color: 'var(--text-light)', fontSize: '0.85rem' }}>
            {x.material.tip === 'pdf' ? '📄 ' : ''}{x.material.titlu}
          </span>
          <span style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
            <button onClick={() => raspunde(x.id, true)} disabled={busy} className="btn btn-sm btn-primary">Accept</button>
            <button onClick={() => raspunde(x.id, false)} disabled={busy} className="btn btn-sm btn-outline">Refuz</button>
          </span>
        </div>
      ))}

      {d.active.map((x) => (
        <div key={x.id} style={rand}>
          <strong>vs {x.adversar.nume}</strong>
          <span style={{ color: 'var(--text-light)', fontSize: '0.85rem' }}>{x.material.titlu}</span>
          <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>{cuCateOre(x.deadline)}</span>
          <span style={{ marginLeft: 'auto' }}>
            {actiune(x, (y) => `Ai trimis ${y.scorulMeu.pct}% · aștepți adversarul`)}
          </span>
        </div>
      ))}

      {d.trimise.map((x) => (
        <div key={x.id} style={rand}>
          <span>L-ai provocat pe <strong>{x.adversar.nume}</strong></span>
          <span style={{ color: 'var(--text-light)', fontSize: '0.85rem' }}>{x.material.titlu}</span>
          <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>așteaptă răspuns</span>
            {/* nu trebuie să aștepți acceptul ca să-ți rezolvi partea */}
            {actiune(x, (y) => `ai trimis ${y.scorulMeu.pct}%`)}
          </span>
        </div>
      ))}

      {d.incheiate.length > 0 && (
        <details style={{ marginTop: 8 }}>
          <summary style={{ cursor: 'pointer', fontSize: '0.85rem', color: 'var(--text-light)' }}>Dueluri încheiate</summary>
          <div style={{ marginTop: 8 }}>
            {d.incheiate.map((x) => (
              <div key={x.id} style={{ ...rand, background: 'transparent', borderBottom: '1px solid var(--border)', borderRadius: 0 }}>
                <span style={{ fontSize: '1.05rem' }}>
                  {x.rezultat === 'castigat' ? '🏆' : x.rezultat === 'pierdut' ? '▪️' : '🤝'}
                </span>
                <span>vs <strong>{x.adversar.nume}</strong></span>
                <span style={{ color: 'var(--text-light)', fontSize: '0.85rem' }}>
                  {x.scorulMeu ? `${x.scorulMeu.pct}%` : '—'} · {x.scorulLui ? `${x.scorulLui.pct}%` : '—'}
                </span>
                <span style={{ marginLeft: 'auto', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                  {x.tip === 'neprezentare' ? 'neprezentare' : x.material.titlu}
                </span>
              </div>
            ))}
          </div>
        </details>
      )}

      {nimic && !formOpen && (
        <div style={{ color: 'var(--text-light)', fontSize: '0.9rem' }}>
          Niciun duel deocamdată. Provoacă un coleg — amândoi primiți același exercițiu și aveți 48 de ore.
        </div>
      )}

      <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 14, fontSize: '0.82rem', color: 'var(--text-light)' }}>
        <input type="checkbox" checked={!!d.accept} onChange={comutaAcceptarea} disabled={busy} />
        Accept provocări de la colegi
      </label>
    </div>
  );
}
