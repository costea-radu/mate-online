// =====================================================================
// src/components/AccountSettings.jsx — „Setări cont" (toate tipurile de cont)
// Profil, date de autentificare, abonament, tip cont, notificări, ștergere.
// =====================================================================
import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../lib/supabase';
import { aiClient } from '../lib/aiClient';
import { getInstallPrompt, clearInstallPrompt, onInstallChange, isInstalled, isIOS } from '../lib/installPrompt';

const ROLES = [
  { id: 'elev', label: 'Elev' },
  { id: 'profesor', label: 'Profesor' },
  { id: 'parinte', label: 'Părinte' },
];

function Note({ ok, children }) {
  if (!children) return null;
  return <div style={{ marginTop: 8, fontSize: '.82rem', color: ok ? '#1e7e34' : '#b71c1c' }}>{children}</div>;
}

export default function AccountSettings() {
  const { user, profile, fetchProfile, signOut, isPremium } = useAuth();
  const inp = { width: '100%', border: '1px solid var(--border)', borderRadius: 8, padding: '9px 11px', fontSize: '.92rem', marginTop: 4, marginBottom: 10 };
  const sub = { fontWeight: 700, color: 'var(--navy)', fontSize: '.95rem', margin: '18px 0 8px' };
  const label = { fontSize: '.8rem', color: 'var(--text-light)' };

  // Profil
  const [fullName, setFullName] = useState(profile?.full_name || '');
  const [username, setUsername] = useState(profile?.username || '');
  const [pMsg, setPMsg] = useState(null); const [pOk, setPOk] = useState(false);

  async function saveProfile() {
    setPMsg(null);
    try {
      if (username && username.trim()) {
        const { available } = await aiClient.accountCheckUsername({ username: username.trim() });
        if (!available) { setPOk(false); setPMsg('Numele de utilizator este deja folosit.'); return; }
      }
      const { error } = await supabase.from('profiles').update({ full_name: fullName.trim() || null, username: username.trim() || null }).eq('id', user.id);
      if (error) throw error;
      await fetchProfile(user.id); setPOk(true); setPMsg('✅ Profil salvat.');
    } catch (e) { setPOk(false); setPMsg('Eroare: ' + e.message); }
  }

  // Email
  const [email, setEmail] = useState(''); const [eMsg, setEMsg] = useState(null); const [eOk, setEOk] = useState(false);
  async function changeEmail() {
    setEMsg(null);
    if (!email.trim()) { setEOk(false); setEMsg('Introdu o adresă de email.'); return; }
    try {
      const { error } = await supabase.auth.updateUser({ email: email.trim() });
      if (error) throw error;
      setEOk(true); setEMsg('✅ Ți-am trimis un email de confirmare la noua adresă. Schimbarea are loc după confirmare.');
    } catch (e) { setEOk(false); setEMsg('Eroare: ' + e.message); }
  }

  // Parolă
  const [pw, setPw] = useState(''); const [pw2, setPw2] = useState(''); const [pwMsg, setPwMsg] = useState(null); const [pwOk, setPwOk] = useState(false);
  async function changePassword() {
    setPwMsg(null);
    if (pw.length < 6) { setPwOk(false); setPwMsg('Parola trebuie să aibă minim 6 caractere.'); return; }
    if (pw !== pw2) { setPwOk(false); setPwMsg('Parolele nu coincid.'); return; }
    try {
      const { error } = await supabase.auth.updateUser({ password: pw });
      if (error) throw error;
      setPw(''); setPw2(''); setPwOk(true); setPwMsg('✅ Parola a fost schimbată.');
    } catch (e) { setPwOk(false); setPwMsg('Eroare: ' + e.message); }
  }

  // Tip cont
  const [role, setRole] = useState(profile?.role || 'elev'); const [rMsg, setRMsg] = useState(null); const [rOk, setROk] = useState(false);
  async function saveRole() {
    setRMsg(null);
    try {
      const { error } = await supabase.from('profiles').update({ role }).eq('id', user.id);
      if (error) throw error;
      await fetchProfile(user.id); setROk(true); setRMsg('✅ Tipul contului a fost schimbat.');
    } catch (e) { setROk(false); setRMsg('Eroare: ' + e.message); }
  }

  // Notificări
  const [notif, setNotif] = useState(profile?.notifications_enabled !== false);
  async function toggleNotif() {
    const next = !notif; setNotif(next);
    try { await supabase.from('profiles').update({ notifications_enabled: next }).eq('id', user.id); await fetchProfile(user.id); } catch { setNotif(!next); }
  }

  // Zonă periculoasă
  const [busy, setBusy] = useState(false);
  async function deleteAccount() {
    if (!window.confirm('ȘTERGERE DEFINITIVĂ: contul și datele lui vor fi șterse ireversibil.\n\nComentariile publicate pe forum și materialele publicate în Biblioteca utilizatorilor rămân pe site (cu numele de la momentul publicării, fără legătură cu contul). Continui?')) return;
    if (!window.confirm('Ești sigur? Această acțiune NU poate fi anulată.')) return;
    setBusy(true);
    try { await aiClient.accountDelete(); await signOut(); }
    catch (e) { alert('Eroare: ' + e.message); setBusy(false); }
  }

  const btn = 'btn btn-primary btn-sm';

  return (
    <div>
      {/* PROFIL */}
      <div style={sub}>👤 Profil</div>
      <label style={label}>Nume și prenume
        <input style={inp} value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="ex: Ion Popescu" />
      </label>
      <label style={label}>Nume de utilizator
        <input style={inp} value={username} onChange={(e) => setUsername(e.target.value)} placeholder="ex: ionpopescu" />
      </label>
      <button className={btn} onClick={saveProfile}>Salvează profilul</button>
      <Note ok={pOk}>{pMsg}</Note>

      {/* APLICAȚIA (PWA) */}
      <div style={sub}>📲 Aplicația ExamenMate</div>
      <InstallAppRow />

      {/* AUTENTIFICARE */}
      <div style={sub}>🔐 Date de autentificare</div>
      <div style={{ fontSize: '.82rem', color: 'var(--text-muted)', marginBottom: 6 }}>Email actual: <strong>{user?.email || '—'}</strong></div>
      <label style={label}>Schimbă / adaugă adresa de email (cu confirmare)
        <input style={inp} type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="noua@adresa.com" />
      </label>
      <button className={btn} onClick={changeEmail}>Trimite confirmarea</button>
      <Note ok={eOk}>{eMsg}</Note>

      <label style={{ ...label, display: 'block', marginTop: 16 }}>Parolă nouă
        <input style={inp} type="password" value={pw} onChange={(e) => setPw(e.target.value)} placeholder="minim 6 caractere" />
      </label>
      <label style={label}>Confirmă parola
        <input style={inp} type="password" value={pw2} onChange={(e) => setPw2(e.target.value)} />
      </label>
      <button className={btn} onClick={changePassword}>Schimbă parola</button>
      <Note ok={pwOk}>{pwMsg}</Note>

      {/* ABONAMENT */}
      <div style={sub}>💳 Abonament</div>
      <div style={{ fontSize: '.85rem', color: 'var(--text-light)', marginBottom: 8 }}>
        Status: <strong style={{ color: isPremium ? '#1e7e34' : 'var(--text-muted)' }}>{isPremium ? 'Activ (Premium)' : 'Fără abonament'}</strong>
      </div>
      <Link to="/preturi" className="btn btn-outline btn-sm">Gestionează abonamentul</Link>

      {/* TIP CONT */}
      <div style={sub}>🔁 Tipul contului</div>
      <select value={role} onChange={(e) => setRole(e.target.value)} style={{ ...inp, width: 'auto', minWidth: 180 }}>
        {ROLES.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
      </select>
      <div><button className={btn} onClick={saveRole}>Schimbă tipul contului</button></div>
      <Note ok={rOk}>{rMsg}</Note>

      {/* NOTIFICĂRI */}
      <div style={sub}>🔔 Notificări</div>
      <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}>
        <input type="checkbox" checked={notif} onChange={toggleNotif} />
        <span style={{ fontSize: '.9rem', color: 'var(--navy)' }}>{notif ? 'Notificările sunt pornite' : 'Notificările sunt oprite'}</span>
      </label>

      {/* ZONĂ PERICULOASĂ */}
      <div style={{ ...sub, color: '#b71c1c' }}>⚠️ Cont</div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button onClick={deleteAccount} disabled={busy}
          style={{ background: '#fdecea', border: '1px solid #f5c6cb', color: '#c0392b', borderRadius: 8, padding: '8px 14px', fontSize: '.85rem', fontWeight: 700, cursor: 'pointer' }}>
          🗑 Șterge definitiv contul
        </button>
      </div>
    </div>
  );
}


