// =====================================================================
// src/components/TurneePanel.jsx — turneele de grupă din Arena (pasul 4)
// Elevul vede turneele grupelor lui + clasamentul; profesorul poate deschide
// unul nou pe grupele lui. API: /api/turneu
// =====================================================================
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { aiClient } from '../lib/aiClient';

const card = {
  background: 'var(--white)', border: '1px solid var(--border)',
  borderRadius: 'var(--radius-lg)', padding: '18px 20px', boxShadow: 'var(--shadow-sm)',
};
const input = { display: 'block', width: '100%', marginTop: 4, padding: '8px 10px', borderRadius: 8, border: '1px solid var(--border)' };

function ramase(pana) {
  const ore = Math.round((new Date(pana) - Date.now()) / 3600000);
  if (ore <= 0) return 's-a încheiat';
  if (ore < 24) return `${ore} h rămase`;
  return `${Math.round(ore / 24)} zile rămase`;
}

export default function TurneePanel() {
  const [d, setD] = useState(null);
  const [opt, setOpt] = useState(null);
  const [formOpen, setFormOpen] = useState(false);
  const [f, setF] = useState({ groupId: '', title: '', message: '', zile: 7, contentIds: [], scope: 'grupa' });
  // Căutarea materialelor are DOUĂ MODURI: teste interactive și PDF-uri.
  // Rezultatele vin de pe server (tot site-ul), nu dintr-o listă preîncărcată.
  const [mod, setMod] = useState('interactive');
  const [filtru, setFiltru] = useState('');
  const [rez, setRez] = useState(null);          // { items, total, q, tip }
  const [caut, setCaut] = useState(false);
  const [alese, setAlese] = useState({});        // id → material bifat (rămâne vizibil între căutări)
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const cerereRef = useRef(0);

  const load = useCallback(async () => {
    try { setD(await aiClient.turneu({ action: 'list' })); }
    catch (e) { setErr(e?.message || 'Nu am putut încărca turneele.'); }
  }, []);
  useEffect(() => { load(); }, [load]);

  async function deschideForm() {
    setFormOpen((v) => !v); setErr(null);
    if (!opt) {
      try { setOpt(await aiClient.turneu({ action: 'optiuni' })); }
      catch (e) { setErr(e?.message || 'Nu am putut încărca grupele.'); }
    }
  }

  // Căutarea materialelor: se face PE SERVER, în tot site-ul. Se reia la
  // schimbarea modului (interactive / PDF) și după fiecare tastare, cu o mică
  // pauză ca să nu batem serverul la fiecare literă.
  useEffect(() => {
    if (!formOpen || !opt) return undefined;
    const q = filtru.trim();
    // lista de start a fiecărui mod vine deja din `optiuni` — fără cerere în plus
    if (!q && opt.materiale && opt.materiale[mod]) {
      setRez({ items: opt.materiale[mod], total: (opt.total || {})[mod] || 0, tip: mod, q: '', limita: opt.limitaCautare });
      setCaut(false);
      return undefined;
    }
    const nr = ++cerereRef.current;
    setCaut(true);
    const t = setTimeout(() => {
      aiClient.turneu({ action: 'materiale', q, tip: mod })
        .then((r) => { if (nr === cerereRef.current) setRez(r); })
        .catch(() => { if (nr === cerereRef.current) setRez({ items: [], total: 0, tip: mod, q }); })
        .finally(() => { if (nr === cerereRef.current) setCaut(false); });
    }, 300);
    return () => clearTimeout(t);
  }, [formOpen, opt, mod, filtru]);

  function bifeaza(x) {
    const id = typeof x === 'string' ? x : x.id;
    setF((s) => ({
      ...s,
      contentIds: s.contentIds.includes(id) ? s.contentIds.filter((y) => y !== id) : [...s.contentIds, id],
    }));
    setAlese((a) => {
      if (a[id]) { const { [id]: _sters, ...rest } = a; return rest; }
      return typeof x === 'string' ? a : { ...a, [id]: x };
    });
  }

  async function inscrieMa(id) {
    setBusy(true); setErr(null);
    try { await aiClient.turneu({ action: 'join', id }); await load(); }
    catch (e) { setErr(e?.message || 'Înscrierea nu a reușit.'); }
    finally { setBusy(false); }
  }

  async function creeaza() {
    if (f.scope !== 'public' && !f.groupId) { setErr('Alege grupa.'); return; }
    if (!f.contentIds.length) { setErr('Alege cel puțin un material.'); return; }
    setBusy(true); setErr(null);
    try {
      await aiClient.turneu({ action: 'create', ...f, title: f.title || 'Turneu' });
      setFormOpen(false);
      setF({ groupId: '', title: '', message: '', zile: 7, contentIds: [], scope: 'grupa' });
      setAlese({}); setFiltru(''); setRez(null);
      await load();
    } catch (e) { setErr(e?.message || 'Turneul nu s-a putut crea.'); }
    finally { setBusy(false); }
  }

  async function incheie(id) {
    setBusy(true);
    try { await aiClient.turneu({ action: 'close', id }); await load(); }
    catch (e) { setErr(e?.message || 'Nu am putut încheia turneul.'); }
    finally { setBusy(false); }
  }

  // Dacă încărcarea a eșuat, arătăm eroarea — altfel panoul dispărea din
  // pagină fără nicio explicație.
  if (!d) {
    return err ? (
      <div style={{ ...card, borderColor: 'var(--danger)' }}>
        <div style={{ fontFamily: 'var(--font-display)', fontSize: '1.25rem', marginBottom: 6 }}>🏆 Turnee</div>
        <div style={{ color: 'var(--danger)', fontSize: '0.88rem' }}>{err}</div>
      </div>
    ) : null;
  }

  return (
    <div style={card}>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10, marginBottom: 12 }}>
        <div style={{ fontFamily: 'var(--font-display)', fontSize: '1.25rem' }}>🏆 Turnee</div>
        {(d.profesor || d.admin) && (
          <button onClick={deschideForm} className="btn btn-sm btn-primary" style={{ marginLeft: 'auto' }}>
            {formOpen ? 'Renunță' : '➕ Turneu nou'}
          </button>
        )}
      </div>

      {err && <div style={{ color: 'var(--danger)', fontSize: '0.85rem', marginBottom: 10 }}>{err}</div>}

      {formOpen && opt && (
        <div style={{ background: 'var(--cream)', borderRadius: 10, padding: 14, marginBottom: 14, display: 'grid', gap: 10 }}>
          {!opt.grupe.length && !opt.admin ? (
            <span style={{ color: 'var(--text-light)', fontSize: '0.9rem' }}>
              Nu ai nicio grupă. Creează una din „Contul meu" → Rezultate elevi și apoi poți deschide turnee.
            </span>
          ) : (
            <>
              {opt.admin && (
                <label style={{ fontSize: '0.85rem', fontWeight: 700 }}>Tipul turneului
                  <select value={f.scope} onChange={(e) => setF({ ...f, scope: e.target.value })} style={input}>
                    <option value="grupa">Pe grupă — participă automat membrii grupei</option>
                    <option value="public">Public — oricine de pe site, prin înscriere</option>
                  </select>
                </label>
              )}
              {f.scope !== 'public' && (
                <label style={{ fontSize: '0.85rem', fontWeight: 700 }}>Grupa
                  <select value={f.groupId} onChange={(e) => setF({ ...f, groupId: e.target.value })} style={input}>
                    <option value="">— alege grupa —</option>
                    {opt.grupe.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
                  </select>
                </label>
              )}
              <label style={{ fontSize: '0.85rem', fontWeight: 700 }}>Titlu
                <input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })}
                  placeholder="Turneu – Fracții" style={input} />
              </label>
              <label style={{ fontSize: '0.85rem', fontWeight: 700 }}>Mesaj pentru elevi (opțional)
                <input value={f.message} onChange={(e) => setF({ ...f, message: e.target.value })}
                  placeholder="Cine ia primul 10/10?" style={input} />
              </label>
              <label style={{ fontSize: '0.85rem', fontWeight: 700 }}>Durata (zile)
                <input type="number" min="1" max={opt.maxZile} value={f.zile}
                  onChange={(e) => setF({ ...f, zile: e.target.value })} style={{ ...input, maxWidth: 120 }} />
              </label>

              <div>
                <div style={{ fontSize: '0.85rem', fontWeight: 700, marginBottom: 6 }}>
                  Materiale ({f.contentIds.length}/{opt.maxExercitii})
                </div>

                {/* DOUĂ MODURI DE CĂUTARE: teste interactive și PDF-uri */}
                <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
                  {[
                    { id: 'interactive', et: '🧩 Teste interactive' },
                    { id: 'pdf', et: '📄 PDF-uri' },
                  ].map((m) => (
                    <button key={m.id} type="button" onClick={() => { setMod(m.id); setRez(null); }}
                      style={{
                        flex: 1, padding: '7px 10px', borderRadius: 999, cursor: 'pointer',
                        fontSize: '0.82rem', fontWeight: 700,
                        border: `1px solid ${mod === m.id ? 'var(--gold)' : 'var(--border)'}`,
                        background: mod === m.id ? 'rgba(232,185,49,0.18)' : '#fff',
                        color: mod === m.id ? 'var(--navy)' : 'var(--text-light)',
                      }}>
                      {m.et}
                      {opt.total && opt.total[m.id] ? (
                        <span style={{ fontWeight: 500, opacity: 0.7 }}> · {opt.total[m.id]}</span>
                      ) : null}
                    </button>
                  ))}
                </div>

                <input value={filtru} onChange={(e) => setFiltru(e.target.value)}
                  placeholder={mod === 'pdf'
                    ? 'caută un PDF după titlu sau clasă (ex. 2026, bacalaureat)…'
                    : 'caută un test interactiv după titlu sau clasă (ex. fracții, clasa-7)…'}
                  style={input} />

                {/* materialele deja bifate — rămân la vedere și după ce schimbi
                    modul sau căutarea (poți amesteca interactive cu PDF-uri) */}
                {!!f.contentIds.length && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
                    {f.contentIds.map((id) => {
                      const x = alese[id];
                      return (
                        <button key={id} type="button" onClick={() => bifeaza(id)}
                          title="scoate din turneu"
                          style={{
                            display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer',
                            border: '1px solid var(--border)', background: 'rgba(232,185,49,0.16)',
                            borderRadius: 999, padding: '4px 10px', fontSize: '0.78rem', maxWidth: '100%',
                          }}>
                          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 240 }}>
                            {x ? `${x.tip === 'pdf' ? '📄' : '🧩'} ${x.titlu}` : 'material ales'}
                          </span>
                          <span style={{ color: 'var(--text-muted)', fontWeight: 700 }}>✕</span>
                        </button>
                      );
                    })}
                  </div>
                )}

                <div style={{ maxHeight: 230, overflowY: 'auto', marginTop: 8, border: '1px solid var(--border)', borderRadius: 8, background: '#fff' }}>
                  {(rez?.items || []).map((x) => {
                    const bifat = f.contentIds.includes(x.id);
                    const plin = !bifat && f.contentIds.length >= opt.maxExercitii;
                    return (
                      <label key={x.id} style={{
                        display: 'flex', gap: 8, alignItems: 'center', padding: '6px 10px',
                        fontSize: '0.86rem', cursor: plin ? 'not-allowed' : 'pointer', opacity: plin ? 0.5 : 1,
                        background: bifat ? 'rgba(232,185,49,0.10)' : 'transparent',
                      }}>
                        <input type="checkbox" checked={bifat} disabled={plin} onChange={() => bifeaza(x)} />
                        <span>{x.tip === 'pdf' ? '📄' : '🧩'} {x.titlu}</span>
                        <span style={{ marginLeft: 'auto', color: 'var(--text-muted)', fontSize: '0.75rem' }}>
                          {x.categorie}{x.gratuit ? '' : ' · premium'}
                        </span>
                      </label>
                    );
                  })}
                  {caut && !rez && <div style={{ padding: 10, color: 'var(--text-muted)', fontSize: '0.85rem' }}>Se caută…</div>}
                  {rez && !rez.items.length && (
                    <div style={{ padding: 10, color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                      {filtru.trim()
                        ? `Niciun rezultat pentru „${filtru.trim()}" în ${mod === 'pdf' ? 'PDF-uri' : 'testele interactive'}. Încearcă alt cuvânt sau schimbă modul de căutare.`
                        : 'Nu există materiale de acest tip.'}
                    </div>
                  )}
                </div>

                <div style={{ fontSize: '0.76rem', color: 'var(--text-muted)', marginTop: 4 }}>
                  {caut ? 'se caută…' : rez
                    ? `${rez.items.length} ${rez.items.length === 1 ? 'rezultat' : 'rezultate'}`
                      + (rez.total ? ` din ${rez.total} ${mod === 'pdf' ? 'PDF-uri' : 'teste interactive'} de pe site` : '')
                      + (rez.limita && rez.items.length >= rez.limita ? ' · scrie mai multe litere ca să restrângi lista' : '')
                    : ''}
                </div>
              </div>

              <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                Elevii nu se înscriu: rezolvă exercițiile normal, iar punctajul intră singur. Prima rezolvare contează.
                Punctele = corecte × dificultate × precizie. La final, locurile 1-3 primesc {opt.premii.join(' / ')} XP.
              </div>
              <button onClick={creeaza} disabled={busy} className="btn btn-sm btn-primary" style={{ justifySelf: 'start' }}>
                Deschide turneul
              </button>
            </>
          )}
        </div>
      )}

      {!d.turnee.length && (
        <div style={{ color: 'var(--text-light)', fontSize: '0.9rem' }}>
          {d.profesor
            ? 'Niciun turneu deocamdată. Deschide unul pentru o grupă — durează un minut.'
            : 'Niciun turneu deocamdată. Turneul public al săptămânii apare aici automat, iar profesorul poate deschide unul pe grupă.'}
        </div>
      )}

      {d.turnee.map((t) => (
        <div key={t.id} style={{ border: '1px solid var(--border)', borderRadius: 10, padding: 12, marginBottom: 10 }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', gap: 8 }}>
            <strong style={{ fontSize: '1.02rem' }}>{t.titlu}</strong>
            {t.public
              ? <span style={{ fontSize: '0.7rem', fontWeight: 800, letterSpacing: '.04em', color: 'var(--navy)', background: 'rgba(232,185,49,0.22)', borderRadius: 999, padding: '2px 8px' }}>PUBLIC</span>
              : <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{t.grupa}</span>}
            {t.public && (
              <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                {t.participanti} {t.participanti === 1 ? 'înscris' : 'înscriși'}
              </span>
            )}
            <span style={{ marginLeft: 'auto', fontSize: '0.8rem', color: t.activ ? 'var(--success)' : 'var(--text-muted)' }}>
              {t.activ ? ramase(t.seIncheie) : 'încheiat'}
            </span>
          </div>
          {t.mesaj && <div style={{ fontSize: '0.88rem', color: 'var(--text-light)', marginTop: 4 }}>„{t.mesaj}"</div>}

          {t.activ && t.public && !t.inscris && (
            <div style={{ marginTop: 10, display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10 }}>
              <button onClick={() => inscrieMa(t.id)} disabled={busy} className="btn btn-sm btn-primary">
                Înscrie-mă
              </button>
              <span style={{ fontSize: '0.82rem', color: 'var(--text-light)' }}>
                Punctajul intră în clasament doar după înscriere.
              </span>
            </div>
          )}

          {t.activ && t.exercitii.length > 0 && (!t.public || t.inscris) && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
              {t.exercitii.map((x) => (
                <Link key={x.id} to={`${x.tip === 'pdf' ? '/pdf-viewer' : '/exercitiu'}?id=${x.id}`}
                  className="btn btn-sm btn-outline" style={{ fontSize: '0.78rem' }}>
                  {x.tip === 'pdf' ? '📄 ' : ''}{x.titlu}
                </Link>
              ))}
            </div>
          )}

          <div style={{ marginTop: 10, display: 'grid', gap: 2 }}>
            {t.clasament.slice(0, 8).map((r) => (
              <div key={r.loc} style={{
                display: 'grid', gridTemplateColumns: '30px 1fr auto auto', gap: 10, alignItems: 'center',
                padding: '5px 8px', borderRadius: 6,
                background: r.eu ? 'rgba(232,185,49,0.16)' : 'transparent',
                fontWeight: r.eu ? 700 : 400, fontSize: '0.88rem',
              }}>
                <span style={{ color: 'var(--text-muted)' }}>{r.loc <= 3 ? ['🥇', '🥈', '🥉'][r.loc - 1] : r.loc}</span>
                <span>{r.nume}</span>
                <span style={{ color: 'var(--text-muted)', fontSize: '0.78rem' }}>{r.exercitii} ex · {r.medie}%</span>
                <span>{r.puncte}</span>
              </div>
            ))}
            {!t.clasament.length && <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>Încă niciun rezultat.</span>}
          </div>

          {t.alMeu && t.activ && (
            <button onClick={() => incheie(t.id)} disabled={busy} className="btn btn-sm btn-outline" style={{ marginTop: 10, fontSize: '0.78rem' }}>
              Încheie acum
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
