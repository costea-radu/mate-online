import { useEffect, useRef, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../lib/supabase';
import { assignTeacherCode } from '../lib/teacherCode';
import RoleChooser from '../components/RoleChooser';
import TeacherResults from '../components/TeacherResults';

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
            headers: { 'Content-Type': 'application/json' },
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
      window.history.replaceState({}, '', '/profil');
      fetchProfile(user.id);
    }
  }, [user, fetchProfile]);

  // Mentorii (profesori/părinți) cu care e asociat elevul
  useEffect(() => {
    if (!user?.id) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/teacher-manage', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
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
        headers: { 'Content-Type': 'application/json' },
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
      const { error } = await supabase.rpc('delete_user_account');
      if (error) throw error;
      await signOut();
      navigate('/');
    } catch (err) {
      console.error('Delete account error:', err);
      setDeleteError('A apărut o eroare. Contactează suportul la costea.radu.ioan@gmail.com.');
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
            <span style={{ fontSize: '2.2rem' }}>🎓</span>
            <div>
              <div style={{ fontWeight: 700, fontSize: '1.1rem', fontFamily: 'var(--font-display)' }}>Profesor Virtual</div>
              <div style={{ fontSize: '.85rem', opacity: 0.82 }}>
                {isPremium
                  ? 'Explicații, exerciții, foto-rezolvare, voce și teste de examen în PDF.'
                  : 'Asistentul tău AI. Ai o încercare gratuită; abonează-te pentru acces complet.'}
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

            {/* Rezultate elevi — pentru profesori și părinți, sub Abonament */}
            {isMentor && (
              <TeacherResults
                user={user}
                inviteCode={profile?.teacher_code}
                displayName={displayName}
                role={profile?.role}
              />
            )}

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
