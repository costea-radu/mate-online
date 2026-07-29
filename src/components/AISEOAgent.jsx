// =====================================================================
// src/components/AISEOAgent.jsx — Agentul Claude de SEO & marketing (admin)
// Sarcini presetate (audit, meta, blog, social, cuvinte cheie, performanță
// Google cu date reale) + chat liber, cu context real din site.
// Selector de model AI (Sonnet/Opus, inclusiv Opus 5) — alegerea se trimite
// la server per cerere; la „Articole Blog" adminul își poate alege TEMA.
// Răspunsurile se pot copia, descărca ca .md sau trimite ca NEWSLETTER
// pe email tuturor utilizatorilor abonați (de pe admin.examenmate@gmail.com).
// =====================================================================
import { useState } from 'react';
import { aiClient } from '../lib/aiClient';

const PRESETS = [
  { id: 'audit',       icon: '🔍', label: 'Audit SEO' },
  { id: 'performance', icon: '📊', label: 'Performanță Google (date reale)' },
  { id: 'meta',        icon: '🏷️', label: 'Meta title & description' },
  { id: 'keywords',    icon: '🎯', label: 'Cuvinte cheie' },
  { id: 'blog',        icon: '📝', label: 'Articole Blog/Rezolvări (scrie & propune)' },
  { id: 'social',      icon: '📱', label: 'Postări social media' },
  { id: 'youtube',     icon: '▶️', label: 'YouTube — titluri & descrieri' },
];

// Modelele Claude dintre care poate alege adminul. Oglinda listei permise de
// server (api/_lib/claude.js → MODELS) — ține-le sincron. Serverul validează
// oricum: un ID necunoscut cade pe modelul implicit.
const MODELS = [
  { id: 'claude-sonnet-5',   label: 'Sonnet 5',   hint: 'rapid și echilibrat — recomandat pentru sarcinile de zi cu zi' },
  { id: 'claude-opus-5',     label: 'Opus 5',     hint: 'cel mai capabil model — ideal pentru articole și analize complexe (mai lent și mai scump)' },
  { id: 'claude-sonnet-4-6', label: 'Sonnet 4.6', hint: 'generația anterioară Sonnet' },
  { id: 'claude-opus-4-8',   label: 'Opus 4.8',   hint: 'generația anterioară Opus' },
];

