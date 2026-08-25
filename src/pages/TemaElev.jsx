// =====================================================================
// src/pages/TemaElev.jsx — pagina „/tema-elev?id=..."
//
// Tema dată de profesor cu butonul „📝 Dă temă" (pe grupă sau unui elev
// anume): TOATE exercițiile bifate de profesor, aceleași pentru toți elevii
// vizați. Fiecare exercițiu se deschide în vizualizatorul potrivit:
//   • test din site (interactiv) → /exercitiu
//   • test din site (PDF)        → /pdf-viewer, cu Prof. Virtual alături
//   • test generat / din bibliotecă → /exercitiu-ai, PDF sau subiect tipăribil
//
// Exercițiile fără punctaj automat (PDF-uri, subiecte de examen) se marchează
// rezolvate cu butonul „✓ Am rezolvat".
// =====================================================================
import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { aiClient } from '../lib/aiClient';
import { renderQuiz } from '../lib/quizRender';
import { printExam } from '../lib/examPrint';

export default function TemaElev() {
  const [params] = useSearchParams();
  const id = params.get('id');
  const navigate = useNavigate();
  const { user, loading: authLoading } = useAuth();

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(null);

  const load = useCallback(() => {
    if (!id) { setError('Link invalid.'); setLoading(false); return; }
    aiClient.homeworkOpen({ id })
      .then(setData)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [id]);

  useEffect(() => {
    if (authLoading) return;
    if (!user) { setLoading(false); return; }
    load();
  }, [authLoading, user, load]);

  const wrap = { maxWidth: 780, margin: '0 auto', padding: '32px 20px 60px' };
  const card = { background: '#fff', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', padding: 22, marginBottom: 18 };

  if (authLoading || loading) return <div style={{ padding: 60, textAlign: 'center' }}><div className="spinner" /></div>;

  if (!user) return (
    <div style={wrap}><div style={{ ...card, textAlign: 'center' }}>
      <div style={{ fontSize: '2.5rem', marginBottom: 10 }}>🔒</div>
      <p style={{ color: 'var(--text-light)', marginBottom: 16 }}>Autentifică-te ca să vezi tema primită de la profesor.</p>
      <Link to={`/autentificare?redirect=${encodeURIComponent(`/tema-elev?id=${id || ''}`)}`} className="btn btn-primary">Autentificare</Link>
    </div></div>
  );

  if (error) return (
    <div style={wrap}><div style={{ ...card, color: '#b71c1c' }}>
      ⚠️ {error}
      <div style={{ marginTop: 14 }}><Link to="/profil" className="btn btn-sm btn-outline">← Contul meu</Link></div>
    </div></div>
  );
  if (!data) return null;

  const h = data.homework || {};
  const back = `/tema-elev?id=${id}`;
  const items = data.items || [];
  const doneCount = items.filter((i) => i.done).length;

  function start(it) {
    const t = it.target || {};
    if (t.type === 'site-interactive') {
      navigate(`/exercitiu?id=${t.contentId}`, { state: { item: t.item, grant: t.grant || null, returnTo: back } });
    } else if (t.type === 'site-pdf') {
      navigate(`/pdf-viewer?id=${t.contentId}`, { state: { item: t.item, grant: t.grant || null, returnTo: back } });
    } else if (t.type === 'quiz') {
      const doc = t.questions ? renderQuiz(t.title || it.title, t.questions) : (t.html || '');
      navigate('/exercitiu-ai', { state: { html: doc, title: t.title || it.title, mode: 'homework', hwId: it.progressId || null } });
    } else if (t.type === 'exam' && t.exam) {
      printExam(t.exam, { withSolutions: false });
    } else if (t.type === 'pdf-file') {
      if (t.url) window.open(t.url, '_blank', 'noopener,noreferrer');
      else if (t.pdfBase64) {
        const bin = atob(t.pdfBase64);
        const arr = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
        const url = URL.createObjectURL(new Blob([arr], { type: 'application/pdf' }));
        window.open(url, '_blank', 'noopener,noreferrer');
      }
    }
  }

  async function markDone(it) {
    if (!it.progressId) return;
    setBusy(it.id);
    try { await aiClient.homeworkScore({ progressId: it.progressId, done: true }); load(); }
    catch (e) { setError(e.message); }
    finally { setBusy(null); }
  }

  const startable = (t) => ['site-interactive', 'site-pdf', 'quiz', 'exam', 'pdf-file'].includes(t?.type);
  // exercițiile fără punctaj automat se bifează manual
  const manualDone = (t) => ['exam', 'pdf-file', 'site-pdf'].includes(t?.type);

  return (
    <div style={wrap}>
      <div style={{ marginBottom: 18 }}>
        <div style={{ fontSize: '.78rem', color: 'var(--gold-dim)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.04em' }}>
          Temă de la profesorul {h.teacher || ''}{h.group ? ` · grupa ${h.group}` : ''}
        </div>
        <h1 style={{ fontFamily: 'var(--font-display)', color: 'var(--navy)', fontSize: '1.6rem' }}>{h.title}</h1>
        <div style={{ fontSize: '.82rem', color: 'var(--text-muted)' }}>
          {items.length} {items.length === 1 ? 'exercițiu' : 'exerciții'} · {doneCount} rezolvate
          {h.dueAt ? ` · termen ${new Date(h.dueAt).toLocaleDateString('ro-RO')}` : ''}
        </div>
      </div>

      {data.preview && (
        <div style={{ ...card, background: 'rgba(232,185,49,.12)', borderColor: 'var(--gold)' }}>
          👁️ <strong>Previzualizare</strong> — vezi tema așa cum o văd elevii. Deschiderea ta nu se înregistrează ca rezolvare.
        </div>
      )}

      {h.note && (
        <div style={{ ...card, background: 'var(--cream)' }}>
          <div style={{ fontSize: '.75rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 4 }}>Mesajul profesorului</div>
          <div style={{ fontSize: '.9rem', color: 'var(--text)' }}>{h.note}</div>
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {items.map((it, idx) => {
          const t = it.target || {};
          return (
            <div key={it.id} style={{ ...card, marginBottom: 0, padding: 16, borderColor: it.done ? 'rgba(39,174,96,.4)' : 'var(--border)', background: it.done ? 'rgba(39,174,96,.05)' : '#fff' }}>
              <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start', flexWrap: 'wrap' }}>
                <span style={{
                  width: 26, height: 26, flexShrink: 0, borderRadius: '50%', display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: '.75rem', fontWeight: 800,
                  background: it.done ? '#27ae60' : 'var(--cream)', color: it.done ? '#fff' : 'var(--navy)',
                  border: it.done ? 'none' : '1px solid var(--border)',
                }}>{it.done ? '✓' : idx + 1}</span>
                <div style={{ flex: '1 1 220px', minWidth: 0 }}>
                  <div style={{ fontWeight: 700, color: 'var(--navy)', fontSize: '.98rem' }}>
                    {t.type === 'site-pdf' || t.type === 'pdf-file' ? '📄 ' : t.type === 'exam' ? '🖨 ' : '🧩 '}
                    {t.item?.title || t.title || it.title}
                  </div>
                  {it.percent != null && (
                    <div style={{ fontSize: '.8rem', fontWeight: 700, marginTop: 3, color: it.percent >= 80 ? '#2e7d32' : it.percent >= 50 ? '#e65100' : '#c62828' }}>
                      {it.score}/{it.maxScore} ({it.percent}%)
                    </div>
                  )}
                  {t.type === 'locked' && (
                    <div style={{ fontSize: '.8rem', color: '#b26a00', marginTop: 4 }}>
                      ⭐ Exercițiu premium — ai nevoie de abonament. <Link to="/preturi" style={{ color: 'var(--navy)', fontWeight: 600 }}>Vezi abonamentele</Link>
                    </div>
                  )}
                  {t.type === 'missing' && (
                    <div style={{ fontSize: '.8rem', color: '#b71c1c', marginTop: 4 }}>⚠️ Exercițiul nu mai există. Anunță-ți profesorul.</div>
                  )}
                </div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {startable(t) && (
                    <button className="btn btn-sm btn-primary" onClick={() => start(it)}>
                      {it.done ? '↻ Reia' : t.type === 'exam' ? '🖨 Deschide' : t.type === 'pdf-file' ? '📄 Deschide' : '▶ Începe'}
                    </button>
                  )}
                  {!it.done && startable(t) && manualDone(t) && it.progressId && (
                    <button className="btn btn-sm btn-outline" disabled={busy === it.id} onClick={() => markDone(it)}>
                      {busy === it.id ? '…' : '✓ Am rezolvat'}
                    </button>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div style={{ fontSize: '.8rem', color: 'var(--text-muted)', marginTop: 18 }}>
        Rezultatele tale ajung automat la profesor.{' '}
        <Link to="/profil" style={{ color: 'var(--navy)', fontWeight: 600 }}>Contul meu →</Link>
      </div>
    </div>
  );
}
