// =====================================================================
// src/pages/Recenzii.jsx — /recenzii: părerile utilizatorilor despre ExamenMate
//   • media generală (doar recenziile aprobate) + numărul lor
//   • formularul „Părerea ta" (#formular) — o recenzie per cont, editabilă;
//     apare public după aprobare în Admin → ⭐ Recenzii
//   • lista recenziilor aprobate, cele mai noi primele
// Notele per test (★ pe carduri) se lasă din viewerul testului, după rezolvare.
// Datele: src/lib/reviews.js · supabase/reviews_schema.sql
// =====================================================================
import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { fetchSiteStats, formatAvg } from '../lib/reviews';
import { StarPicker, SiteReviewForm, ReviewList } from '../components/ReviewWidget';

export default function Recenzii() {
  const { user } = useAuth();
  const { hash } = useLocation();
  const [stats, setStats] = useState(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => { fetchSiteStats().then(setStats); }, [reloadKey]);

  // /recenzii#formular → derulează la formular (după ScrollToTop din App)
  useEffect(() => {
    if (hash !== '#formular') return;
    const t = setTimeout(() => document.getElementById('formular')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 80);
    return () => clearTimeout(t);
  }, [hash]);

  const card = { background: '#fff', borderRadius: 14, padding: '28px 32px', boxShadow: 'var(--shadow)', marginBottom: 24 };

  return (
    <>
      <div className="page-header">
        <div className="container">
          <div className="breadcrumb">
            <Link to="/">Acasă</Link><span>›</span><span>Recenzii</span>
          </div>
          <h1>Recenzii</h1>
          <p>Ce spun elevii, părinții și profesorii despre ExamenMate.</p>
        </div>
      </div>

      <section className="section">
        <div className="container" style={{ maxWidth: 820 }}>

          {/* Media generală */}
          <div style={{ ...card, display: 'flex', alignItems: 'center', gap: 20, flexWrap: 'wrap' }}>
            <div style={{ fontFamily: 'var(--font-display)', fontSize: '3rem', fontWeight: 800, color: 'var(--navy)', lineHeight: 1 }}>
              {stats && stats.n > 0 ? formatAvg(stats.avg) : '–'}
            </div>
            <div>
              <StarPicker value={stats ? Math.round(stats.avg) : 0} readOnly size={24} label={stats ? `Media ${formatAvg(stats.avg)} din 5` : 'Fără recenzii încă'} />
              <div style={{ color: 'var(--text-light)', fontSize: '.9rem', marginTop: 4 }}>
                {stats && stats.n > 0
                  ? `din 5 · ${stats.n === 1 ? 'o recenzie publicată' : `${stats.n} recenzii publicate`}`
                  : 'Încă nu există recenzii publicate — a ta poate fi prima.'}
              </div>
            </div>
            <div style={{ marginLeft: 'auto', fontSize: '.82rem', color: 'var(--text-muted)', maxWidth: 300, lineHeight: 1.5 }}>
              Recenziile sunt lăsate din cont și publicate după verificare. Notele ★ de pe fiecare test se lasă după rezolvarea lui.
            </div>
          </div>

          {/* Formularul */}
          <div id="formular" style={{ ...card, scrollMarginTop: 90, borderTop: '4px solid var(--gold)' }}>
            <h2 style={{ fontFamily: 'var(--font-display)', fontSize: '1.3rem', color: 'var(--navy)', marginBottom: 12 }}>
              ⭐ Părerea ta despre ExamenMate
            </h2>
            <SiteReviewForm onSaved={() => setReloadKey((k) => k + 1)} />
            {!user && (
              <p style={{ marginTop: 12, fontSize: '.84rem', color: 'var(--text-muted)' }}>
                Nu ai cont? <Link to="/inregistrare" style={{ color: 'var(--navy)', fontWeight: 700 }}>Creează unul gratuit</Link> — durează un minut.
              </p>
            )}
          </div>

          {/* Lista */}
          <div style={card}>
            <h2 style={{ fontFamily: 'var(--font-display)', fontSize: '1.3rem', color: 'var(--navy)', marginBottom: 16 }}>
              Recenzii publicate
            </h2>
            <ReviewList targetType="site" targetId={null} pageSize={10} reloadKey={reloadKey}
              emptyText="Încă nu există recenzii publicate. După verificare, recenziile apar aici și pe pagina principală." />
          </div>

          {/* Trimitere către teste */}
          <div style={{ background: 'var(--navy)', borderRadius: 14, padding: '28px 32px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 16 }}>
            <div>
              <div style={{ fontFamily: 'var(--font-display)', color: 'var(--gold)', fontSize: '1.1rem', marginBottom: 6 }}>
                Notează și testele pe care le rezolvi
              </div>
              <p style={{ color: 'rgba(255,255,255,0.7)', fontSize: '.88rem', maxWidth: 520 }}>
                După fiecare test interactiv poți lăsa stele și un comentariu — media apare pe cardul testului și ne ajută să reparăm rapid ce nu merge.
              </p>
            </div>
            <Link to="/evaluare-nationala" className="btn btn-primary">Alege un test</Link>
          </div>

        </div>
      </section>
    </>
  );
}
