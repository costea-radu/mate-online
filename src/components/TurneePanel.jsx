// =====================================================================
// src/components/TurneePanel.jsx — turneele de grupă din Arena (pasul 4)
// Elevul vede turneele grupelor lui + clasamentul; profesorul poate deschide
// unul nou pe grupele lui. ADMINUL poate, în plus, edita orice turneu
// (inclusiv cele publice) — titlu, mesaj, durată, adăugarea/scoaterea de
// exerciții — și îl poate șterge. API: /api/turneu
// =====================================================================
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { aiClient } from '../lib/aiClient';

const card = {
  background: 'var(--white)', border: '1px solid var(--border)',
  borderRadius: 'var(--radius-lg)', padding: '18px 20px', boxShadow: 'var(--shadow-sm)',
};
const input = { display: 'block', width: '100%', marginTop: 4, padding: '8px 10px', borderRadius: 8, border: '1px solid var(--border)' };

const GOL = { id: null, groupId: '', title: '', message: '', zile: 7, contentIds: [], scope: 'grupa' };

function ramase(pana) {
  const ore = Math.round((new Date(pana) - Date.now()) / 3600000);
  if (ore <= 0) return 's-a încheiat';
  if (ore < 24) return `${ore} h rămase`;
  return `${Math.round(ore / 24)} zile rămase`;
}

// „fractii" trebuie să găsească „Fracții": comparăm fără diacritice.
function faraDiacritice(s) {
  return String(s || '').toLowerCase()
    .replace(/[ăâ]/g, 'a').replace(/î/g, 'i').replace(/[șş]/g, 's').replace(/[țţ]/g, 't')
    .replace(/\s+/g, ' ').trim();
}

