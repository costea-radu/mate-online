// =====================================================================
// src/components/SitePicker.jsx — „🧩 Teste din site" (chatul de meditații)
//
// Lista testelor din baza de date a site-ului, STRICT pe NIVELUL elevului
// (luat din profilul lui de meditații: EN / BAC cu profilul lui / clasa lui;
// contextul paginii e doar rezervă), în două file:
//   🧩 Interactive — se rezolvă pe ecran și se corectează singure. Aceleași
//      rubrici ca pe paginile site-ului (la BAC „Capitole" e comună tuturor
//      profilurilor, restul se filtrează după profil); se vede și scorul lui
//      la testele deja rezolvate. La meditații, testul ales se înregistrează
//      ca sesiune „din site" (api/ai-meditatii.js → site_test), ca scorul să
//      intre în plan, „Progresul meu" și rapoarte.
//   📄 PDF — pe foaie; se deschide în vizualizator cu ACEEAȘI conversație
//      alături, unde „📝 Răspunde în chat" îl corectează după barem (baremele
//      nu apar în listă — le aduce viewerul, lângă test).
// Căutarea după titlu merge și fără diacritice.
//
// Se încarcă LENEȘ din ChatPanel (AITutor.jsx), la prima deschidere — chatul e
// în pachetul principal al site-ului, lista nu trebuie să-l îngreuneze.
// Props: context ({ meditatii, category }), tab ('interactive' | 'pdf' | null),
//        onClose(), onOpenPdf(id), onOpenInteractive(url)
// =====================================================================
import { useEffect, useRef, useState } from 'react';
import { aiClient } from '../lib/aiClient';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { notaDinScor } from '../lib/nota';
import { PDF_SUBCAT_RO, INTER_SUBCAT_RO, PROFILE_RO, foldRo, levelOf, sortInteractive } from '../lib/siteTests';

const tagStyle = (bg, color) => ({ fontSize: '.66rem', fontWeight: 700, background: bg, color, borderRadius: 12, padding: '2px 8px', whiteSpace: 'nowrap' });
const segStyle = (on) => ({
  border: `1px solid ${on ? 'var(--navy)' : 'var(--border)'}`, background: on ? 'var(--navy)' : '#fff',
  color: on ? '#fff' : 'var(--navy)', borderRadius: 20, padding: '6px 12px', fontSize: '.8rem', fontWeight: 700,
  cursor: 'pointer', whiteSpace: 'nowrap', fontFamily: 'var(--font-body)',
});
const closeBtn = { background: 'none', border: '1px solid var(--border)', borderRadius: 8, padding: '4px 10px', fontSize: '.76rem', color: 'var(--text-light)', fontWeight: 600, cursor: 'pointer' };

