// =====================================================================
// src/components/TurneePanel.jsx — turneele de grupă din Arena (pasul 4)
// Elevul vede turneele grupelor lui + clasamentul; profesorul poate deschide
// unul nou pe grupele lui. API: /api/turneu
// =====================================================================
import { useCallback, useEffect, useState } from 'react';
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
  const [f, setF] = useState({ groupId: '', title: '', message: '', zile: 7, contentIds: [] });
  const [filtru, setFiltru] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

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

  function bifeaza(id) {
    setF((s) => ({
      ...s,
      contentIds: s.contentIds.includes(id) ? s.contentIds.filter((x) => x !== id) : [...s.contentIds, id],
    }));
  }

  async function creeaza() {
    if (!f.groupId || !f.contentIds.length) { setErr('Alege grupa și cel puțin un exercițiu.'); return; }
    setBusy(true); setErr(null);
    try {
      await aiClient.turneu({ action: 'create', ...f, title: f.title || 'Turneu' });
      setFormOpen(false);
      setF({ groupId: '', title: '', message: '', zile: 7, contentIds: [] });
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
  const filtrate = (opt?.exercitii || []).filter((x) => !filtru || x.titlu.toLowerCase().includes(filtru.toLowerCase()));

  return (
    <div style={card}>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10, marginBottom: 12 }}>
        <div style={{ fontFamily: 'var(--font-display)', fontSize: '1.25rem' }}>🏆 Turnee</div>
        {d.profesor && (
          <button onClick={deschideForm} className="btn btn-sm btn-primary" style={{ marginLeft: 'auto' }}>
            {formOpen ? 'Renunță' : '➕ Turneu nou'}
          </button>
        )}
      </div>

      {err && <div style={{ color: 'var(--danger)', fontSize: '0.85rem', marginBottom: 10 }}>{err}</div>}

      {formOpen && opt && (
        <div style={{ background: 'var(--cream)', borderRadius: 10, padding: 14, marginBottom: 14, display: 'grid', gap: 10 }}>
          {!opt.grupe.length ? (
            <span style={{ color: 'var(--text-light)', fontSize: '0.9rem' }}>
              Nu ai nicio grupă. Creează una din „Contul meu" → Rezultate elevi și apoi poți deschide turnee.
            </span>
          ) : (
            <>
              <label style={{ fontSize: '0.85rem', fontWeight: 700 }}>Grupa
                <select value={f.groupId} onChange={(e) => setF({ ...f, groupId: e.target.value })} style={input}>
                  <option value="">— alege grupa —</option>
                  {opt.grupe.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
                </select>
              </label>
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
                <div style={{ fontSize: '0.85rem', fontWeight: 700, marginBottom: 4 }}>
                  Exerciții ({f.contentIds.length}/{opt.maxExercitii})
                </div>
                <input value={filtru} onChange={(e) => setFiltru(e.target.value)} placeholder="caută după titlu…" style={input} />
                <div style={{ maxHeight: 200, overflowY: 'auto', marginTop: 6, border: '1px solid var(--border)', borderRadius: 8, background: '#fff' }}>
                  {filtrate.map((x) => (
                    <label key={x.id} style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '6px 10px', fontSize: '0.86rem', cursor: 'pointer' }}>
                      <input type="checkbox" checked={f.contentIds.includes(x.id)} onChange={() => bifeaza(x.id)} />
                      <span>{x.titlu}</span>
                      <span style={{ marginLeft: 'auto', color: 'var(--text-muted)', fontSize: '0.75rem' }}>
                        {x.categorie}{x.gratuit ? '' : ' · premium'}
                      </span>
                    </label>
                  ))}
                  {!filtrate.length && <div style={{ padding: 10, color: 'var(--text-muted)', fontSize: '0.85rem' }}>Niciun exercițiu găsit.</div>}
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
            : 'Niciun turneu în grupele tale deocamdată. Profesorul poate deschide unul.'}
        </div>
      )}

      {d.turnee.map((t) => (
        <div key={t.id} style={{ border: '1px solid var(--border)', borderRadius: 10, padding: 12, marginBottom: 10 }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', gap: 8 }}>
            <strong style={{ fontSize: '1.02rem' }}>{t.titlu}</strong>
            <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{t.grupa}</span>
            <span style={{ marginLeft: 'auto', fontSize: '0.8rem', color: t.activ ? 'var(--success)' : 'var(--text-muted)' }}>
              {t.activ ? ramase(t.seIncheie) : 'încheiat'}
            </span>
          </div>
          {t.mesaj && <div style={{ fontSize: '0.88rem', color: 'var(--text-light)', marginTop: 4 }}>„{t.mesaj}"</div>}

          {t.activ && t.exercitii.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
              {t.exercitii.map((x) => (
                <Link key={x.id} to={`/exercitiu?id=${x.id}`} className="btn btn-sm btn-outline" style={{ fontSize: '0.78rem' }}>
                  {x.titlu}
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
