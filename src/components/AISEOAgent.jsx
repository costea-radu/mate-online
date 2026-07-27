// =====================================================================
// src/components/AISEOAgent.jsx — Agentul Claude de SEO & marketing (admin)
// Sarcini presetate (audit, meta, blog, social, cuvinte cheie, performanță
// Google cu date reale) + chat liber, cu context real din site.
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
  { id: 'blog',        icon: '📝', label: 'Idei articole blog' },
  { id: 'social',      icon: '📱', label: 'Postări social media' },
];

export default function AISEOAgent({ box }) {
  const [input, setInput] = useState('');
  const [history, setHistory] = useState([]); // {role, content, task?}
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [provider, setProvider] = useState(null);
  const [googleOn, setGoogleOn] = useState(null);
  const [nlStatus, setNlStatus] = useState(null);

  async function run(task, text = '') {
    setLoading(true); setError(null);
    const userMsg = text || PRESETS.find((p) => p.id === task)?.label || task;
    try {
      const r = await aiClient.seoAgent({
        task, input: text,
        history: history.map(({ role, content }) => ({ role, content })),
      });
      setProvider(r.provider);
      if (typeof r.googleConnected === 'boolean') setGoogleOn(r.googleConnected);
      setHistory((h) => [...h, { role: 'user', content: userMsg }, { role: 'assistant', content: r.text }]);
      setInput('');
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
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
        Alege o sarcină rapidă sau scrie liber (ex: „scrie articolul despre formulele de arii pentru EN").
        {provider && <span style={{ color: 'var(--text-muted)' }}> · model: {provider}</span>}
        {googleOn === false && <span style={{ color: '#b26a00' }}> · ⚠️ Google neconectat (vezi GHID_EMAIL_SI_SEO.md)</span>}
      </p>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
        {PRESETS.map((p) => (
          <button key={p.id} className="btn btn-outline" disabled={loading} onClick={() => run(p.id)}
            style={{ fontSize: '.85rem' }}>
            {p.icon} {p.label}
          </button>
        ))}
      </div>

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
      {loading && <div style={{ marginTop: 12, fontSize: '.85rem', color: 'var(--text-muted)' }}>Agentul analizează site-ul…</div>}
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