// ─── Butonul „Instalează aplicația” din Setări cont ──────────────────────────
function InstallAppRow() {
  const [canInstall, setCanInstall] = useState(!!getInstallPrompt());
  const [installed, setInstalled] = useState(isInstalled());
  const [iosHelp, setIosHelp] = useState(false);
  const [done, setDone] = useState(false);
  const [unHelp, setUnHelp] = useState(false);
  const [cleanMsg, setCleanMsg] = useState(null);

  useEffect(() => onInstallChange(() => {
    setCanInstall(!!getInstallPrompt());
    setInstalled(isInstalled());
  }), []);

  async function install() {
    const p = getInstallPrompt();
    if (!p) { setIosHelp((v) => !v); return; }
    p.prompt();
    try { const { outcome } = await p.userChoice; if (outcome === 'accepted') setDone(true); } catch { /* ignore */ }
    clearInstallPrompt(); setCanInstall(false);
  }

  const isAndroid = /android/i.test(navigator.userAgent);

  async function clearAppData() {
    if (!window.confirm('Ștergi datele offline ale aplicației (cache) de pe acest dispozitiv?')) return;
    try {
      const regs = (await navigator.serviceWorker?.getRegistrations?.()) || [];
      await Promise.all(regs.map((r) => r.unregister()));
      const keys = (await window.caches?.keys?.()) || [];
      await Promise.all(keys.map((k) => caches.delete(k)));
      setCleanMsg('✅ Datele aplicației au fost șterse de pe acest dispozitiv.');
    } catch (e) { setCleanMsg('Nu am putut șterge datele: ' + (e?.message || e)); }
  }

  const uninstallPanel = (
    <div style={{ marginTop: 10 }}>
      <button className="btn btn-outline btn-sm" onClick={() => setUnHelp((v) => !v)} style={{ color: '#c0392b', borderColor: '#f5c6cb' }}>
        🗑 Dezinstalează aplicația
      </button>
      {unHelp && (
        <div style={{ fontSize: '.82rem', marginTop: 8, background: '#f7f9fc', borderRadius: 8, padding: '10px 12px', lineHeight: 1.55 }}>
          Dezinstalarea se face din sistemul de operare (browserul nu are voie să șteargă singur aplicația):
          {isIOS() ? (
            <div style={{ marginTop: 6 }}>📱 <strong>iPhone/iPad:</strong> ține apăsat pe iconița ExamenMate → „Elimină aplicația” → „Șterge de pe ecranul principal”.</div>
          ) : isAndroid ? (
            <div style={{ marginTop: 6 }}>🤖 <strong>Android:</strong> ține apăsat pe iconița ExamenMate → „Dezinstalează”. Alternativ: Chrome → ⋮ → „Aplicații” → ExamenMate → Dezinstalează.</div>
          ) : (
            <div style={{ marginTop: 6 }}>💻 <strong>PC (Chrome/Edge):</strong> deschide aplicația ExamenMate → meniul ⋮ din bara de sus a aplicației → „Dezinstalează ExamenMate…”.</div>
          )}
          <div style={{ marginTop: 8 }}>
            Opțional, poți șterge și datele offline salvate de aplicație în acest browser:
          </div>
          <button className="btn btn-outline btn-sm" onClick={clearAppData} style={{ marginTop: 6 }}>🧹 Șterge datele aplicației</button>
          {cleanMsg && <div style={{ marginTop: 6, color: cleanMsg.startsWith('✅') ? '#1e7e34' : '#b71c1c' }}>{cleanMsg}</div>}
        </div>
      )}
    </div>
  );

  if (installed || done) {
    return (
      <div style={{ marginBottom: 6 }}>
        <div style={{ fontSize: '.85rem', color: '#1e7e34', fontWeight: 600 }}>✅ Aplicația este instalată pe acest dispozitiv.</div>
        {uninstallPanel}
      </div>
    );
  }

  return (
    <div style={{ marginBottom: 6 }}>
      <div style={{ fontSize: '.82rem', color: 'var(--text-muted)', marginBottom: 8 }}>
        Instalează ExamenMate pe telefon sau pe calculator: pornește pe tot ecranul și se actualizează automat.
      </div>
      <button className="btn btn-primary btn-sm" onClick={install}>
        {canInstall ? '📲 Instalează aplicația' : (isIOS() ? '📲 Cum instalez pe iPhone/iPad?' : '📲 Instalează aplicația')}
      </button>
      {iosHelp && (
        <div style={{ fontSize: '.82rem', marginTop: 8, background: '#f7f9fc', borderRadius: 8, padding: '8px 10px', lineHeight: 1.5 }}>
          1. Deschide site-ul în <strong>Safari</strong><br />
          2. Apasă butonul <strong>Share</strong> (pătratul cu săgeată ↑)<br />
          3. Alege <strong>„Adaugă la ecranul principal”</strong>
        </div>
      )}
      {!canInstall && !isIOS() && (
        <div style={{ fontSize: '.74rem', color: 'var(--text-muted)', marginTop: 6 }}>
          Dacă butonul nu deschide instalarea, folosește meniul browserului (⋮) → „Instalează aplicația”.
        </div>
      )}
      {uninstallPanel}
    </div>
  );
}
