// =====================================================================
// src/components/ArenaFeed.jsx — „📣 Ce se întâmplă în Arenă" (8 nov. 2026)
//
// Cererea: „în arena să apară ca pe Facebook cine a rezolvat, a promovat, ce
// subiect, ce provocări noi apar, etc., notele să nu apară dacă sunt probleme cu
// politica de confidențialitate".
//
// Fluxul vine din /api/gamificare → action 'arena_feed' (api/_lib/arenaFeed.js):
// prenumele și inițiala („Ana P."), CE a făcut (testul zilei și subiectul,
// promovarea, seria, insigna, duelul, turneul) și anunțurile Arenei (turneu nou,
// provocarea bonus de azi) — NICIODATĂ note sau punctaje. Elevul poate alege să
// nu apară („Nu mă arăta în activitate" → action 'arena_public').
// =====================================================================
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { aiClient } from '../lib/aiClient';
import { onArenaChange } from '../lib/arena';
import { useAuth } from '../context/AuthContext';

const PAGINA = 6;   // câte rânduri la început (restul: „Mai vechi")

const card = {
  background: 'var(--white)', border: '1px solid var(--border)',
  borderRadius: 'var(--radius-lg)', padding: '18px 20px', boxShadow: 'var(--shadow-sm)',
};

// „acum 5 min", „acum 2 h", „ieri", „3 nov."
export function cand(iso, now = Date.now()) {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '';
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 60) return 'acum';
  const m = Math.round(s / 60);
  if (m < 60) return `acum ${m} min`;
  const h = Math.round(m / 60);
  if (h < 24) return `acum ${h} h`;
  const zile = Math.round(h / 24);
  if (zile === 1) return 'ieri';
  if (zile < 7) return `acum ${zile} zile`;
  try { return new Date(t).toLocaleDateString('ro-RO', { day: 'numeric', month: 'short' }); } catch { return ''; }
}

