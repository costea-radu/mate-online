// =====================================================================
// src/pages/GrupaTema.jsx — pagina „/tema-grupa?id=..."
// Elevul deschide linkul primit de la profesor și primește TESTUL LUI —
// diferit de al colegilor. Repartizarea rămâne aceeași la redeschidere.
// De aici, testul se deschide în vizualizatorul potrivit:
//   • test din site (interactiv) → /exercitiu
//   • test din site (PDF)        → /pdf-viewer (cu Prof. Virtual alături)
//   • test generat / din bibliotecă → /exercitiu-ai, PDF sau subiect tipăribil
// =====================================================================
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { aiClient } from '../lib/aiClient';
import { renderQuiz } from '../lib/quizRender';
import { printExam } from '../lib/examPrint';
import { startTestMode, endTestMode, isTestMode, useTestCountdown, fmtRamas, fmtDurata } from '../lib/testMode';

export default function GrupaTema() {
  const [params] = useSearchParams();
  const id = params.get('id');
  const navigate = useNavigate();
  const { user, loading: authLoading } = useAuth();

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  // Cât timp testul e în desfășurare, se opresc mesageria ȘI Profesorul Virtual.
  const [testActiv, setTestActiv] = useState(() => isTestMode());
  // Timpul rămas, când profesorul a pus o limită (10 minute – 3 ore).
  const ramas = useTestCountdown();

  const load = useCallback(() => {
    if (!id) { setError('Link invalid.'); setLoading(false); return; }
    aiClient.groupAssignmentOpen({ id })
      .then(setData)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [id]);

  useEffect(() => {
    if (authLoading) return;
    if (!user) { setLoading(false); return; }
    load();
  }, [authLoading, user, load]);

  // Întors din vizualizator cu testul deja trimis → mesageria repornește singură.
  useEffect(() => {
    if (data?.result && data?.pickId) {
      aiClient.groupAssignmentTestEnd({ pickId: data.pickId }).catch(() => {});
      endTestMode();
      setTestActiv(false);
    }
  }, [data]);

  // A expirat timpul cât elevul stătea pe pagina temei → testul se închide și
  // aici, la fel ca în vizualizator (src/components/TestModeBadge.jsx).
  const expiratRef = useRef(false);
  useEffect(() => {
    if (ramas !== 0 || expiratRef.current || !data?.pickId) return;
    expiratRef.current = true;
    aiClient.groupAssignmentTimeUp({ pickId: data.pickId })
      .catch(() => {})
      .finally(() => { endTestMode(); setTestActiv(false); load(); });
  }, [ramas, data, load]);

  const wrap = { maxWidth: 780, margin: '0 auto', padding: '32px 20px 60px' };
  const card = { background: '#fff', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', padding: 22, marginBottom: 18 };

  if (authLoading || loading) return <div style={{ padding: 60, textAlign: 'center' }}><div className="spinner" /></div>;

  if (!user) return (
    <div style={wrap}><div style={{ ...card, textAlign: 'center' }}>
      <div style={{ fontSize: '2.5rem', marginBottom: 10 }}>🔒</div>
      <p style={{ color: 'var(--text-light)', marginBottom: 16 }}>Autentifică-te ca să vezi tema primită de la profesor.</p>
      <Link to={`/autentificare?redirect=${encodeURIComponent(`/tema-grupa?id=${id || ''}`)}`} className="btn btn-primary">Autentificare</Link>
    </div></div>
  );

  if (error) return (
    <div style={wrap}><div style={{ ...card, color: '#b71c1c' }}>
      ⚠️ {error}
      <div style={{ marginTop: 14 }}><Link to="/profil" className="btn btn-sm btn-outline">← Contul meu</Link></div>
    </div></div>
  );
  if (!data) return null;

  const t = data.target || {};
  const back = `/tema-grupa?id=${id}`;
  // profesorul care își previzualizează propriul link nu are repartizare
  const gtQ = data.pickId ? `&gt=${data.pickId}` : '';

  function start() {
    // „În timpul unui test pe grupă, toate mesageriile sunt oprite automat."
    // Când testul are timp de lucru, cronometrul pornește de la termenul dat de
    // server (calculat din prima apăsare pe „Începe testul"), nu de la zero.
    if (data.pickId) {
      setTestActiv(true);
      const termenLocal = data.deadlineAt
        || (data.timeLimitMin ? new Date(Date.now() + data.timeLimitMin * 60000).toISOString() : null);
      startTestMode({ pickId: data.pickId, title: data.title, deadline: termenLocal });
      aiClient.groupAssignmentTestStart({ pickId: data.pickId })
        .then((r) => {
          if (r?.deadlineAt) startTestMode({ pickId: data.pickId, title: data.title, deadline: r.deadlineAt });
        })
        .catch(() => {});
    }
    if (t.type === 'site-interactive') {
      navigate(`/exercitiu?id=${t.contentId}${gtQ}`, {
        state: { item: t.item, grant: t.grant || null, gtId: data.pickId || null, returnTo: back },
      });
    } else if (t.type === 'site-pdf') {
      navigate(`/pdf-viewer?id=${t.contentId}${gtQ}`, {
        state: { item: t.item, grant: t.grant || null, gtId: data.pickId || null, returnTo: back },
      });
    } else if (t.type === 'quiz') {
      const doc = t.questions ? renderQuiz(t.title || data.title, t.questions) : (t.html || '');
      navigate('/exercitiu-ai', { state: { html: doc, title: t.title || data.title, mode: 'group', gtId: data.pickId || null } });
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

  async function endTest() {
    if (!data.pickId) return;
    try { await aiClient.groupAssignmentTestEnd({ pickId: data.pickId }); } catch { /* expiră oricum singură */ }
    endTestMode();
    setTestActiv(false);
    load();
  }

  // după expirarea timpului, testul nu se mai poate deschide
  const startable = ['site-interactive', 'site-pdf', 'quiz', 'exam', 'pdf-file'].includes(t.type) && !data.timedOut;

  return (
    <div style={wrap}>
      <div style={{ marginBottom: 18 }}>
        <div style={{ fontSize: '.78rem', color: 'var(--gold-dim)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.04em' }}>
          Temă de la profesorul {data.teacher || ''}{data.group ? ` · grupa ${data.group}` : ''}
        </div>
        <h1 style={{ fontFamily: 'var(--font-display)', color: 'var(--navy)', fontSize: '1.6rem' }}>{data.title}</h1>
      </div>

      {data.preview && (
        <div style={{ ...card, background: 'rgba(232,185,49,.12)', borderColor: 'var(--gold)' }}>
          👁️ <strong>Previzualizare</strong> — vezi tema ca profesor. Elevii tăi primesc, fiecare, alt test din cele
          <strong> {data.poolSize}</strong> din bazin. Deschiderea ta nu consumă nicio repartizare.
        </div>
      )}

      <div style={card}>
        <div style={{ fontSize: '.8rem', color: 'var(--text-muted)', marginBottom: 6 }}>Testul tău</div>
        <div style={{ fontSize: '1.15rem', fontWeight: 700, color: 'var(--navy)', marginBottom: 4 }}>
          {t.type === 'site-pdf' || t.type === 'pdf-file' ? '📄 ' : '🧩 '}
          {t.item?.title || t.title || data.item?.title || 'Testul tău'}
        </div>
        <div style={{ fontSize: '.8rem', color: 'var(--text-muted)', marginBottom: 16 }}>
          Ai primit un test diferit de al colegilor tăi. Îl poți relua oricând de la acest link — vei primi
          același test, ca să-ți poți îmbunătăți scorul.
        </div>

        {data.result && data.result.score != null && (
          <div style={{ marginBottom: 14, padding: '10px 12px', borderRadius: 8, background: 'rgba(39,174,96,.1)', color: '#1e7e34', fontWeight: 700, fontSize: '.9rem' }}>
            ✓ Rezultat trimis profesorului: {data.result.score}/{data.result.maxScore}
          </div>
        )}

        {t.type === 'locked' && (
          <div style={{ padding: '12px 14px', borderRadius: 10, background: 'rgba(232,185,49,.12)', border: '1px solid var(--gold)' }}>
            <div style={{ fontWeight: 700, color: 'var(--navy)', marginBottom: 4 }}>⭐ Testul repartizat ție este premium</div>
            <p style={{ fontSize: '.85rem', color: 'var(--text-muted)', marginBottom: 10 }}>
              Ai nevoie de abonament ca să îl deschizi. Spune-i profesorului dacă vrei un test gratuit în locul lui.
            </p>
            <Link to="/preturi" className="btn btn-sm btn-primary">Vezi abonamentele</Link>
          </div>
        )}

        {t.type === 'missing' && (
          <div style={{ fontSize: '.88rem', color: '#b71c1c' }}>
            ⚠️ Testul repartizat nu mai există (a fost șters). Anunță-ți profesorul.
          </div>
        )}

        {/* Timpul de lucru pus de profesor */}
        {data.timeLimitMin > 0 && !data.preview && (
          <div style={{
            display: 'flex', gap: 10, alignItems: 'flex-start', marginBottom: 14,
            background: testActiv && ramas != null ? 'rgba(232,185,49,.16)' : 'var(--cream)',
            border: `1px solid ${testActiv && ramas != null ? 'var(--gold)' : 'var(--border)'}`,
            borderRadius: 10, padding: '10px 12px',
          }}>
            <span style={{ fontSize: '1.05rem', lineHeight: 1 }}>⏳</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: '.85rem', fontWeight: 700, color: 'var(--navy)' }}>
                {testActiv && ramas != null
                  ? <>Timp rămas: <span style={{ fontVariantNumeric: 'tabular-nums', color: ramas <= 300000 ? '#c62828' : 'var(--navy)' }}>{fmtRamas(ramas)}</span></>
                  : <>Ai {fmtDurata(data.timeLimitMin)} de lucru</>}
              </div>
              <div style={{ fontSize: '.78rem', color: 'var(--text-muted)', marginTop: 2 }}>
                Cronometrul pornește când apeși „Începe testul" și merge mai departe chiar dacă închizi
                pagina. La zero, testul se închide singur și ajunge la profesor ce ai apucat să trimiți.
              </div>
            </div>
          </div>
        )}
        {data.timeLimitMin > 0 && data.preview && (
          <div style={{ fontSize: '.82rem', color: 'var(--text-muted)', marginBottom: 14 }}>
            ⏳ Elevii au <strong>{fmtDurata(data.timeLimitMin)}</strong> de lucru, din momentul în care apasă „Începe testul".
          </div>
        )}

        {data.timedOut && !data.preview && (
          <div style={{ marginBottom: 14, padding: '10px 12px', borderRadius: 8, background: 'rgba(198,40,40,.08)', border: '1px solid rgba(198,40,40,.35)', color: '#8a3b3b', fontWeight: 600, fontSize: '.86rem' }}>
            ⏰ Timpul de lucru a expirat — testul s-a încheiat.
          </div>
        )}

        {startable && (
          <button className="btn btn-primary" onClick={start}>
            {t.type === 'exam' ? '🖨 Deschide subiectul' : t.type === 'pdf-file' ? '📄 Deschide PDF-ul' : '▶ Începe testul'}
          </button>
        )}

        {/* Mesageria, oprită pe durata testului */}
        {!data.preview && !data.result && startable && (
          <div style={{
            marginTop: 14, display: 'flex', gap: 10, alignItems: 'flex-start',
            background: testActiv ? 'rgba(198,40,40,.07)' : 'var(--cream)',
            border: `1px solid ${testActiv ? 'rgba(198,40,40,.35)' : 'var(--border)'}`,
            borderRadius: 10, padding: '10px 12px',
          }}>
            <span style={{ fontSize: '1.05rem', lineHeight: 1 }}>🔒</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: '.83rem', fontWeight: 700, color: testActiv ? '#8a3b3b' : 'var(--navy)' }}>
                {testActiv
                  ? 'Mesageria și Profesorul Virtual sunt oprite — ai testul în desfășurare'
                  : 'Cât timp rezolvi testul, mesageria și Profesorul Virtual se opresc automat'}
              </div>
              <div style={{ fontSize: '.78rem', color: 'var(--text-muted)', marginTop: 2 }}>
                Nu poți trimite mesaje (nici pe canalul grupei, nici colegilor) și nu îi poți cere ajutor
                Profesorului Virtual. La testele PDF poți totuși folosi „📝 Răspunde în chat" ca să-ți
                trimiți răspunsurile spre corectare. Totul repornește când trimiți rezultatul.
              </div>
              {testActiv && (
                <button className="btn btn-sm btn-outline" style={{ marginTop: 8 }} onClick={endTest}>
                  ✓ Am terminat testul — repornește mesageria și profesorul
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      <div style={{ fontSize: '.8rem', color: 'var(--text-muted)' }}>
        Rezultatul tău ajunge automat la profesor.{' '}
        <Link to="/profil" style={{ color: 'var(--navy)', fontWeight: 600 }}>Contul meu →</Link>
      </div>
    </div>
  );
}
