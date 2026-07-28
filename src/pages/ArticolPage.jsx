// =====================================================================
// src/pages/ArticolPage.jsx — pagina unui articol/rezolvări scrise din
// pagina Rezolvări: /rezolvari/{slug} (Faza 2 din GHID_AGENT_SEO_ACTIUNI.md)
//
// Serverul (api/page-meta.js) servește deja pagina cu meta corecte +
// conținutul complet în #root (pentru crawlere și share-uri) + datele în
// <script id="__ARTICOL__"> — de aceea la prima încărcare NU refacem
// cererea: hidratăm din datele injectate. La navigarea client-side
// încărcăm articolul din Supabase (RLS permite doar status='published').
// Formulele LaTeX ($...$) sunt randate de KaTeX după montare.
// =====================================================================
import { useState, useEffect, useRef } from 'react';
import { Link, useParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { ensureKatex, renderMath } from '../lib/katex';

const KIND_INFO = {
  articol:    { icon: '📖', label: 'Articol' },
  rezolvare:  { icon: '✍️', label: 'Rezolvare scrisă' },
  explicatie: { icon: '💡', label: 'Explicație' },
};

const CATEGORY_LABELS = {
  general: 'General', 'clasa-5': 'Clasa a V-a', 'clasa-6': 'Clasa a VI-a',
  'clasa-7': 'Clasa a VII-a', 'clasa-8': 'Clasa a VIII-a', 'clasa-9': 'Clasa a IX-a',
  'clasa-10': 'Clasa a X-a', 'clasa-11': 'Clasa a XI-a', 'clasa-12': 'Clasa a XII-a',
  'evaluare-nationala': 'Evaluare Națională', bacalaureat: 'Bacalaureat', manuale: 'Manuale',
};

// Pagina de listare potrivită pentru o categorie (linkuri interne/CTA).
function categoryRoute(cat) {
  const m = /^clasa-(\d+)$/.exec(cat || '');
  if (m) return `/clase/${m[1]}`;
  if (cat === 'evaluare-nationala') return '/evaluare-nationala';
  if (cat === 'bacalaureat') return '/bacalaureat';
  if (cat === 'manuale') return '/manuale';
  return '/rezolvari';
}

const roDate = (iso) => {
  try { return new Date(iso).toLocaleDateString('ro-RO', { day: 'numeric', month: 'long', year: 'numeric' }); }
  catch { return null; }
};

// Datele injectate de server la prima încărcare (dacă sunt ale acestui slug).
function serverArticle(slug) {
  try {
    const el = document.getElementById('__ARTICOL__');
    if (!el) return null;
    const data = JSON.parse(el.textContent);
    return data && data.slug === slug ? data : null;
  } catch { return null; }
}

export default function ArticolPage() {
  const { slug } = useParams();
  const [article, setArticle] = useState(() => serverArticle(slug));
  const [related, setRelated] = useState([]);
  const [loading, setLoading] = useState(!article);
  const contentRef = useRef(null);

  // Încarcă articolul (doar dacă nu-l avem deja de la server / alt slug)
  useEffect(() => {
    let alive = true;
    const cached = serverArticle(slug);
    if (cached) { setArticle(cached); setLoading(false); return () => { alive = false; }; }
    setLoading(true); setArticle(null);
    supabase
      .from('articole')
      .select('slug, title, description, category, kind, content_html, keywords, sources, published_at, updated_at')
      .eq('slug', slug).eq('status', 'published')
      .maybeSingle()
      .then(({ data }) => { if (alive) { setArticle(data || null); setLoading(false); } });
    return () => { alive = false; };
  }, [slug]);

  // Articole înrudite (aceeași categorie)
  useEffect(() => {
    if (!article?.category) { setRelated([]); return; }
    let alive = true;
    supabase
      .from('articole')
      .select('slug, title, kind, description')
      .eq('status', 'published').eq('category', article.category).neq('slug', article.slug)
      .order('published_at', { ascending: false })
      .limit(3)
      .then(({ data }) => { if (alive) setRelated(data || []); });
    return () => { alive = false; };
  }, [article?.slug, article?.category]);

  // Title-ul documentului + KaTeX pentru formule
  useEffect(() => {
    if (!article) return;
    document.title = article.title;
    ensureKatex().then(() => renderMath(contentRef.current));
    return () => { document.title = 'ExamenMate – Matematică pentru Succes'; };
  }, [article]);

  if (loading) {
    return <div style={{ display: 'flex', justifyContent: 'center', padding: '80px 0' }}><div className="spinner" /></div>;
  }

  if (!article) {
    return (
      <div className="empty-state" style={{ minHeight: '50vh' }}>
        <div className="empty-state-icon">🔍</div>
        <h3>Articolul nu a fost găsit</h3>
        <p>Nu există (sau nu mai este publicat) un articol la această adresă.</p>
        <p style={{ marginTop: 20 }}>
          <Link to="/rezolvari" className="btn btn-primary">Vezi toate rezolvările și articolele</Link>
        </p>
      </div>
    );
  }

  const kind = KIND_INFO[article.kind] || KIND_INFO.articol;
  const catLabel = CATEGORY_LABELS[article.category] || null;
  const catRoute = categoryRoute(article.category);
  const date = article.published_at ? roDate(article.published_at) : null;
  const updated = article.updated_at && article.published_at
    && String(article.updated_at).slice(0, 10) !== String(article.published_at).slice(0, 10)
    ? roDate(article.updated_at) : null;
  const sources = (Array.isArray(article.sources) ? article.sources : []).filter((s) => s && s.title);

  return (
    <>
      <div className="page-header">
        <div className="container">
          <nav className="breadcrumb">
            <Link to="/">Acasă</Link><span>›</span>
            <Link to="/rezolvari">Rezolvări</Link><span>›</span>
            <span>{kind.label}</span>
          </nav>
          <h1>{article.title}</h1>
          {article.description && <p>{article.description}</p>}
        </div>
      </div>

      <div className="content-list">
        <div className="container articol-wrap">
          <div className="articol-meta-line">
            <span className="articol-badge">{kind.icon} {kind.label}</span>
            {catLabel && (<><span className="articol-dot">·</span><Link to={catRoute} className="articol-cat">{catLabel}</Link></>)}
            {date && (<><span className="articol-dot">·</span><span>📅 {date}</span></>)}
            {updated && (<><span className="articol-dot">·</span><span>(actualizat {updated})</span></>)}
          </div>

          <article
            ref={contentRef}
            className="articol-content"
            dangerouslySetInnerHTML={{ __html: article.content_html || '' }}
          />

          {sources.length > 0 && (
            <div className="articol-surse">
              <h2>📚 Materiale de pe ExamenMate folosite în acest articol</h2>
              <ul>
                {sources.map((s, i) => (
                  <li key={i}>
                    <Link to={categoryRoute(s.category || article.category)}>{String(s.title).slice(0, 160)}</Link>
                    {s.is_free === false && <span className="articol-premium-tag">Premium</span>}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="articol-cta">
            <h2>Vrei mai mult decât atât?</h2>
            <p>
              Pe ExamenMate găsești exerciții interactive, rezolvări video și teste complete
              {catLabel ? ` pentru ${catLabel}` : ''} — plus Profesorul Virtual care îți explică pas cu pas.
            </p>
            <p style={{ display: 'flex', gap: 10, flexWrap: 'wrap', justifyContent: 'center' }}>
              <Link className="btn btn-primary" to={catRoute}>Vezi materialele{catLabel ? ` pentru ${catLabel}` : ''}</Link>
              <Link className="btn btn-outline" to="/preturi">Abonamente</Link>
            </p>
          </div>

          {related.length > 0 && (
            <div className="articol-related">
              <h2>Citește și:</h2>
              <div className="articol-related-grid">
                {related.map((r) => (
                  <Link key={r.slug} to={`/rezolvari/${r.slug}`} className="articol-related-card">
                    <span className="articol-related-kind">{(KIND_INFO[r.kind] || KIND_INFO.articol).icon} {(KIND_INFO[r.kind] || KIND_INFO.articol).label}</span>
                    <strong>{r.title}</strong>
                    {r.description && <span className="articol-related-desc">{String(r.description).slice(0, 110)}</span>}
                  </Link>
                ))}
              </div>
            </div>
          )}

          <p className="articol-back"><Link to="/rezolvari">← Toate rezolvările și articolele</Link></p>
        </div>
      </div>
    </>
  );
}