// inițiala într-un cerc colorat (fără poze: doar prenumele și inițiala sunt publice)
const CULORI = ['#e8b931', '#5c8dc4', '#7c5cbf', '#2e9d6b', '#e07a5f', '#3d9fb0', '#c75d8f'];
function Avatar({ nume, anunt, icon }) {
  if (anunt) {
    return <span aria-hidden style={{ width: 38, height: 38, borderRadius: '50%', background: 'var(--navy)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.15rem', flexShrink: 0 }}>{icon}</span>;
  }
  const n = String(nume || '?');
  let h = 0; for (const ch of n) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return (
    <span aria-hidden style={{ position: 'relative', width: 38, height: 38, borderRadius: '50%', background: CULORI[h % CULORI.length], color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: '.95rem', flexShrink: 0 }}>
      {n === 'Tu' ? '★' : n.charAt(0).toUpperCase()}
      <span style={{ position: 'absolute', right: -4, bottom: -4, fontSize: '.85rem', background: '#fff', borderRadius: '50%', width: 20, height: 20, display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 0 0 1px var(--border)' }}>{icon}</span>
    </span>
  );
}

export default function ArenaFeed() {
  const { isAdmin } = useAuth();
  const [items, setItems] = useState(null);
  const [maiMulte, setMaiMulte] = useState(false);
  const [inainte, setInainte] = useState(null);
  const [pub, setPub] = useState(null);           // { setup, public }
  const [setup, setSetup] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  const load = useCallback(async () => {
    try {
      const r = await aiClient.gamificare({ action: 'arena_feed', limit: PAGINA });
      const f = r?.feed || {};
      setSetup(f.setup !== false || (f.items || []).length > 0);
      setItems(f.items || []);
      setMaiMulte(!!f.maiMulte);
      setInainte(f.inainte || null);
      if (r?.public) setPub(r.public);
      setErr(null);
    } catch (e) { setErr(e?.message || 'Nu am putut încărca activitatea.'); setItems((x) => x || []); }
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => onArenaChange(() => load()), [load]);
  // fluxul se reîmprospătează singur la revenirea în tab și din 2 în 2 minute
  useEffect(() => {
    const reia = () => { if (document.visibilityState === 'visible') load(); };
    document.addEventListener('visibilitychange', reia);
    const t = setInterval(reia, 120000);
    return () => { document.removeEventListener('visibilitychange', reia); clearInterval(t); };
  }, [load]);

  async function incarcaMaiMulte() {
    if (!inainte || busy) return;
    setBusy(true);
    try {
      const r = await aiClient.gamificare({ action: 'arena_feed', inainte, limit: 10 });
      const f = r?.feed || {};
      setItems((x) => [...(x || []), ...(f.items || []).filter((it) => !(x || []).some((y) => y.id === it.id))]);
      setMaiMulte(!!f.maiMulte);
      setInainte(f.inainte || null);
    } catch { /* data viitoare */ }
    finally { setBusy(false); }
  }

  async function comutaPublic() {
    if (!pub || busy) return;
    setBusy(true);
    try {
      const r = await aiClient.gamificare({ action: 'arena_public', on: !pub.public });
      setPub((p) => ({ ...(p || {}), public: !!r?.public }));
    } catch (e) { setErr(e?.message || 'Nu am putut salva alegerea.'); }
    finally { setBusy(false); }
  }

  if (!setup && !isAdmin) return null;   // fără migrare: elevii nu văd un card gol

  return (
    <div style={card}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontSize: '0.72rem', letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--text-muted)', fontWeight: 700 }}>Activitate</div>
          <div style={{ fontFamily: 'var(--font-display)', fontSize: '1.3rem', color: 'var(--navy)' }}>📣 Ce se întâmplă în Arenă</div>
        </div>
        <Link to="/pregateste-ma" className="btn btn-sm btn-outline">🎯 Testul meu de azi</Link>
      </div>

      {!setup && isAdmin && (
        <div style={{ fontSize: '.82rem', color: 'var(--danger)', marginTop: 8 }}>
          Fluxul nu e activ: rulează <code>supabase/pregatire_zilnica.sql</code> în Supabase.
        </div>
      )}
      {err && <div style={{ fontSize: '.84rem', color: 'var(--danger)', marginTop: 8 }}>{err}</div>}

      <div style={{ display: 'grid', gap: 2, marginTop: 12 }}>
        {items === null && <div style={{ color: 'var(--text-light)', fontSize: '.9rem' }}>Se încarcă activitatea…</div>}
        {items && items.length === 0 && (
          <div style={{ color: 'var(--text-light)', fontSize: '.9rem', padding: '6px 0' }}>
            Încă e liniște. Rezolvă testul zilei și apari primul aici! 🎯
          </div>
        )}
        {(items || []).map((it) => (
          <div key={it.id} style={{
            display: 'flex', alignItems: 'center', gap: 12, padding: '10px 8px', borderRadius: 12,
            background: it.eu ? 'rgba(232,185,49,0.12)' : it.anunt ? 'rgba(15,43,68,0.04)' : 'transparent',
            borderBottom: '1px solid var(--cream-dark)',
          }}>
            <Avatar nume={it.nume} anunt={it.anunt} icon={it.icon} />
            <div style={{ flex: 1, minWidth: 0, fontSize: '.92rem', lineHeight: 1.45, color: 'var(--text)' }}>
              {it.anunt ? <strong style={{ color: 'var(--navy)' }}>{it.text}</strong>
                : <><strong style={{ color: 'var(--navy)' }}>{it.nume}</strong> {it.text}</>}
              <div style={{ fontSize: '.74rem', color: 'var(--text-muted)' }}>{cand(it.cand)}</div>
            </div>
            {it.link && it.kind === 'test' && !it.eu && (
              <Link to="/pregateste-ma" style={{ fontSize: '.78rem', fontWeight: 700, color: 'var(--navy)', whiteSpace: 'nowrap' }}>Și eu →</Link>
            )}
          </div>
        ))}
      </div>

      {maiMulte && (
        <div style={{ textAlign: 'center', marginTop: 10 }}>
          <button type="button" className="btn btn-sm btn-outline" disabled={busy} onClick={incarcaMaiMulte}>
            {busy ? 'Se încarcă…' : 'Mai vechi'}
          </button>
        </div>
      )}

      {/* confidențialitatea: ce se vede și cum ieși din flux */}
      <div style={{ marginTop: 12, paddingTop: 10, borderTop: '1px dashed var(--border)', fontSize: '.76rem', color: 'var(--text-muted)', lineHeight: 1.55, display: 'flex', gap: 10, alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap' }}>
        <span>🔒 Aici apar doar prenumele și inițiala și ce s-a lucrat — <strong>niciodată note sau punctaje</strong>.</span>
        {pub && pub.setup !== false && (
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, cursor: busy ? 'progress' : 'pointer', fontWeight: 600, color: 'var(--navy)' }}>
            <input type="checkbox" checked={pub.public !== false} disabled={busy} onChange={comutaPublic} />
            Apar în activitatea Arenei
          </label>
        )}
      </div>
    </div>
  );
}
