import { useState } from 'react';
import { Link } from 'react-router-dom';

const inputStyle = {
  width: '100%', border: '1px solid var(--border)', borderRadius: 8,
  padding: '11px 13px', fontSize: '.92rem', fontFamily: 'inherit', background: '#fff',
};
const labelStyle = {
  fontSize: '0.78rem', fontWeight: 700, color: 'var(--text-muted)',
  textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6, display: 'block',
};

export default function Contact() {
  const [form, setForm] = useState({ name: '', email: '', subject: '', message: '', website: '' });
  const [status, setStatus] = useState(null); // null | 'sending' | 'sent' | {error}
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function submit(e) {
    e.preventDefault();
    if (status === 'sending') return;
    setStatus('sending');
    try {
      const res = await fetch('/api/contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Nu am putut trimite mesajul.');
      setStatus('sent');
      setForm({ name: '', email: '', subject: '', message: '', website: '' });
    } catch (err) {
      setStatus({ error: err.message });
    }
  }

  return (
    <>
      <div className="page-header">
        <div className="container">
          <div className="breadcrumb">
            <Link to="/">Acasă</Link><span>›</span><span>Contact</span>
          </div>
          <h1>Contact</h1>
          <p>Suntem aici să te ajutăm. Nu ezita să ne contactezi.</p>
        </div>
      </div>

      <section className="section">
        <div className="container" style={{ maxWidth: 700 }}>
          <div style={{ display: 'grid', gap: 20 }}>

            {/* Formular de contact → mesajul ajunge pe admin.examenmate@gmail.com */}
            <form onSubmit={submit} className="contact-card">
              <div style={{ fontFamily: 'var(--font-display)', color: 'var(--navy)', fontSize: '1.2rem', fontWeight: 700, marginBottom: 4 }}>
                Trimite-ne un mesaj
              </div>
              <p style={{ fontSize: '0.86rem', color: 'var(--text-muted)', marginBottom: 18 }}>
                Completează formularul și îți răspundem pe email în maxim 24 de ore.
              </p>

              {status === 'sent' ? (
                <div style={{ padding: '16px 18px', background: 'rgba(46,160,67,0.08)', border: '1px solid rgba(46,160,67,0.35)', borderRadius: 10, color: '#1a7f37', fontSize: '.92rem', fontWeight: 600 }}>
                  ✅ Mesajul a fost trimis! Ți-am trimis și o confirmare pe email.
                  <button type="button" onClick={() => setStatus(null)}
                    style={{ display: 'block', marginTop: 10, background: 'none', border: 'none', color: 'var(--navy)', fontWeight: 600, cursor: 'pointer', padding: 0, fontSize: '.85rem', textDecoration: 'underline' }}>
                    Trimite alt mesaj
                  </button>
                </div>
              ) : (
                <div style={{ display: 'grid', gap: 14 }}>
                  {/* pe mobil trece pe o singură coloană (vezi .contact-two în global.css) */}
                  <div className="contact-two">
                    <div>
                      <label style={labelStyle} htmlFor="ct-name">Nume</label>
                      <input id="ct-name" style={inputStyle} value={form.name} onChange={set('name')} required minLength={2} maxLength={80} placeholder="Numele tău" />
                    </div>
                    <div>
                      <label style={labelStyle} htmlFor="ct-email">Email</label>
                      <input id="ct-email" style={inputStyle} type="email" value={form.email} onChange={set('email')} required placeholder="adresa@exemplu.ro" />
                    </div>
                  </div>
                  <div>
                    <label style={labelStyle} htmlFor="ct-subject">Subiect <span style={{ fontWeight: 400, textTransform: 'none' }}>(opțional)</span></label>
                    <input id="ct-subject" style={inputStyle} value={form.subject} onChange={set('subject')} maxLength={120} placeholder="Despre ce e vorba?" />
                  </div>
                  <div>
                    <label style={labelStyle} htmlFor="ct-message">Mesaj</label>
                    <textarea id="ct-message" style={{ ...inputStyle, minHeight: 130, resize: 'vertical' }} value={form.message} onChange={set('message')} required minLength={10} maxLength={5000} placeholder="Scrie mesajul tău aici…" />
                  </div>
                  {/* Honeypot anti-spam — invizibil pentru oameni */}
                  <input type="text" value={form.website} onChange={set('website')} tabIndex={-1} autoComplete="off"
                    style={{ position: 'absolute', left: -9999, width: 1, height: 1, opacity: 0 }} aria-hidden="true" placeholder="website" />
                  {status && status.error && (
                    <div style={{ padding: '10px 14px', background: '#fdecea', color: '#b71c1c', borderRadius: 8, fontSize: '.86rem' }}>⚠️ {status.error}</div>
                  )}
                  <button type="submit" className="btn btn-primary" disabled={status === 'sending'} style={{ justifySelf: 'start' }}>
                    {status === 'sending' ? 'Se trimite…' : 'Trimite mesajul'}
                  </button>
                </div>
              )}
            </form>

            <div className="contact-card contact-row">
              <div style={{ width: 56, height: 56, borderRadius: 14, background: 'rgba(232,185,49,0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.6rem', flexShrink: 0 }}>
                📞
              </div>
              <div>
                <div style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>Telefon</div>
                <a href="tel:0765173728" style={{ fontSize: '1.25rem', fontWeight: 700, color: 'var(--navy)', fontFamily: 'var(--font-display)', textDecoration: 'none' }}>
                  0765 173 728
                </a>
                <div style={{ fontSize: '0.83rem', color: 'var(--text-muted)', marginTop: 4 }}>Luni – Vineri, 09:00 – 18:00</div>
              </div>
            </div>

            <div className="contact-card contact-row">
              <div style={{ width: 56, height: 56, borderRadius: 14, background: 'rgba(232,185,49,0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.6rem', flexShrink: 0 }}>
                ✉️
              </div>
              <div>
                <div style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>E-mail</div>
                <a href="mailto:admin.examenmate@gmail.com" style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--navy)', fontFamily: 'var(--font-display)', textDecoration: 'none' }}>
                  admin.examenmate@gmail.com
                </a>
                <div style={{ fontSize: '0.83rem', color: 'var(--text-muted)', marginTop: 4 }}>Răspundem în maxim 24 de ore</div>
              </div>
            </div>

            <div className="contact-note">
              <div style={{ fontFamily: 'var(--font-display)', color: 'var(--gold)', fontSize: '1.05rem', fontWeight: 700, marginBottom: 8 }}>
                Ai o întrebare despre platformă?
              </div>
              Ne poți contacta pentru orice problemă legată de cont, abonament, conținut sau sugestii de îmbunătățire. Îți vom răspunde cât mai repede posibil.
            </div>

          </div>
        </div>
      </section>
    </>
  );
}