export default function AISEOAgent({ box }) {
  const [input, setInput] = useState('');
  const [history, setHistory] = useState([]); // {role, content, task?}
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [provider, setProvider] = useState(null);
  const [googleOn, setGoogleOn] = useState(null);
  const [nlStatus, setNlStatus] = useState(null);
  const [propStatus, setPropStatus] = useState(null);
  const [model, setModel] = useState(MODELS[0].id);      // selectorul de model AI
  const [showBlogTheme, setShowBlogTheme] = useState(false); // panoul „tema articolului"
  const [blogTheme, setBlogTheme] = useState('');

  async function run(task, text = '') {
    setLoading(true); setError(null); setPropStatus(null);
    const userMsg = text || PRESETS.find((p) => p.id === task)?.label || task;
    try {
      const r = await aiClient.seoAgent({
        task, input: text, model,
        history: history.map(({ role, content }) => ({ role, content })),
      });
      setProvider(r.provider);
      if (typeof r.googleConnected === 'boolean') setGoogleOn(r.googleConnected);
      setHistory((h) => [...h, { role: 'user', content: userMsg }, { role: 'assistant', content: r.text }]);
      setInput('');
      // Faza 1: agentul poate trimite PROPUNERI (meta, redenumiri, sitemap) —
      // anunțăm coada de aprobare de mai jos să se reîncarce.
      if (r.proposals > 0) {
        setPropStatus(`Agentul a trimis ${r.proposals === 1 ? 'o propunere' : r.proposals + ' propuneri'} în coada de aprobare (secțiunea „Coada de aprobare" de mai jos). Nimic nu se aplică fără OK-ul tău.`);
        window.dispatchEvent(new CustomEvent('seo-actions-updated'));
      }
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }

  // „Articole Blog": adminul poate scrie TEMA articolului (sau lasă agentul
  // să o aleagă din datele Google). Tema pleacă drept input al sarcinii `blog`
  // — promptul serverului spune deja: „dacă adminul cere un articol anume,
  // scrie-l și propune-l".
  function runBlog(theme = '') {
    const t = String(theme || '').trim();
    setShowBlogTheme(false);
    setBlogTheme('');
    run('blog', t ? `Scrie un articol pe tema aleasă de mine: „${t}". Documentează-te întâi (list_articles, read_material, gsc_query unde ajută), apoi scrie articolul complet și trimite-l prin publish_article.` : '');
  }

  function copy(text) { navigator.clipboard?.writeText(text); }
  function download(text) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: 'text/markdown' }));
    a.download = `seo-examenmate-${new Date().toISOString().slice(0, 10)}.md`;
    a.click(); URL.revokeObjectURL(a.href);
  }

  // Trimite un răspuns al agentului ca NEWSLETTER: creează campania,
  // trimite întâi un TEST către admin, apoi (după confirmare) loturi
  // către toți abonații, cu link de dezabonare în fiecare email.
  async function sendNewsletter(md) {
    const subject = window.prompt('Subiectul emailului (ce vor vedea utilizatorii în inbox):');
    if (!subject || !subject.trim()) return;
    setNlStatus('Salvez campania…');
    try {
      const c = await aiClient.newsletter({ action: 'create', subject: subject.trim(), markdown: md });
      setNlStatus(`Trimit un email de TEST către ${c.adminEmail}…`);
      await aiClient.newsletter({ action: 'test', campaignId: c.campaignId });
      const goAhead = window.confirm(
        `Emailul de TEST a plecat către ${c.adminEmail} — verifică inboxul (și Spam).\n\n` +
        `Trimit newsletterul „${subject.trim()}" către ${c.recipients} utilizatori abonați?`
      );
      if (!goAhead) { setNlStatus('Anulat. Campania a rămas salvată — a plecat doar testul.'); return; }
      let total = 0, guard = 0;
      while (guard++ < 40) {
        const r = await aiClient.newsletter({ action: 'send', campaignId: c.campaignId });
        total += r.sent;
        setNlStatus(`Trimit… ${total} trimise, ${r.remaining} rămase.`);
        if (!r.remaining || !r.sent) break;
      }
      setNlStatus(`✅ Newsletter trimis către ${total} adrese.`);
    } catch (e) {
      setNlStatus(`⚠️ ${e.message}`);
    }
  }

  return (
    <div style={{ ...box, marginTop: 18 }}>
      <h3 style={{ fontFamily: 'var(--font-display)', color: 'var(--navy)', marginBottom: 6 }}>
        📈 Agent Claude — SEO & Marketing
      </h3>
      <p style={{ fontSize: '.85rem', color: 'var(--text-light)', marginBottom: 12 }}>
        Analizează site-ul (folosind conținutul real din baza de date{googleOn ? ' + datele reale din Google Search Console/GA4' : ''}) și produce materiale gata de folosit.
        Are și unelte de ACȚIUNE: poate propune meta noi pe pagini, redenumiri de materiale, articole/rezolvări scrise pentru pagina „Blog / Rezolvări / Teorie" (publicate pe /rezolvari/slug), metadate optimizate pentru clipurile YouTube existente și retrimiterea sitemapului — propunerile apar în coada de aprobare de mai jos și se aplică doar cu OK-ul tău.
        Alege o sarcină rapidă sau scrie liber (ex: „propune meta pentru paginile cu CTR mic").
        {provider && <span style={{ color: 'var(--text-muted)' }}> · model: {provider}</span>}
        {googleOn === false && <span style={{ color: '#b26a00' }}> · ⚠️ Google neconectat (vezi GHID_EMAIL_SI_SEO.md)</span>}
      </p>

      {/* Selectorul de model AI (Sonnet/Opus) — se aplică fiecărei cereri următoare */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 6 }}>
        <span style={{ fontSize: '.8rem', fontWeight: 700, color: 'var(--navy)' }}>🧠 Model AI:</span>
        {MODELS.map((m) => (
          <button key={m.id} type="button" disabled={loading} title={m.hint}
            onClick={() => setModel(m.id)}
            style={{
              border: model === m.id ? '2px solid var(--navy)' : '1px solid var(--border)',
              background: model === m.id ? 'var(--navy)' : '#fff',
              color: model === m.id ? '#fff' : 'var(--navy)',
              borderRadius: 20, padding: '4px 12px', fontSize: '.78rem', fontWeight: 600,
              cursor: loading ? 'default' : 'pointer',
            }}>
            {m.label}
          </button>
        ))}
      </div>
      <p style={{ fontSize: '.74rem', color: 'var(--text-muted)', marginBottom: 12 }}>
        {MODELS.find((m) => m.id === model)?.hint}
      </p>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
        {PRESETS.map((p) => (
          <button key={p.id} className="btn btn-outline" disabled={loading}
            onClick={() => (p.id === 'blog' ? setShowBlogTheme((v) => !v) : run(p.id))}
            style={{ fontSize: '.85rem', ...(p.id === 'blog' && showBlogTheme ? { borderColor: 'var(--navy)', boxShadow: '0 0 0 1px var(--navy) inset' } : {}) }}>
            {p.icon} {p.label}
          </button>
        ))}
      </div>

      {/* „Articole Blog": adminul alege tema — sau lasă agentul să decidă din date */}
      {showBlogTheme && (
        <div style={{ border: '1px dashed var(--border)', background: '#fbfcfe', borderRadius: 10, padding: '12px 14px', marginBottom: 12 }}>
          <div style={{ fontSize: '.83rem', fontWeight: 700, color: 'var(--navy)', marginBottom: 6 }}>
            📝 Articol nou — despre ce să scrie agentul?
          </div>
          <input value={blogTheme} onChange={(e) => setBlogTheme(e.target.value)} autoFocus
            onKeyDown={(e) => { if (e.key === 'Enter' && blogTheme.trim() && !loading) runBlog(blogTheme); }}
            placeholder='Tema ta (ex: „Formule de arii și perimetre — clasa a 7-a") · Enter pentru trimitere'
            style={{ width: '100%', border: '1px solid var(--border)', borderRadius: 8, padding: '9px 11px', fontSize: '.88rem', marginBottom: 8 }} />
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button className="btn btn-primary" disabled={loading || !blogTheme.trim()} onClick={() => runBlog(blogTheme)}
              style={{ fontSize: '.82rem' }}>
              ✍️ Scrie articolul pe tema mea
            </button>
            <button className="btn btn-outline" disabled={loading} onClick={() => runBlog('')}
              style={{ fontSize: '.82rem' }}>
              🎲 Lasă agentul să aleagă tema (din datele Google)
            </button>
          </div>
        </div>
      )}

      <div style={{ display: 'flex', gap: 8 }}>
        <input value={input} onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && input.trim() && !loading) run('chat', input.trim()); }}
          placeholder="Întreabă agentul SEO orice… (Enter pentru trimitere)"
          style={{ flex: 1, border: '1px solid var(--border)', borderRadius: 8, padding: '10px 12px', fontSize: '.9rem' }} />
        <button className="btn btn-primary" disabled={loading || !input.trim()} onClick={() => run('chat', input.trim())}>
          {loading ? '…' : 'Trimite'}
        </button>
      </div>

      {error && <div style={{ marginTop: 12, padding: 12, background: '#fdecea', color: '#b71c1c', borderRadius: 8, fontSize: '.85rem' }}>⚠️ {error}</div>}
      {loading && <div style={{ marginTop: 12, fontSize: '.85rem', color: 'var(--text-muted)' }}>Agentul analizează site-ul (poate folosi uneltele: date GSC, inspecție pagini, statistici DB)…</div>}
      {propStatus && <div style={{ marginTop: 12, padding: 12, background: '#fff7e0', color: '#8a6d00', borderRadius: 8, fontSize: '.85rem' }}>🔔 {propStatus}</div>}
      {nlStatus && <div style={{ marginTop: 12, padding: 10, background: '#f0f6ff', color: 'var(--navy)', borderRadius: 8, fontSize: '.85rem' }}>📨 {nlStatus}</div>}

      {history.length > 0 && (
        <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 10, maxHeight: 560, overflowY: 'auto' }}>
          {history.map((m, i) => m.role === 'user' ? (
            <div key={i} style={{ alignSelf: 'flex-end', background: 'var(--navy)', color: '#fff', borderRadius: '12px 12px 2px 12px', padding: '8px 12px', fontSize: '.85rem', maxWidth: '85%' }}>{m.content}</div>
          ) : (
            <div key={i} style={{ background: '#f7f9fc', borderRadius: '12px 12px 12px 2px', padding: '12px 14px', fontSize: '.86rem', position: 'relative' }}>
              <pre style={{ whiteSpace: 'pre-wrap', fontFamily: 'inherit', margin: 0, lineHeight: 1.55 }}>{m.content}</pre>
              <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
                <button onClick={() => copy(m.content)} style={{ background: 'none', border: '1px solid var(--border)', borderRadius: 6, padding: '3px 9px', fontSize: '.72rem', cursor: 'pointer' }}>📋 Copiază</button>
                <button onClick={() => download(m.content)} style={{ background: 'none', border: '1px solid var(--border)', borderRadius: 6, padding: '3px 9px', fontSize: '.72rem', cursor: 'pointer' }}>⬇️ Descarcă .md</button>
                <button onClick={() => sendNewsletter(m.content)} style={{ background: 'none', border: '1px solid var(--border)', borderRadius: 6, padding: '3px 9px', fontSize: '.72rem', cursor: 'pointer' }}>📨 Trimite ca newsletter</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
