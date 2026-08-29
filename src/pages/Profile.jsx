import { authHeaders } from '../lib/api';
import { aiClient } from '../lib/aiClient';
import { useEffect, useRef, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { aiAssistantLabel } from '../lib/aiLabel';
import { supabase } from '../lib/supabase';
import { assignTeacherCode } from '../lib/teacherCode';
import RoleChooser from '../components/RoleChooser';
import EinsteinIcon from '../components/EinsteinIcon';
import TeacherResults from '../components/TeacherResults';
import AITeacherReport from '../components/AITeacherReport';
import GroupAssignment from '../components/GroupAssignment';
import ParentAIActivity from '../components/ParentAIActivity';
import AccountSettings from '../components/AccountSettings';
import AILimite from '../components/AILimite';
import Mesagerie from '../components/Mesagerie';
import ColegiiMei from '../components/ColegiiMei';
import TemeNefacute from '../components/TemeNefacute';
import { getMyBadges } from '../lib/badges';
import { notaDinScor } from '../lib/nota';
import { trackPurchase } from '../lib/analytics';
import { SiteReviewForm } from '../components/ReviewWidget';

// ─── Rezultatele ELEVULUI: testele și exercițiile rezolvate de el ────────────
// Din `progress` (teste interactive + teste PDF corectate de Prof. Virtual) și
// din `ai_pdf_results` (poze / PDF-uri încărcate în chat) — ambele protejate
// de RLS (elevul își vede doar propriile rânduri). Lângă fiecare exercițiu se
// menționează în paranteză dacă e (interactiv) sau (PDF).
function MyResults({ user }) {
  const [rows, setRows] = useState(null);
  const loadedRef = useRef(false);

  useEffect(() => {
    if (!user?.id || loadedRef.current) return;
    loadedRef.current = true;
    (async () => {
      const out = [];
      try {
        const { data: prog } = await supabase.from('progress')
          .select('*').eq('user_id', user.id)
          .order('completed_at', { ascending: false }).limit(120);
        const ids = [...new Set((prog || []).map((p) => p.content_id).filter(Boolean))];
        const titleMap = {};
        if (ids.length) {
          try {
            const { data: cont } = await supabase.from('content')
              .select('id, title, content_type, category').in('id', ids);
            (cont || []).forEach((c) => { titleMap[c.id] = c; });
          } catch { /* titlurile lipsă cad pe snapshot */ }
        }
        (prog || []).forEach((p) => {
          const c = titleMap[p.content_id] || {};
          out.push({
            id: 'pr-' + (p.id || p.content_id),
            title: c.title || p.test_title || 'Test',
            type: c.content_type || p.content_type || 'interactive',
            score: p.score, max: p.max_score,
            attempts: p.attempts || 1, time: p.time_spent || 0,
            at: p.completed_at,
          });
        });
      } catch { /* fără progres încă */ }
      try {
        const { data: pdfr } = await supabase.from('ai_pdf_results')
          .select('id, title, category, score, max_score, attempts, time_spent, completed_at, content_id')
          .eq('user_id', user.id)
          .is('content_id', null)
          .order('completed_at', { ascending: false }).limit(60);
        (pdfr || []).forEach((r) => {
          out.push({
            id: 'up-' + r.id,
            title: r.title || 'Exercițiu corectat de Prof. Virtual',
            type: 'pdf', upload: true,
            score: Number(r.score) || 0, max: Number(r.max_score) || 0,
            attempts: r.attempts || 1, time: r.time_spent || 0,
            at: r.completed_at,
          });
        });
      } catch { /* tabelul apare după rularea supabase/corectare_pdf.sql */ }
      out.sort((a, b) => new Date(b.at || 0) - new Date(a.at || 0));
      setRows(out);
    })();
  }, [user?.id]);

  const fmtT = (sec) => {
    if (!sec || sec <= 0) return '—';
    const m = Math.floor(sec / 60), s = sec % 60;
    return m === 0 ? `${s}s` : s === 0 ? `${m} min` : `${m} min ${s}s`;
  };
  const pct = (s, m) => (m ? Math.round((s / m) * 100) : 0);
  const col = (p) => (p >= 80 ? '#2e7d32' : p >= 50 ? '#e65100' : '#c62828');

  return (
    <details className="card" style={{ marginBottom: 24 }} open={false}>
      <summary style={{ cursor: 'pointer', fontWeight: 700, color: 'var(--navy)', fontFamily: 'var(--font-display)', fontSize: '1.05rem', listStyle: 'none' }}>
        📊 Rezultatele mele — teste și exerciții rezolvate{rows ? ` (${rows.length})` : ''}
      </summary>
      <div style={{ marginTop: 14 }}>
        {rows === null && <p style={{ color: 'var(--text-muted)', fontSize: '.88rem' }}>Se încarcă…</p>}
        {rows !== null && rows.length === 0 && (
          <p style={{ color: 'var(--text-muted)', fontSize: '.88rem' }}>
            Încă nu ai rezultate. Rezolvă un test interactiv sau corectează-ți un test PDF cu „Răspunde în chat" la Profesorul Virtual.
          </p>
        )}
        {rows !== null && rows.length > 0 && (
          <div style={{ overflowX: 'auto', maxWidth: '100%' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.84rem', minWidth: 520 }}>
              <thead>
                <tr style={{ textAlign: 'left', color: 'var(--text-muted)' }}>
                  <th style={{ padding: '6px 10px', fontWeight: 700 }}>Test sau exercițiu</th>
                  <th style={{ padding: '6px 10px', fontWeight: 700, textAlign: 'right', whiteSpace: 'nowrap' }}>Punctaj</th>
                  <th style={{ padding: '6px 10px', fontWeight: 700, textAlign: 'right', whiteSpace: 'nowrap' }}>Nr. încercări</th>
                  <th style={{ padding: '6px 10px', fontWeight: 700, textAlign: 'right', whiteSpace: 'nowrap' }}>Timp</th>
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, 60).map((r) => {
                  const p = pct(r.score, r.max);
                  const nota = notaDinScor(r.score, r.max);
                  return (
                    <tr key={r.id} style={{ borderTop: '1px solid var(--border)' }}>
                      <td style={{ padding: '7px 10px' }}>
                        <span style={{ color: 'var(--text)', fontWeight: 500 }}>
                          {r.title}{' '}
                          <span style={{ color: 'var(--text-muted)', fontWeight: 600, fontSize: '.74rem' }}>
                            ({r.type === 'interactive' ? 'interactiv' : r.type === 'pdf' ? 'PDF' : r.type})
                          </span>
                        </span>
                        <span style={{ display: 'block', fontSize: '.7rem', color: 'var(--text-muted)', marginTop: 2 }}>
                          {r.upload ? 'încărcat de tine în chat · ' : ''}{r.at ? new Date(r.at).toLocaleDateString('ro-RO', { day: '2-digit', month: 'short', year: 'numeric' }) : ''}
                        </span>
                      </td>
                      <td style={{ padding: '7px 10px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                        <span style={{ fontWeight: 700, color: col(p) }}>{r.score}/{r.max}</span>
                        <span style={{ color: col(p), fontSize: '.74rem', marginLeft: 5 }}>({p}%)</span>
                        {nota != null && (
                          <span style={{ display: 'block', fontSize: '.72rem', fontWeight: 700, color: '#8a6d00', marginTop: 2 }} title="Nota include 10 puncte din oficiu">
                            nota {nota}
                          </span>
                        )}
                      </td>
                      <td style={{ padding: '7px 10px', textAlign: 'right', color: 'var(--text)' }}>{r.attempts}</td>
                      <td style={{ padding: '7px 10px', textAlign: 'right', color: 'var(--text)', whiteSpace: 'nowrap' }}>{fmtT(r.time)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </details>
  );
}

export default function Profile() {
  const { user, profile, isPremium, isTeacher, isParent, isMentor, signOut, loading, fetchProfile } = useAuth();
  const navigate = useNavigate();
  const [checkoutSuccess, setCheckoutSuccess] = useState(false);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [deleteError, setDeleteError] = useState('');
  const [roleBusy, setRoleBusy] = useState(false);
  const [roleError, setRoleError] = useState('');
  const [roleSelected, setRoleSelected] = useState(null);
  const [assocBanner, setAssocBanner] = useState('');
  const [showRoleSwitch, setShowRoleSwitch] = useState(false);
  const [myMentors, setMyMentors] = useState([]);
  // Rolldown-ul „⚡ Consum AI" pornește deschis la întoarcerea de la plata
  // unui pachet AI (Stripe redirecționează către /profil?topup=...).
  const [aiConsumOpen] = useState(() => {
    try { return new URLSearchParams(window.location.search).has('topup'); }
    catch { return false; }
  });
  // Rolldown-ul „💬 Mesagerie" pornește deschis când vii dintr-o notificare de
  // mesaj nou (/profil?mesagerie=1).
  const [chatOpen] = useState(() => {
    try { return new URLSearchParams(window.location.search).has('mesagerie'); }
    catch { return false; }
  });
  // „👥 Lista persoane" pornește deschis când vii dintr-o cerere de coleg
  // (/profil?colegi=1).
  const [colegiOpen] = useState(() => {
    try { return new URLSearchParams(window.location.search).has('colegi'); }
    catch { return false; }
  });
  const onboardingRan = useRef(false);
  const codeEnsured = useRef(false);
  // Citit o singură dată la montare: dacă există un tip de cont în așteptare
  // (înregistrare prin OAuth), nu afișăm selectorul cât timp se aplică.
  const [pendingTypeFlag] = useState(() => {
    try {
      const t = localStorage.getItem('pending_account_type');
      return t === 'elev' || t === 'profesor' || t === 'parinte';
    } catch { return false; }
  });

  const needsRole = !!profile && !profile.role && !pendingTypeFlag;

  // Insignele elevului (gamificare — exerciții interactive + Prof. Virtual)
  const [myBadges, setMyBadges] = useState([]);
  useEffect(() => {
    if (!user || isMentor) return;
    getMyBadges(user.id).then(setMyBadges).catch(() => {});
  }, [user, isMentor]);

  // Scrie rolul în baza de date (fără gestionarea stării UI).
  async function persistRole(role) {
    if (role === 'profesor' || role === 'parinte') {
      // Păstrează codul existent (nu invalidăm linkul deja trimis).
      if (profile?.teacher_code) {
        const { error } = await supabase
          .from('profiles')
          .update({ role })
          .eq('id', user.id);
        if (error) throw error;
      } else {
        await assignTeacherCode(user.id, { role });
      }
    } else {
      const { error } = await supabase
        .from('profiles')
        .update({ role: 'elev' })
        .eq('id', user.id);
      if (error) throw error;
    }
  }

  // Persistă alegerea tipului de cont (o singură dată, la prima logare).
  async function chooseRole(role) {
    if (!user || roleBusy) return;
    setRoleBusy(true); setRoleSelected(role); setRoleError('');
    try {
      await persistRole(role);
      await fetchProfile(user.id);
      setShowRoleSwitch(false);
    } catch (e) {
      setRoleError(e.message || 'A apărut o eroare. Încearcă din nou.');
    } finally {
      setRoleBusy(false);
      setRoleSelected(null);
    }
  }

  // Onboarding după autentificare: tip cont în așteptare (OAuth) + asociere în așteptare.
  useEffect(() => {
    if (loading || !user || !profile || onboardingRan.current) return;

    let pendingType = null;
    let pendingCode = null;
    try {
      pendingType = localStorage.getItem('pending_account_type');
      pendingCode = localStorage.getItem('pending_teacher_code');
    } catch { /* ignore */ }

    const applyType = !profile.role && (pendingType === 'elev' || pendingType === 'profesor' || pendingType === 'parinte');
    if (!applyType && !pendingCode) return;

    onboardingRan.current = true;
    (async () => {
      let changed = false;

      // 1) Aplică tipul de cont ales la înregistrarea prin OAuth.
      if (applyType) {
        try {
          await persistRole(pendingType);
          changed = true;
          try { localStorage.removeItem('pending_account_type'); } catch { /* ignore */ }
        } catch { /* păstrăm pentru reîncercare la următoarea încărcare */ }
      }

      // 2) Aplică asocierea cu profesorul (link accesat înainte de logare).
      if (pendingCode) {
        try {
          const res = await fetch('/api/asociere', {
            method: 'POST',
            headers: await authHeaders(),
            body: JSON.stringify({ userId: user.id, code: pendingCode }),
          });
          const data = await res.json();
          try { localStorage.removeItem('pending_teacher_code'); } catch { /* ignore */ }
          if (res.ok) {
            const nm = data.mentor_name || data.teacher_name || '';
            const prefix = data.mentor_role === 'parinte' ? '' : 'Prof. ';
            setAssocBanner(`Ai fost asociat cu ${prefix}${nm}`.trim() + '.');
            changed = true;
          }
        } catch { /* ignore */ }
      }

      if (changed) await fetchProfile(user.id);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, user, profile]);

  // Profesor fără cod → generează unul (cont creat înainte de existența funcției).
  useEffect(() => {
    if (!user || !profile) return;
    if ((profile.role === 'profesor' || profile.role === 'parinte') && !profile.teacher_code && !codeEnsured.current) {
      codeEnsured.current = true;
      (async () => {
        try {
          await assignTeacherCode(user.id, { role: profile.role });
          await fetchProfile(user.id);
        } catch { /* ignore */ }
      })();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, profile]);

  useEffect(() => {
    if (!loading && !user) {
      navigate('/autentificare');
    }
  }, [user, loading, navigate]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('session_id') && user) {
      setCheckoutSuccess(true);

      // ── Conversia, măsurată o singură dată ──────────────────────────────
      // Reîncărcarea paginii de mulțumire nu trebuie să numere a doua oară
      // aceeași abonare, de aceea ținem minte session_id-ul deja raportat.
      const sid = params.get('session_id');
      try {
        const cheie = `em_purchase_${sid}`;
        if (!sessionStorage.getItem(cheie)) {
          sessionStorage.setItem(cheie, '1');
          trackPurchase({
            plan: params.get('plan') || 'lunar',
            valueLei: parseFloat(params.get('val') || '0') || undefined,
            transactionId: sid,
            trial: params.get('proba') === '1',
          });
        }
      } catch { /* sessionStorage blocat → raportăm oricum */ }

      window.history.replaceState({}, '', '/profil');
      // Webhook-ul Stripe scrie subscription_status='active' ASINCRON și adesea
      // întârzie față de redirect. Reîncărcăm profilul de câteva ori până devine
      // „active" (sau renunțăm după ~14s), ca utilizatorul care tocmai a plătit
      // să NU rămână pe „Cont gratuit".
      let stop = false;
      (async () => {
        for (let i = 0; i < 7 && !stop; i++) {
          const p = await fetchProfile(user.id);
          if (p?.subscription_status === 'active') break;
          await new Promise((r) => setTimeout(r, 2000));
        }
      })();
      return () => { stop = true; };
    }
  }, [user, fetchProfile]);

  // Mentorii (profesori/părinți) cu care e asociat elevul
  useEffect(() => {
    if (!user?.id) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/teacher-manage', {
          method: 'POST', headers: await authHeaders(),
          body: JSON.stringify({ userId: user.id, action: 'my_mentors' }),
        });
        const json = await res.json();
        if (!cancelled && res.ok) setMyMentors(json.mentors || []);
      } catch { /* ignore */ }
    })();
    return () => { cancelled = true; };
  }, [user?.id, assocBanner]);

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '60vh' }}>
        <div className="spinner" />
      </div>
    );
  }

  if (!user) {
    return null;
  }

  const avatarUrl = user.user_metadata?.avatar_url || user.user_metadata?.picture || null;
  const displayName = profile?.full_name
    || user.user_metadata?.name
    || user.user_metadata?.full_name
    || 'Utilizator';
  const initials = displayName === 'Utilizator'
    ? (user.email?.[0] || '?').toUpperCase()
    : displayName.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);

  async function handleManageSubscription() {
    try {
      const response = await fetch('/api/create-portal', {
        method: 'POST',
        headers: await authHeaders(),
        body: JSON.stringify({ userId: user.id }),
      });

      if (!response.ok) {
        throw new Error(`Server error: ${response.status}`);
      }

      const { url, error } = await response.json();
      if (error) throw new Error(error);
      if (url) window.location.href = url;
    } catch (err) {
      console.error('Portal error:', err);
      alert('A apărut o eroare la deschiderea portalului. Încearcă din nou.');
    }
  }

  async function handleSignOut() {
    await signOut();
    navigate('/');
  }

  async function handleDeleteAccount() {
    const confirmed = window.confirm(
      'Ești sigur că vrei să îți ștergi contul? Această acțiune este ireversibilă.'
    );
    if (!confirmed) return;
    const doubleConfirmed = window.confirm(
      'Ultima confirmare: contul și toate datele vor fi șterse permanent. Continui?'
    );
    if (!doubleConfirmed) return;

    setDeleteLoading(true);
    setDeleteError('');
    try {
      // Prin API (nu prin RPC): serverul arhivează întâi rezultatele elevului
      // pentru profesorii/părinții asociați, apoi șterge contul definitiv.
      await aiClient.accountDelete();
      await signOut();
      navigate('/');
    } catch (err) {
      console.error('Delete account error:', err);
      setDeleteError('A apărut o eroare. Contactează suportul la admin.examenmate@gmail.com.');
      setDeleteLoading(false);
    }
  }

  return (
    <section className="profile-section">
      <div className="container">

        {checkoutSuccess && (
          <div style={{
            background: '#e8f5e9',
            color: '#2e7d32',
            padding: '16px 24px',
            borderRadius: 'var(--radius)',
            marginBottom: 24,
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            fontWeight: 500
          }}>
            <span style={{ fontSize: '1.3rem' }}>🎉</span>
            <span>Abonamentul tău Premium a fost activat! Acum ai acces complet la toate materialele.</span>
          </div>
        )}

        {assocBanner && (
          <div style={{
            background: '#e8f5e9', color: '#2e7d32', padding: '14px 22px',
            borderRadius: 'var(--radius)', marginBottom: 24, display: 'flex',
            alignItems: 'center', gap: 12, fontWeight: 500,
          }}>
            <span style={{ fontSize: '1.2rem' }}>🤝</span>
            <span>{assocBanner}</span>
          </div>
        )}

        {/* Profesor Virtual (AI Tutor) */}
        <div style={{
          background: 'linear-gradient(120deg, var(--navy), #163a5a)', color: '#fff',
          borderRadius: 'var(--radius-lg, 16px)', padding: '20px 24px', marginBottom: 24,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <EinsteinIcon size={44} />
            <div>
              <div style={{ fontWeight: 700, fontSize: '1.1rem', fontFamily: 'var(--font-display)' }}>{aiAssistantLabel({ isTeacher, isParent })}</div>
              <div style={{ fontSize: '.85rem', opacity: 0.82 }}>
                {isPremium
                  ? 'Explicații, exerciții, foto-rezolvare, voce și teste de examen în PDF.'
                  : 'Asistentul tău AI. Ai 2 încercări gratuite; abonează-te pentru acces complet.'}
              </div>
            </div>
          </div>
          <Link to="/profesor-virtual" className="btn" style={{ background: 'var(--gold)', color: 'var(--navy)', fontWeight: 700, whiteSpace: 'nowrap' }}>
            Deschide AI Tutor →
          </Link>
        </div>

        <div className="profile-grid">
          {/* Sidebar */}
          <div className="profile-sidebar">
            <div className="card">
              {avatarUrl ? (
                <img
                  src={avatarUrl}
                  alt="Avatar"
                  className="profile-avatar"
                  style={{ objectFit: 'cover', padding: 0 }}
                  onError={e => { e.currentTarget.style.display = 'none'; e.currentTarget.nextSibling.style.display = 'flex'; }}
                />
              ) : null}
              <div className="profile-avatar" style={{ display: avatarUrl ? 'none' : 'flex' }}>{initials}</div>
              <h3 style={{ fontFamily: 'var(--font-display)', marginBottom: 2 }}>
                {displayName}
              </h3>
              {profile?.role && (
                <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginBottom: 4 }}>
                  ({profile.role === 'profesor' ? 'profesor' : profile.role === 'parinte' ? 'părinte' : 'elev'})
                </div>
              )}
              <p style={{ color: 'var(--text-muted)', fontSize: '0.88rem' }}>
                {user.email}
              </p>
              {profile?.role && (
                <div style={{ marginTop: 8 }}>
                  <button
                    onClick={() => setShowRoleSwitch(true)}
                    style={{
                      background: 'none', border: 'none', cursor: 'pointer',
                      color: 'var(--navy)', fontSize: '0.78rem', fontWeight: 600,
                      textDecoration: 'underline', padding: 0,
                    }}
                  >
                    Schimbă tipul contului
                  </button>
                </div>
              )}
              <div className={`subscription-badge ${isPremium ? 'premium' : 'free'}`} style={{ marginTop: 12 }}>
                {isPremium ? '⭐ Premium' : 'Cont gratuit'}
              </div>
              {myMentors.length > 0 && (
                <div style={{
                  marginTop: 14, fontSize: '0.82rem', color: 'var(--navy)',
                  background: 'var(--cream)', borderRadius: 8, padding: '9px 12px', textAlign: 'left',
                }}>
                  <div style={{ fontWeight: 700, marginBottom: 4 }}>Asociat cu:</div>
                  {myMentors.some((m) => m.role === 'profesor') && (
                    <div>🧑‍🏫 {myMentors.filter((m) => m.role === 'profesor').map((m) => m.name).join(', ')}</div>
                  )}
                  {myMentors.some((m) => m.role === 'parinte') && (
                    <div style={{ marginTop: 4 }}>👨‍👩‍👧 {myMentors.filter((m) => m.role === 'parinte').map((m) => m.name).join(', ')}</div>
                  )}
                </div>
              )}
            </div>

            {/* Lista persoane — sub cartonașul cu numele și tipul contului.
                Pe desktop: fereastră cu câteva nume și derulare pentru rest.
                Pe mobil: același conținut, ca tab cu rolldown. */}
            <ColegiiMei defaultOpen={colegiOpen} />
          </div>

          {/* Main */}
          <div style={{ minWidth: 0 }}>
            {/* Subscription */}
            <div className="card" style={{ marginBottom: 24 }}>
              <h3 style={{ fontFamily: 'var(--font-display)', marginBottom: 16 }}>Abonament</h3>
              {isPremium ? (
                <div>
                  <div style={{
                    background: '#e8f5e9',
                    color: '#2e7d32',
                    padding: '16px 20px',
                    borderRadius: 'var(--radius)',
                    marginBottom: 16,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 12
                  }}>
                    <span style={{ fontSize: '1.3rem' }}>⭐</span>
                    <div>
                      <strong>Abonament Premium activ</strong>
                      <br />
                      <span style={{ fontSize: '0.85rem', opacity: 0.8 }}>Ai acces complet la toate materialele</span>
                    </div>
                  </div>
                  <button className="btn btn-outline btn-sm" onClick={handleManageSubscription}>
                    Gestionează abonamentul
                  </button>
                </div>
              ) : (
                <div>
                  <p style={{ color: 'var(--text-light)', marginBottom: 16 }}>
                    Ai acces doar la exercițiile PDF gratuite. Abonează-te pentru acces complet la toate materialele.
                  </p>
                  <Link to="/preturi" className="btn btn-primary btn-sm">
                    Vezi abonamentul
                  </Link>
                </div>
              )}
            </div>

            {/* Mesageria GRUPEI — imediat SUB „Abonament", ca rolldown, pentru
                TOATE tipurile de cont (elev / profesor / părinte). Doar canalul
                grupei: profesorul, elevii ei și părinții acelor elevi, cu rolul
                scris în paranteză. Discuțiile 1-la-1 sunt separate, cu colegii
                de pe tot site-ul → pagina /mesagerie. */}
            <details className="card" style={{ marginBottom: 24 }} open={chatOpen || undefined}>
              <summary style={{ cursor: 'pointer', fontWeight: 700, color: 'var(--navy)', fontFamily: 'var(--font-display)', fontSize: '1.05rem', listStyle: 'none' }}>
                💬 Mesageria grupei
                <span style={{ fontWeight: 500, fontSize: '.82rem', color: 'var(--text-muted)', marginLeft: 8 }}>
                  — profesor, elevi și părinți
                </span>
              </summary>
              <div style={{ marginTop: 16 }}>
                <Mesagerie scope="group" />
                <p style={{ fontSize: '.78rem', color: 'var(--text-muted)', marginTop: 10 }}>
                  Aici se scrie doar pe canalul grupei. Pentru discuții 1-la-1, adaugă-ți colegi din
                  „👥 Lista persoane" și deschide <Link to="/mesagerie" style={{ color: 'var(--navy)', fontWeight: 600 }}>💬 Mesageria</Link>.
                </p>
              </div>
            </details>

            {/* Consum AI — după Abonament, ca rolldown, pentru TOATE rolurile
                (elev / profesor / părinte): cote per funcție, buget lunar și
                pachete suplimentare. Se deschide singur la întoarcerea de la
                plata unui pachet (?topup=succes / ?topup=anulat). */}
            <details className="card" style={{ marginBottom: 24 }} open={aiConsumOpen || undefined}>
              <summary style={{ cursor: 'pointer', fontWeight: 700, color: 'var(--navy)', fontFamily: 'var(--font-display)', fontSize: '1.05rem', listStyle: 'none' }}>
                ⚡ Consum AI
              </summary>
              <div style={{ marginTop: 16 }}>
                <AILimite bare />
              </div>
            </details>

            {/* Insignele elevului (gamificare) */}
            {!isMentor && (
              <div className="card" style={{ marginBottom: 24 }}>
                <h3 style={{ fontFamily: 'var(--font-display)', marginBottom: 12 }}>🏅 Insignele mele</h3>
                {myBadges.length === 0 ? (
                  <p style={{ color: 'var(--text-light)', fontSize: '.9rem' }}>
                    Încă nu ai insigne. Rezolvă exerciții interactive — Profesorul Virtual te premiază pentru fiecare reușită! 🎯
                  </p>
                ) : (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
                    {myBadges.map((b) => (
                      <div key={b.id} title={b.desc} style={{
                        display: 'flex', alignItems: 'center', gap: 8,
                        border: '1.5px solid var(--gold)', background: 'rgba(232,185,49,.08)',
                        borderRadius: 12, padding: '8px 12px',
                      }}>
                        <span style={{ fontSize: '1.4rem' }}>{b.icon}</span>
                        <div>
                          <div style={{ fontWeight: 700, fontSize: '.85rem', color: 'var(--navy)' }}>{b.name}</div>
                          <div style={{ fontSize: '.72rem', color: 'var(--text-muted)' }}>
                            {new Date(b.earned_at).toLocaleDateString('ro-RO')}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Teme nefăcute — DEASUPRA „Rezultatele mele"; apare doar dacă
                elevul e asociat cu un profesor (componenta se ascunde singură
                când nu are mentor). */}
            {!isMentor && <TemeNefacute />}

            {/* Rezultatele ELEVULUI: testele și exercițiile rezolvate de el
                (interactive + PDF corectate de Prof. Virtual) */}
            {!isMentor && <MyResults user={user} />}

            {/* Rezultate elevi — pentru profesori și părinți, sub Abonament */}
            {isMentor && (
              <TeacherResults
                user={user}
                inviteCode={profile?.teacher_code}
                displayName={displayName}
                role={profile?.role}
              />
            )}

            {/* Test pe grupă: un link, teste DIFERITE pentru fiecare elev.
                Aceeași funcție e și în „Asistent AI", după „Testele și
                exercițiile mele" (src/pages/ProfesorVirtual.jsx). */}
            {isTeacher && (
              <details className="card" style={{ marginBottom: 24 }}>
                <summary style={{ cursor: 'pointer', fontWeight: 700, color: 'var(--navy)', fontFamily: 'var(--font-display)', fontSize: '1.05rem', listStyle: 'none', display: 'flex', alignItems: 'center', gap: 8 }}>
                  👥 Test pe grupă — fiecare elev primește alt test
                </summary>
                <div style={{ marginTop: 16 }}>
                  <GroupAssignment />
                </div>
              </details>
            )}

            {/* Raport AI — după „Rezultate elevi", ca rolldown */}
            {isTeacher && (
              <details className="card" style={{ marginBottom: 24 }}>
                <summary style={{ cursor: 'pointer', fontWeight: 700, color: 'var(--navy)', fontFamily: 'var(--font-display)', fontSize: '1.05rem', listStyle: 'none', display: 'flex', alignItems: 'center', gap: 8 }}>
                  <EinsteinIcon size={24} /> Raport AI – activități cu Prof. Virtual
                </summary>
                <div style={{ marginTop: 16 }}>
                  <div style={{ background: 'rgba(232,185,49,.1)', border: '1px solid var(--gold)', borderRadius: 10, padding: '12px 14px', marginBottom: 16, fontSize: '.88rem', color: 'var(--navy)' }}>
                    💡 <strong>Sfat:</strong> generează cu Profesorul Virtual exerciții de antrenament sau exerciții interactive și trimite-le elevilor spre rezolvare (butonul „Trimite elevilor"). Rezultatele lor apar aici, în raport, ca să vezi cine a lucrat și cum s-a descurcat.
                  </div>
                  <AITeacherReport />
                  <div style={{ marginTop: 20 }}>
                    <h4 style={{ fontFamily: 'var(--font-display)', color: 'var(--navy)', marginBottom: 6 }}>Activitatea pe elev — inclusiv 🎓 Meditații cu Prof. Virtual</h4>
                    <p style={{ fontSize: '.8rem', color: 'var(--text-muted)', marginBottom: 10 }}>
                      Pentru fiecare elev asociat: progresul din meditații (plan, timp de studiu, capitole finalizate, dificultăți și recomandări), materialele generate și temele rezolvate.
                    </p>
                    <ParentAIActivity />
                  </div>
                </div>
              </details>
            )}
            {isParent && (
              <details className="card" style={{ marginBottom: 24 }}>
                <summary style={{ cursor: 'pointer', fontWeight: 700, color: 'var(--navy)', fontFamily: 'var(--font-display)', fontSize: '1.05rem', listStyle: 'none', display: 'flex', alignItems: 'center', gap: 8 }}>
                  <EinsteinIcon size={24} /> Raport AI – activități cu Prof. Virtual
                </summary>
                <div style={{ marginTop: 16 }}>
                  <ParentAIActivity />
                </div>
              </details>
            )}

            {/* Părerea despre ExamenMate — toate tipurile de cont; apare public
                după aprobare în Admin → ⭐ Recenzii (src/components/ReviewWidget.jsx) */}
            <div className="card" style={{ marginBottom: 24 }}>
              <h3 style={{ fontFamily: 'var(--font-display)', marginBottom: 6 }}>⭐ Părerea ta despre ExamenMate</h3>
              <p style={{ fontSize: '.84rem', color: 'var(--text-muted)', marginBottom: 12 }}>
                Cum te ajută platforma? Recenzia ta ajunge la noi și, după verificare, pe pagina principală.{' '}
                <Link to="/recenzii" style={{ color: 'var(--navy)', fontWeight: 600 }}>Vezi toate recenziile →</Link>
              </p>
              <SiteReviewForm compact />
            </div>

            {/* Setări cont — toate tipurile de cont */}
            <details className="card" style={{ marginBottom: 24 }}>
              <summary style={{ cursor: 'pointer', fontWeight: 700, color: 'var(--navy)', fontFamily: 'var(--font-display)', fontSize: '1.05rem', listStyle: 'none' }}>
                ⚙️ Setări cont
              </summary>
              <div style={{ marginTop: 16 }}>
                <AccountSettings />
              </div>
            </details>

            {/* Quick links */}
            <div className="card">
              <h3 style={{ fontFamily: 'var(--font-display)', marginBottom: 16 }}>Accesează materialele</h3>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 12 }}>
                {[
                  { to: '/evaluare-nationala', label: 'Evaluare Națională', icon: '📝' },
                  { to: '/bacalaureat', label: 'Bacalaureat', icon: '🎓' },
                  { to: '/clase/5',  label: 'Clasa a V-a',    icon: '5️⃣' },
                  { to: '/clase/6',  label: 'Clasa a VI-a',   icon: '6️⃣' },
                  { to: '/clase/7',  label: 'Clasa a VII-a',  icon: '7️⃣' },
                  { to: '/clase/8',  label: 'Clasa a VIII-a', icon: '8️⃣' },
                  { to: '/clase/9',  label: 'Clasa a IX-a',   icon: '9️⃣' },
                  { to: '/clase/10', label: 'Clasa a X-a',    icon: '🔟' },
                  { to: '/clase/11', label: 'Clasa a XI-a',   icon: '📘' },
                  { to: '/clase/12', label: 'Clasa a XII-a',  icon: '📗' },
                  { to: '/manuale', label: 'Manuale Online', icon: '📖' },
                  { to: '/biblioteca-utilizatorilor', label: 'Biblioteca utilizatorilor', icon: '🏛️' },
                ].map(item => (
                  <Link
                    key={item.to}
                    to={item.to}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 10,
                      padding: '12px 16px',
                      background: 'var(--cream)',
                      borderRadius: 'var(--radius)',
                      fontSize: '0.9rem',
                      fontWeight: 500,
                      transition: 'all 0.2s',
                    }}
                  >
                    <span>{item.icon}</span> {item.label}
                  </Link>
                ))}
              </div>
            </div>

            {/* Logout */}
            <div style={{ marginTop: 24, display: 'flex', flexDirection: 'column', gap: 12 }}>
              <button className="btn btn-outline btn-sm" onClick={handleSignOut}>
                Deconectare
              </button>
              <div style={{ borderTop: '1px solid var(--border)', paddingTop: 16 }}>
                <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: 10 }}>
                  <strong style={{ color: 'var(--danger)' }}>Zonă periculoasă</strong>
                </div>
                {deleteError && (
                  <div style={{ background: '#fce4ec', color: 'var(--danger)', padding: '10px 14px', borderRadius: 8, fontSize: '0.83rem', marginBottom: 10 }}>
                    {deleteError}
                  </div>
                )}
                <button
                  onClick={handleDeleteAccount}
                  disabled={deleteLoading}
                  style={{
                    padding: '8px 18px', borderRadius: 8, fontWeight: 600, fontSize: '0.85rem',
                    background: 'transparent', color: 'var(--danger)',
                    border: '1.5px solid var(--danger)', cursor: 'pointer',
                    opacity: deleteLoading ? 0.6 : 1,
                  }}
                >
                  {deleteLoading ? 'Se șterge...' : '🗑 Șterge contul'}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {needsRole && (
        <RoleChooser
          onSelect={chooseRole}
          busy={roleBusy}
          error={roleError}
          selected={roleSelected}
        />
      )}

      {showRoleSwitch && !needsRole && (
        <RoleChooser
          onSelect={chooseRole}
          busy={roleBusy}
          error={roleError}
          selected={roleSelected}
          current={profile?.role}
          onCancel={roleBusy ? undefined : () => { setShowRoleSwitch(false); setRoleError(''); }}
          title="Schimbă tipul contului"
          subtitle="Poți comuta oricând între Elev, Profesor și Părinte. Linkul tău de invitație rămâne neschimbat."
        />
      )}
    </section>
  );
}