export default function SitePicker({ context = {}, tab = null, onClose, onOpenPdf, onOpenInteractive }) {
  const { user } = useAuth();
  const [data, setData] = useState({ loading: true, inter: [], pdf: [], done: {}, label: '', error: null });
  const [curTab, setCurTab] = useState(tab || 'interactive');
  const [filter, setFilter] = useState('');
  const [opening, setOpening] = useState(null);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  // fila cerută din afară (ex. „deschide direct PDF-urile")
  useEffect(() => { if (tab) setCurTab(tab); }, [tab]);

  useEffect(() => {
    (async () => {
      try {
        let profile = null;
        try { profile = (await aiClient.meditatii({ action: 'state' }))?.profile || null; } catch { /* cădem pe contextul paginii */ }
        const lvl = levelOf(profile, context.category || null);
        if (!lvl) throw new Error('Nu îți cunosc încă nivelul — alege întâi clasa și examenul în rubrica Meditații.');
        const { cat, prof, label } = lvl;
        const cols = 'id, title, subcategory, profile, is_free, category';
        const ofType = (type) => supabase.from('content').select(cols)
          .eq('content_type', type).eq('category', cat)
          .order('sort_order', { ascending: true }).order('created_at', { ascending: false })
          .limit(400);
        let qPdf = ofType('pdf');
        if (prof) qPdf = qPdf.eq('profile', prof);
        let qInter = ofType('interactive');
        if (prof) qInter = qInter.or(`profile.eq.${prof},subcategory.eq.capitole`);
        const [rPdf, rInter, rDone] = await Promise.all([
          qPdf, qInter,
          // ce a rezolvat deja (scorul lui) — ca să aleagă și teste noi
          user
            ? supabase.from('progress').select('content_id, score, max_score').eq('user_id', user.id).limit(2000)
            : Promise.resolve({ data: [] }),
        ]);
        if (rPdf.error && rInter.error) throw new Error(rPdf.error.message);
        const pdf = (rPdf.data || []).filter((r) => (r.subcategory || '') !== 'bareme');
        const inter = sortInteractive(rInter.data, cat);
        const done = {};
        (rDone?.data || []).forEach((p) => { if (p && p.max_score > 0) done[p.content_id] = p; });
        if (!alive.current) return;
        setData({
          loading: false, inter, pdf, done, label,
          error: pdf.length || inter.length ? null : `Nu am găsit încă teste pentru ${label || 'nivelul tău'}.`,
        });
        // fila cerută; altfel cea care are teste (întâi interactivele)
        if (!tab) setCurTab(inter.length || !pdf.length ? 'interactive' : 'pdf');
      } catch (e) {
        if (alive.current) setData({ loading: false, inter: [], pdf: [], done: {}, label: '', error: e.message });
      }
    })();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Testul interactiv ales: la meditații îl înregistrăm întâi ca sesiune „din
  // site" (?medSesId=…) — scorul de la „Corectează" intră în plan, „Progresul
  // meu" și rapoarte. Fără înregistrare, testul se deschide oricum.
  async function pickInteractive(r) {
    if (!r || opening) return;
    setOpening(r.id);
    let url = `/exercitiu?id=${r.id}`;
    if (context.meditatii) {
      try {
        const s = await aiClient.meditatii({ action: 'site_test', contentId: r.id });
        if (s?.siteTest?.url) url = s.siteTest.url;
      } catch { /* fără înregistrare: scorul intră oricum în „progres" */ }
    }
    if (!alive.current) return;
    onOpenInteractive?.(url);
  }

  const f = foldRo(filter.trim());
  const match = (r) => !f || foldRo(r.title).includes(f);
  const inter = data.inter.filter(match);
  const pdf = data.pdf.filter(match);
  const isPdf = curTab === 'pdf';
  const list = isPdf ? pdf : inter;
  const other = isPdf ? inter : pdf;

  // pe ecran îngust etichetele coboară sub titlu (flex-wrap), nu îl strâng
  const rowStyle = {
    display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: '6px 8px', width: '100%', textAlign: 'left',
    border: '1px solid var(--border)', background: '#f7f9fc', borderRadius: 8, padding: '9px 11px', marginBottom: 6,
    fontSize: '.85rem', color: 'var(--navy)', fontWeight: 600, cursor: opening ? 'default' : 'pointer',
  };
  const tags = (r, subcatRo) => (
    <span style={{ display: 'inline-flex', gap: 5, flexWrap: 'wrap', justifyContent: 'flex-end', marginLeft: 'auto' }}>
      {r.subcategory && subcatRo[r.subcategory] && (
        <span style={tagStyle('rgba(15,43,68,.08)', 'var(--navy)')}>{subcatRo[r.subcategory]}</span>
      )}
      {r.profile && PROFILE_RO[r.profile] && (
        <span style={tagStyle('rgba(232,185,49,.18)', '#8a6d1a')}>{PROFILE_RO[r.profile]}</span>
      )}
      <span style={tagStyle(r.is_free ? '#e8f5e9' : '#fff3e0', r.is_free ? '#2e7d32' : '#e65100')}>{r.is_free ? 'Gratuit' : 'Premium'}</span>
    </span>
  );
  // scorul lui la un test interactiv deja rezolvat (cel mai bun, din „progres")
  const doneTag = (r) => {
    const p = data.done[r.id];
    if (!p) return null;
    const pct = Math.round((p.score / p.max_score) * 100);
    const nota = notaDinScor(p.score, p.max_score);
    const good = pct >= 80, mid = pct >= 50;
    return (
      <span title={`Rezolvat: ${p.score}/${p.max_score} puncte`}
        style={tagStyle(good ? '#e8f5e9' : mid ? '#fff3e0' : '#fce4ec', good ? '#2e7d32' : mid ? '#e65100' : '#c62828')}>
        ✓ {pct}%{nota != null ? ` · nota ${nota}` : ''}
      </span>
    );
  };

  return (
    <div className="site-pick" style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, background: '#fff', zIndex: 6, display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, padding: '10px 12px', borderBottom: '1px solid var(--border)' }}>
        <strong style={{ color: 'var(--navy)', fontSize: '.9rem' }}>
          🧩 Teste din site{data.label ? ` · ${data.label}` : ''}
        </strong>
        <button type="button" onClick={onClose} style={closeBtn}>✕ Închide</button>
      </div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', padding: '8px 12px', borderBottom: '1px solid var(--border)' }}>
        <div role="tablist" aria-label="Tipul testelor" style={{ display: 'flex', gap: 6 }}>
          <button type="button" role="tab" aria-selected={!isPdf} onClick={() => setCurTab('interactive')} style={segStyle(!isPdf)}>
            🧩 Interactive{data.loading ? '' : ` (${inter.length})`}
          </button>
          <button type="button" role="tab" aria-selected={isPdf} onClick={() => setCurTab('pdf')} style={segStyle(isPdf)}>
            📄 PDF{data.loading ? '' : ` (${pdf.length})`}
          </button>
        </div>
        <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Caută după titlu…"
          aria-label="Caută un test după titlu"
          style={{ flex: '1 1 150px', minWidth: 0, border: '1px solid var(--border)', borderRadius: 8, padding: '7px 10px', fontSize: 16, fontFamily: 'var(--font-body)', boxSizing: 'border-box' }} />
      </div>
      <div style={{ padding: '6px 12px', fontSize: '.76rem', color: 'var(--text-muted)', background: '#fbfcfe', borderBottom: '1px solid var(--border)' }}>
        {isPdf
          ? 'Îl rezolvi pe foaie, apoi îmi trimiți răspunsurile cu „📝 Răspunde în chat" — ți-l corectez după barem, punct cu punct.'
          : `Se rezolvă pe ecran și se corectează singur, pe loc.${context.meditatii ? ' Rezultatul intră în planul tău și în „Progresul meu".' : ''}`}
      </div>
      <div className="site-pick-list" style={{ flex: 1, overflowY: 'auto', overscrollBehavior: 'contain', padding: 12 }}>
        {data.loading && <p style={{ color: 'var(--text-muted)', fontSize: '.85rem' }}>Caut testele din baza de date…</p>}
        {data.error && <p style={{ color: '#8a6d1a', fontSize: '.85rem' }}>{data.error}</p>}
        {!data.loading && !data.error && !list.length && (
          <p style={{ color: 'var(--text-muted)', fontSize: '.85rem' }}>
            {f
              ? `Niciun test ${isPdf ? 'PDF' : 'interactiv'} cu „${filter.trim()}" în titlu.`
              : `Nu am găsit încă teste ${isPdf ? 'PDF' : 'interactive'} pentru ${data.label || 'nivelul tău'}.`}
            {other.length > 0 && (
              <>
                {' '}
                <button type="button" onClick={() => setCurTab(isPdf ? 'interactive' : 'pdf')}
                  style={{ background: 'none', border: 'none', padding: 0, color: 'var(--navy)', fontWeight: 700, textDecoration: 'underline', cursor: 'pointer', fontSize: '.85rem' }}>
                  Vezi {other.length} {isPdf ? (other.length === 1 ? 'test interactiv' : 'teste interactive') : (other.length === 1 ? 'test PDF' : 'teste PDF')} →
                </button>
              </>
            )}
          </p>
        )}
        {!data.loading && list.map((r) => (isPdf ? (
          <button type="button" key={r.id} disabled={!!opening} onClick={() => onOpenPdf?.(r.id)} style={rowStyle}>
            <span style={{ flex: '1 1 190px', minWidth: 0 }}>📄 {r.title}</span>
            {tags(r, PDF_SUBCAT_RO)}
          </button>
        ) : (
          <button type="button" key={r.id} disabled={!!opening} onClick={() => pickInteractive(r)}
            style={{ ...rowStyle, ...(opening === r.id ? { borderColor: 'var(--gold)', background: 'rgba(232,185,49,.1)' } : {}), ...(opening && opening !== r.id ? { opacity: 0.55 } : {}) }}>
            <span style={{ flex: '1 1 190px', minWidth: 0 }}>🧩 {r.title}</span>
            {opening === r.id
              ? <span style={{ fontSize: '.76rem', color: '#8a6d1a', whiteSpace: 'nowrap', marginLeft: 'auto' }}>⏳ Se deschide…</span>
              : <span style={{ display: 'inline-flex', gap: 5, flexWrap: 'wrap', justifyContent: 'flex-end', marginLeft: 'auto' }}>{doneTag(r)}{tags(r, INTER_SUBCAT_RO)}</span>}
          </button>
        )))}
      </div>
    </div>
  );
}