export default function TurneePanel() {
  const [d, setD] = useState(null);
  const [opt, setOpt] = useState(null);
  const [formOpen, setFormOpen] = useState(false);
  const [f, setF] = useState(GOL);
  // Căutarea materialelor are DOUĂ MODURI: teste interactive și PDF-uri.
  // Listele vin ÎNTREGI de pe server (toate materialele site-ului, fără
  // bareme), deci filtrarea de mai jos e instantanee.
  const [mod, setMod] = useState('interactive');
  const [filtru, setFiltru] = useState('');
  const [alese, setAlese] = useState({});        // id → material bifat (rămâne vizibil între căutări)
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [deSters, setDeSters] = useState(null);  // id-ul turneului la care s-a cerut confirmarea

  const load = useCallback(async () => {
    try { setD(await aiClient.turneu({ action: 'list' })); }
    catch (e) { setErr(e?.message || 'Nu am putut încărca turneele.'); }
  }, []);
  useEffect(() => { load(); }, [load]);

  async function incarcaOptiuni() {
    if (opt) return opt;
    try {
      const o = await aiClient.turneu({ action: 'optiuni' });
      setOpt(o);
      return o;
    } catch (e) { setErr(e?.message || 'Nu am putut încărca grupele.'); return null; }
  }

  // Formularul: gol pentru un turneu nou, precompletat când se editează unul.
  async function deschideForm(t = null) {
    setErr(null);
    if (formOpen && (!t || t.id === f.id)) { setFormOpen(false); setF(GOL); setAlese({}); return; }
    setFormOpen(true);
    setFiltru('');
    if (t) {
      setF({
        id: t.id,
        groupId: '',
        title: t.titlu || '',
        message: t.mesaj || '',
        zile: t.zile || 7,
        contentIds: (t.exercitii || []).map((x) => x.id),
        scope: t.public ? 'public' : 'grupa',
      });
      setAlese(Object.fromEntries((t.exercitii || []).map((x) => [x.id, x])));
    } else {
      setF(GOL);
      setAlese({});
    }
    await incarcaOptiuni();
  }

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

  // Același buton salvează și un turneu nou, și modificările la unul existent.
  async function salveaza() {
    if (!f.id && f.scope !== 'public' && !f.groupId) { setErr('Alege grupa.'); return; }
    if (!f.contentIds.length) { setErr('Alege cel puțin un material.'); return; }
    setBusy(true); setErr(null);
    try {
      if (f.id) {
        await aiClient.turneu({
          action: 'update', id: f.id, title: f.title, message: f.message, zile: f.zile, contentIds: f.contentIds,
        });
      } else {
        await aiClient.turneu({ action: 'create', ...f, title: f.title || 'Turneu' });
      }
      setFormOpen(false);
      setF(GOL); setAlese({}); setFiltru('');
      await load();
    } catch (e) { setErr(e?.message || 'Turneul nu s-a putut salva.'); }
    finally { setBusy(false); }
  }

  async function incheie(id) {
    setBusy(true);
    try { await aiClient.turneu({ action: 'close', id }); await load(); }
    catch (e) { setErr(e?.message || 'Nu am putut încheia turneul.'); }
    finally { setBusy(false); }
  }

  async function sterge(id) {
    setBusy(true); setErr(null);
    try {
      await aiClient.turneu({ action: 'delete', id });
      setDeSters(null);
      if (f.id === id) { setFormOpen(false); setF(GOL); setAlese({}); }
      await load();
    } catch (e) { setErr(e?.message || 'Turneul nu s-a putut șterge.'); }
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

  const lista = (opt?.materiale?.[mod]) || [];
  const q = faraDiacritice(filtru);
  const gasite = q ? lista.filter((x) => faraDiacritice(`${x.titlu} ${x.categorie}`).includes(q)) : lista;

  return (
    <div style={card}>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10, marginBottom: 12 }}>
        <div style={{ fontFamily: 'var(--font-display)', fontSize: '1.25rem' }}>🏆 Turnee</div>
        {(d.profesor || d.admin) && (
          <button onClick={() => deschideForm(null)} className="btn btn-sm btn-primary" style={{ marginLeft: 'auto' }}>
            {formOpen && !f.id ? 'Renunță' : '➕ Turneu nou'}
          </button>
        )}
      </div>

      {err && <div style={{ color: 'var(--danger)', fontSize: '0.85rem', marginBottom: 10 }}>{err}</div>}

      {formOpen && opt && (
        <div style={{ background: 'var(--cream)', borderRadius: 10, padding: 14, marginBottom: 14, display: 'grid', gap: 10 }}>
          {!opt.grupe.length && !opt.admin && !f.id ? (
            <span style={{ color: 'var(--text-light)', fontSize: '0.9rem' }}>
              Nu ai nicio grupă. Creează una din „Contul meu" → Rezultate elevi și apoi poți deschide turnee.
            </span>
          ) : (
            <>
              {f.id && (
                <div style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--navy)' }}>
                  ✏️ Editezi „{f.title}"{f.scope === 'public' ? ' · turneu public' : ''}
                </div>
              )}

              {/* tipul și grupa se aleg doar la CREARE — nu se mai schimbă după */}
              {!f.id && opt.admin && (
                <label style={{ fontSize: '0.85rem', fontWeight: 700 }}>Tipul turneului
                  <select value={f.scope} onChange={(e) => setF({ ...f, scope: e.target.value })} style={input}>
                    <option value="grupa">Pe grupă — participă automat membrii grupei</option>
                    <option value="public">Public — oricine de pe site, prin înscriere</option>
                  </select>
                </label>
              )}
              {!f.id && f.scope !== 'public' && (
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
                {f.id && (
                  <span style={{ fontWeight: 400, fontSize: '0.76rem', color: 'var(--text-muted)', display: 'block', marginTop: 2 }}>
                    se numără de la deschiderea turneului
                  </span>
                )}
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
                    <button key={m.id} type="button" onClick={() => { setMod(m.id); setFiltru(''); }}
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
                  {gasite.slice(0, 400).map((x) => {
                    const bifat = f.contentIds.includes(x.id);
                    const plin = !bifat && f.contentIds.length >= opt.maxExercitii;
                    return (
                      <label key={x.id} style={{
                        display: 'flex', gap: 8, alignItems: 'center', padding: '6px 10px',
                        fontSize: '0.86rem', cursor: plin ? 'not-allowed' : 'pointer', opacity: plin ? 0.5 : 1,
                        background: bifat ? 'rgba(232,185,49,0.10)' : 'transparent',
                      }}>
                        <input type="checkbox" checked={bifat} disabled={plin} onChange={() => bifeaza(x)} />
                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {x.tip === 'pdf' ? '📄' : '🧩'} {x.titlu}
                        </span>
                        <span style={{ marginLeft: 'auto', color: 'var(--text-muted)', fontSize: '0.75rem', flexShrink: 0 }}>
                          {x.categorie}{x.gratuit ? '' : ' · premium'}
                        </span>
                      </label>
                    );
                  })}
                  {!gasite.length && (
                    <div style={{ padding: 10, color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                      {filtru.trim()
                        ? `Niciun rezultat pentru „${filtru.trim()}" în ${mod === 'pdf' ? 'PDF-uri' : 'testele interactive'}. Încearcă alt cuvânt sau schimbă modul de căutare.`
                        : 'Nu există materiale de acest tip.'}
                    </div>
                  )}
                </div>

                <div style={{ fontSize: '0.76rem', color: 'var(--text-muted)', marginTop: 4 }}>
                  {gasite.length} {gasite.length === 1 ? 'rezultat' : 'rezultate'}
                  {lista.length ? ` din ${lista.length} ${mod === 'pdf' ? 'PDF-uri' : 'teste interactive'} de pe site` : ''}
                  {gasite.length > 400 ? ' · scrie mai multe litere ca să restrângi lista' : ''}
                </div>
              </div>

              <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                Elevii nu se înscriu: rezolvă exercițiile normal, iar punctajul intră singur. Prima rezolvare contează.
                Punctele = corecte × dificultate × precizie. La final, locurile 1-3 primesc {opt.premii.join(' / ')} XP.
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button onClick={salveaza} disabled={busy} className="btn btn-sm btn-primary">
                  {f.id ? 'Salvează modificările' : 'Deschide turneul'}
                </button>
                {f.id && (
                  <button onClick={() => { setFormOpen(false); setF(GOL); setAlese({}); }} disabled={busy} className="btn btn-sm btn-outline">
                    Renunță
                  </button>
                )}
              </div>
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

      {d.turnee.map((t) => {
        // adminul poate lucra pe ORICE turneu (inclusiv cele publice, create de
        // cron); profesorul, doar pe ale lui
        const poateEdita = d.admin || t.alMeu;
        return (
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

            {t.exercitii.length > 0 && (t.activ && (!t.public || t.inscris || poateEdita)) && (
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

            {poateEdita && (
              <div style={{ marginTop: 10, display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
                <button onClick={() => deschideForm(t)} disabled={busy} className="btn btn-sm btn-outline" style={{ fontSize: '0.78rem' }}>
                  ✏️ Editează
                </button>
                {t.activ && (
                  <button onClick={() => incheie(t.id)} disabled={busy} className="btn btn-sm btn-outline" style={{ fontSize: '0.78rem' }}>
                    Încheie acum
                  </button>
                )}
                {d.admin && (deSters === t.id ? (
                  <>
                    <span style={{ fontSize: '0.78rem', color: 'var(--danger)' }}>
                      Ștergi turneul cu tot cu clasament?
                    </span>
                    <button onClick={() => sterge(t.id)} disabled={busy} className="btn btn-sm"
                      style={{ fontSize: '0.78rem', background: 'var(--danger)', color: '#fff' }}>
                      Da, șterge
                    </button>
                    <button onClick={() => setDeSters(null)} disabled={busy} className="btn btn-sm btn-outline" style={{ fontSize: '0.78rem' }}>
                      Nu
                    </button>
                  </>
                ) : (
                  <button onClick={() => setDeSters(t.id)} disabled={busy} className="btn btn-sm btn-outline"
                    style={{ fontSize: '0.78rem', color: 'var(--danger)', borderColor: 'var(--danger)' }}>
                    🗑 Șterge
                  </button>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
