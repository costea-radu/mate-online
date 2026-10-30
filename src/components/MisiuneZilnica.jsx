// =====================================================================
// src/components/MisiuneZilnica.jsx — „🎯 Misiunea zilnică" din Arena
// (30 oct. 2026), deasupra duelurilor.
//
// Ca la Duolingo: un exercițiu pe zi, cu progres. Elevul își alege clasa (a V-a
// … a XII-a), primește în fiecare zi următorul exercițiu INTERACTIV din site al
// clasei și îl rezolvă în vizualizatorul obișnuit (/exercitiu?id=…&misiune=1).
// Misiunea se îndeplinește de la 50% (scorul verificat pe server); se poate
// relua de câte ori vrea în aceeași zi. Progresul: zilele la rând, săptămâna
// (L M M J V S D), recordul, totalul și drumul prin exercițiile clasei.
//
// API: /api/gamificare → action 'misiune' (starea + exercițiul zilei) și
// 'misiune_clasa' (alegerea clasei) — api/_lib/misiune.js. După fiecare
// exercițiu rezolvat, evenimentul 'em:arena' (src/lib/arena.js) reîncarcă cardul.
//
// „🔔 Amintește-mi" (30 oct. 2026, AmintireMisiune mai jos): elevul își alege ora;
// în zilele în care n-a făcut misiunea primește o notificare (Web Push — și cu
// site-ul închis; altfel în clopoțelul din site), iar seara, dacă seria e în
// pericol, „🔥 Seria ta se pierde la noapte". 'misiune_notificari' /
// 'misiune_notificari_proba' — api/_lib/misiuneNotificari.js.
// =====================================================================
import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { aiClient } from '../lib/aiClient';
import { arenaChanged, onArenaChange } from '../lib/arena';
import { useAuth } from '../context/AuthContext';
import { notifySupport, askNotifyPermission, subscribePush } from '../lib/live/notify';

const PUSH_KEY = 'mz_push_ep';   // endpoint-ul abonării trimise deja serverului din acest browser
const lsGet = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch { /* fără stocare */ } };
const ora = (h) => `${String(h).padStart(2, '0')}:00`;

// ─── „🔔 Amintește-mi" ─────────────────────────────────────────────────────────
function AmintireMisiune({ notif, setNotif, isAdmin }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);           // { tip: 'ok' | 'info' | 'err', text }
  const [alegeOra, setAlegeOra] = useState(notif?.ora || 17);
  const support = notifySupport();
  const key = notif?.push?.on ? notif.push.key : null;

  useEffect(() => { if (notif?.ora) setAlegeOra(notif.ora); }, [notif?.ora]);

  // amintirea pornită + permisiunea dată: abonarea ACESTUI browser ajunge la server
  // (o singură dată per endpoint — ex. elevul a pornit-o de pe telefon, acum e pe laptop)
  useEffect(() => {
    if (!notif?.on || !key || support.permission !== 'granted') return;
    let viu = true;
    (async () => {
      const sub = await subscribePush(key);
      if (!viu || !sub?.endpoint || lsGet(PUSH_KEY) === sub.endpoint) return;
      try {
        const r = await aiClient.gamificare({ action: 'misiune_notificari', subscription: sub });
        if (r?.pushSalvat) lsSet(PUSH_KEY, sub.endpoint);
      } catch { /* data viitoare */ }
    })();
    return () => { viu = false; };
  }, [notif?.on, key, support.permission]);

  if (!notif) return null;
  if (notif.setup === false) {
    if (!isAdmin) return null;
    return (
      <div style={{ marginTop: 12, fontSize: '.78rem', color: 'var(--danger)' }}>
        🔔 Amintirile misiunii nu sunt active: rulează <code>supabase/misiune_notificari.sql</code> în Supabase.
      </div>
    );
  }

  // unde ajunge amintirea pe acest dispozitiv (perm / abonat: starea de DUPĂ cererea permisiunii)
  const undeAjunge = (perm = support.permission, abonat = null) => {
    if (!notif.push?.on) return isAdmin
      ? `Web Push nu e activ pe server (${notif.push?.why === 'sql' ? 'tabela push_subscriptions lipsește' : 'cheile VAPID'}) — amintirea apare în clopoțelul 🔔.`
      : 'Amintirea apare în clopoțelul 🔔 din site.';
    if (support.ios && !support.standalone) return 'Pe iPhone, notificările vin doar din aplicația ExamenMate pusă pe ecranul principal (Safari → Distribuie → „Adaugă pe ecranul principal"). Până atunci, amintirea apare în clopoțelul 🔔 din site.';
    if (!support.push) return 'Browserul acesta nu primește notificări — amintirea apare în clopoțelul 🔔 din site.';
    if (perm === 'denied') return 'Notificările sunt blocate pentru site în acest browser — amintirea apare în clopoțelul 🔔. Le poți permite din 🔒 (lângă adresă) → Notificări.';
    if (perm === 'granted' && abonat === false) return 'Browserul n-a dat încă o adresă pentru notificări — amintirea apare deocamdată în clopoțelul 🔔 (încearcă „Trimite o probă" peste puțin).';
    if (perm === 'granted') return 'Vine ca notificare pe acest dispozitiv, chiar și cu site-ul închis.';
    return null;
  };

  async function salveaza(on, oraNoua = alegeOra) {
    if (busy) return;
    setBusy(true); setMsg(null);
    try {
      let sub = null;
      let perm = support.permission;
      if (on && key && support.push && !(support.ios && !support.standalone)) {
        perm = await askNotifyPermission();             // cererea vine din clicul elevului (cerința browserelor)
        if (perm === 'granted') sub = await subscribePush(key);
      }
      const r = await aiClient.gamificare({ action: 'misiune_notificari', on, ora: oraNoua, ...(sub ? { subscription: sub } : {}) });
      if (r?.notificari) setNotif(r.notificari);
      if (sub?.endpoint && r?.pushSalvat) lsSet(PUSH_KEY, sub.endpoint);
      const abonat = perm === 'granted' ? !!(sub && r?.pushSalvat) : null;
      if (on) setMsg({ tip: 'ok', text: `Gata! Îți amintesc la ${ora(oraNoua)}, doar în zilele în care n-ai făcut încă misiunea. ${undeAjunge(perm, abonat) || ''}`.trim() });
      else setMsg({ tip: 'info', text: 'Amintirea zilnică e oprită. O poți porni oricând de aici.' });
    } catch (e) { setMsg({ tip: 'err', text: e.message || 'Nu am putut salva amintirea.' }); }
    finally { setBusy(false); }
  }

  async function proba() {
    if (busy) return;
    setBusy(true); setMsg(null);
    try {
      // abonarea acestui browser, înainte de probă (poate e un dispozitiv nou)
      if (key && support.permission === 'granted') {
        const sub = await subscribePush(key);
        if (sub?.endpoint && lsGet(PUSH_KEY) !== sub.endpoint) {
          const r0 = await aiClient.gamificare({ action: 'misiune_notificari', subscription: sub });
          if (r0?.pushSalvat) lsSet(PUSH_KEY, sub.endpoint);
        }
      }
      const r = await aiClient.gamificare({ action: 'misiune_notificari_proba' });
      if (r?.sent > 0) setMsg({ tip: 'ok', text: `Am trimis o notificare de probă pe ${r.sent === 1 ? 'un dispozitiv' : `${r.sent} dispozitive`}. Dacă n-a apărut, verifică setările de notificări ale browserului.` });
      else setMsg({ tip: 'info', text: `Nu am unde trimite o notificare de probă. ${undeAjunge() || 'Permite notificările pentru site și încearcă din nou.'}` });
    } catch (e) { setMsg({ tip: 'err', text: e.message || 'Proba nu a mers.' }); }
    finally { setBusy(false); }
  }

  const selOra = (
    <select value={alegeOra} disabled={busy} aria-label="Ora amintirii"
      onChange={(e) => { const h = Number(e.target.value); setAlegeOra(h); if (notif.on) salveaza(true, h); }}
      style={{ padding: '4px 8px', borderRadius: 8, border: '1px solid var(--border)', fontWeight: 700, color: 'var(--navy)', background: '#fff' }}>
      {(notif.ore || [17]).map((h) => <option key={h} value={h}>{ora(h)}</option>)}
    </select>
  );
  const linkBtn = { background: 'none', border: 'none', padding: 0, color: 'var(--navy)', fontWeight: 700, textDecoration: 'underline', cursor: busy ? 'progress' : 'pointer', fontSize: '.8rem' };
  const culori = { ok: '#1e7e34', info: 'var(--text-light)', err: 'var(--danger)' };

  return (
    <div style={{
      marginTop: 12, padding: notif.on || notif.ales ? '10px 0 0' : '10px 12px', borderRadius: notif.on || notif.ales ? 0 : 10,
      borderTop: notif.on || notif.ales ? '1px dashed var(--border)' : 'none',
      background: notif.on || notif.ales ? 'transparent' : 'rgba(232,185,49,.12)',
    }}>
      {notif.on ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', fontSize: '.84rem', color: 'var(--text-light)' }}>
          <span>🔔 <strong style={{ color: 'var(--navy)' }}>Amintire zilnică</strong> la</span>
          {selOra}
          <span>dacă n-ai făcut misiunea{notif.serieOra && notif.ora < notif.serieOra ? `; la ${ora(notif.serieOra)}, dacă seria e în pericol` : ''}.</span>
          <span style={{ display: 'inline-flex', gap: 12 }}>
            <button type="button" style={linkBtn} disabled={busy} onClick={proba}>Trimite o probă</button>
            <button type="button" style={{ ...linkBtn, color: 'var(--text-muted)' }} disabled={busy} onClick={() => salveaza(false)}>Oprește</button>
          </span>
        </div>
      ) : (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', fontSize: '.86rem' }}>
          <span style={{ color: 'var(--navy)', fontWeight: notif.ales ? 600 : 800 }}>
            🔔 {notif.ales ? 'Amintirea zilnică e oprită.' : 'Vrei să-ți amintesc de misiune în fiecare zi?'}
          </span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>la {selOra}</span>
          <button type="button" className={notif.ales ? 'btn btn-sm btn-outline' : 'btn btn-sm btn-primary'} disabled={busy} onClick={() => salveaza(true)}>
            {busy ? 'Se salvează…' : '🔔 Amintește-mi'}
          </button>
          {!notif.ales && (
            <button type="button" style={{ ...linkBtn, color: 'var(--text-muted)', fontWeight: 600 }} disabled={busy} onClick={() => salveaza(false)}>Nu, mulțumesc</button>
          )}
        </div>
      )}
      {msg && <div role="status" style={{ marginTop: 6, fontSize: '.78rem', lineHeight: 1.5, color: culori[msg.tip] || 'var(--text-light)' }}>{msg.text}</div>}
      {!msg && notif.on && undeAjunge() && (
        <div style={{ marginTop: 4, fontSize: '.74rem', color: 'var(--text-muted)', lineHeight: 1.5 }}>{undeAjunge()}</div>
      )}
    </div>
  );
}

const card = {
  background: 'var(--white)', border: '1px solid var(--border)',
  borderRadius: 'var(--radius-lg)', padding: '18px 20px', boxShadow: 'var(--shadow-sm)',
};

// cerculețul unei zile din săptămână
function Zi({ z }) {
  const facut = z.stare === 'facut', azi = z.stare === 'azi', ratat = z.stare === 'ratat';
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, minWidth: 30 }}
      title={facut ? `${z.day}: misiune îndeplinită` : azi ? 'Azi — misiunea te așteaptă' : ratat ? `${z.day}: fără misiune` : z.day}>
      <span style={{ fontSize: '.68rem', fontWeight: 700, color: azi ? 'var(--navy)' : 'var(--text-muted)' }}>{z.label}</span>
      <span aria-hidden style={{
        width: 30, height: 30, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: '.85rem', fontWeight: 800,
        background: facut ? 'var(--gold)' : azi ? '#fff' : ratat ? 'var(--cream-dark, #eee6d3)' : 'var(--cream, #faf6ec)',
        color: facut ? 'var(--navy)' : 'var(--text-muted)',
        border: azi ? '2px solid var(--navy)' : '2px solid transparent',
        animation: azi ? 'mzPuls 2s ease-in-out infinite' : 'none',
      }}>{facut ? '✓' : ratat ? '·' : ''}</span>
    </div>
  );
}

export default function MisiuneZilnica() {
  const navigate = useNavigate();
  const { isAdmin } = useAuth();
  const [m, setM] = useState(null);
  const [notif, setNotif] = useState(null);       // amintirea zilnică („🔔 Amintește-mi")
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const [schimba, setSchimba] = useState(false);   // alegerea clasei deschisă

  const load = useCallback(async () => {
    try {
      const r = await aiClient.gamificare({ action: 'misiune' });
      setM(r?.misiune || null);
      if (r?.notificari) setNotif(r.notificari);
      setErr(null);
    } catch (e) { setErr(e?.message || 'Nu am putut încărca misiunea zilnică.'); }
  }, []);

  useEffect(() => { load(); }, [load]);
  // după un exercițiu rezolvat (și la revenirea în tab) cardul se reîmprospătează
  useEffect(() => onArenaChange(() => load()), [load]);
  useEffect(() => {
    const reia = () => { if (document.visibilityState === 'visible') load(); };
    document.addEventListener('visibilitychange', reia);
    return () => document.removeEventListener('visibilitychange', reia);
  }, [load]);

  async function alege(categorie) {
    setBusy(true); setErr(null);
    try {
      const r = await aiClient.gamificare({ action: 'misiune_clasa', categorie });
      setM(r?.misiune || null);
      setSchimba(false);
      arenaChanged(); // indicatorul din navbar (🎯) află de noua misiune
    } catch (e) { setErr(e?.message || 'Nu am putut salva clasa.'); }
    finally { setBusy(false); }
  }

  if (!m && !err) {
    return <div style={{ ...card, color: 'var(--text-light)' }}>🎯 Se încarcă misiunea zilnică…</div>;
  }
  if (m && m.activ === false) {
    // migrarea nu e rulată: doar adminul vede de ce; elevii nu văd un card stricat
    if (!isAdmin) return null;
    return (
      <div style={{ ...card, borderColor: 'var(--danger)', background: 'rgba(231,76,60,0.06)' }}>
        <strong style={{ color: 'var(--danger)' }}>🎯 Misiunea zilnică nu e activă.</strong>{' '}
        Rulează <code>supabase/gamificare_v8_misiune_zilnica.sql</code> în Supabase → SQL Editor.
        {m.mesaj && <div style={{ fontSize: '.8rem', color: 'var(--text-muted)', marginTop: 6 }}>{m.mesaj}</div>}
      </div>
    );
  }

  const chip = (on) => ({
    padding: '8px 12px', borderRadius: 10, cursor: busy ? 'progress' : 'pointer', fontWeight: 700, fontSize: '.86rem',
    border: `2px solid ${on ? 'var(--gold)' : 'var(--border)'}`, background: on ? 'rgba(232,185,49,.14)' : '#fff', color: 'var(--navy)',
  });
  const alegere = (
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
      {(m?.clase || []).map((c) => (
        <button key={c.id} type="button" disabled={busy} style={chip(m?.clasa?.id === c.id)} onClick={() => alege(c.id)}>
          Clasa {c.label}
        </button>
      ))}
    </div>
  );

  const facuta = m?.status === 'indeplinit';
  const ex = m?.exercitiu;
  const deschide = () => { if (ex) navigate(`/exercitiu?id=${ex.id}&misiune=1`); };

  return (
    <div style={{ ...card, borderColor: facuta ? 'var(--success)' : 'var(--gold)', borderWidth: 2 }}>
      <style>{'@keyframes mzPuls{0%,100%{box-shadow:0 0 0 0 rgba(15,43,68,.35)}50%{box-shadow:0 0 0 6px rgba(15,43,68,0)}}'}</style>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', marginBottom: 6 }}>
        <div style={{ fontSize: '0.72rem', letterSpacing: '0.06em', textTransform: 'uppercase', fontWeight: 700, color: facuta ? 'var(--success)' : 'var(--gold-dim, #a8811a)' }}>
          🎯 Misiunea zilnică{facuta ? ' · îndeplinită' : ''}
        </div>
        {m?.clasa && (
          <button type="button" onClick={() => setSchimba((v) => !v)}
            style={{ background: 'none', border: '1px solid var(--border)', borderRadius: 999, padding: '3px 10px', fontSize: '.76rem', fontWeight: 700, color: 'var(--navy)', cursor: 'pointer' }}
            title="Schimbă clasa misiunii">
            Clasa {m.clasa.label} ✎
          </button>
        )}
      </div>

      {err && <div style={{ color: 'var(--danger)', fontSize: '.85rem', marginBottom: 8 }}>{err}</div>}

      {/* încă nicio clasă: alegerea */}
      {m?.alegeClasa ? (
        <>
          <strong style={{ fontSize: '1.05rem' }}>Un exercițiu pe zi, potrivit clasei tale.</strong>
          <p style={{ fontSize: '.88rem', color: 'var(--text-light)', margin: '6px 0 0' }}>
            Alege-ți clasa: în fiecare zi primești următorul exercițiu interactiv din site, iar zilele la rând se adună.
          </p>
          {alegere}
        </>
      ) : m && (
        <>
          {schimba && (
            <div style={{ background: 'var(--cream)', borderRadius: 10, padding: '10px 12px', marginBottom: 12 }}>
              <div style={{ fontSize: '.82rem', color: 'var(--text-light)' }}>
                Alege altă clasă{facuta ? ' — se aplică de mâine (misiunea de azi e deja îndeplinită).' : ' — exercițiul de azi se schimbă pe loc.'}
              </div>
              {alegere}
            </div>
          )}

          <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', alignItems: 'center' }}>
            {/* seria: zilele la rând cu misiunea îndeplinită */}
            <div style={{ textAlign: 'center', minWidth: 92 }}>
              <div style={{ fontSize: '2rem', fontWeight: 800, color: 'var(--navy)', lineHeight: 1 }}>🎯 {m.serie || 0}</div>
              <div style={{ fontSize: '.74rem', color: 'var(--text-muted)', marginTop: 4 }}>{m.serie === 1 ? 'zi la rând' : 'zile la rând'}</div>
            </div>
            {/* săptămâna */}
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }} aria-label="Misiunile din săptămâna aceasta">
              {(m.saptamana || []).map((z) => <Zi key={z.day} z={z} />)}
            </div>
          </div>

          {/* exercițiul zilei */}
          <div style={{ marginTop: 14, padding: '12px 14px', borderRadius: 12, background: facuta ? 'rgba(39,174,96,0.08)' : 'rgba(232,185,49,0.10)' }}>
            {ex ? (
              <>
                <div style={{ fontSize: '.74rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '.04em' }}>
                  {facuta ? 'Exercițiul de azi — rezolvat' : 'Exercițiul de azi'}
                </div>
                <div style={{ fontWeight: 800, color: 'var(--navy)', fontSize: '1rem', margin: '4px 0 8px' }}>🧩 {ex.titlu}</div>
                {facuta ? (
                  <div style={{ fontSize: '.86rem', color: '#1e7e34', fontWeight: 600, marginBottom: 8 }}>
                    ✅ Misiune îndeplinită{m.celMaiBun != null ? ` cu ${m.celMaiBun}%` : ''}{m.xpPrimit ? ` · +${m.xpPrimit} XP` : ''}. Revino mâine pentru următorul exercițiu!
                  </div>
                ) : m.incercari > 0 ? (
                  <div style={{ fontSize: '.86rem', color: '#b26a00', fontWeight: 600, marginBottom: 8 }}>
                    Ai avut {m.celMaiBun ?? 0}% — misiunea se îndeplinește de la {m.prag}%. Mai încearcă, ai voie de câte ori vrei azi.
                  </div>
                ) : (
                  <div style={{ fontSize: '.86rem', color: 'var(--text-light)', marginBottom: 8 }}>
                    Rezolvă-l cu cel puțin {m.prag}% ca să bifezi ziua. Profesorul Virtual te poate ajuta pe parcurs.
                  </div>
                )}
                <button type="button" className={facuta ? 'btn btn-sm btn-outline' : 'btn btn-primary'} onClick={deschide}>
                  {facuta ? '↻ Mai exersează o dată' : m.incercari > 0 ? '▶ Încearcă din nou' : '▶ Rezolvă exercițiul zilei'}
                </button>
              </>
            ) : (
              <div style={{ fontSize: '.88rem', color: 'var(--text-light)' }}>
                Nu am găsit încă exerciții interactive pentru clasa {m.clasa?.label}. Alege altă clasă
                {' '}(<button type="button" onClick={() => setSchimba(true)} style={{ background: 'none', border: 'none', padding: 0, color: 'var(--navy)', fontWeight: 700, textDecoration: 'underline', cursor: 'pointer' }}>schimbă clasa</button>)
                {' '}— fără abonament se folosesc doar exercițiile gratuite.
              </div>
            )}
            {m.din && ex && (
              <div style={{ fontSize: '.74rem', color: 'var(--text-muted)', marginTop: 8 }}>
                Clasa {m.clasa?.label} nu are încă exerciții interactive proprii — primești din {m.din === 'bacalaureat' ? 'Bacalaureat' : 'Evaluarea Națională'}.
              </div>
            )}
          </div>

          {/* drumul clasei */}
          {m.drum && m.drum.total > 0 && (
            <div style={{ marginTop: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '.8rem', color: 'var(--text-light)', marginBottom: 5 }}>
                <span>Drumul clasei {m.clasa?.label}: <strong style={{ color: 'var(--navy)' }}>{m.drum.parcurse}</strong> din {m.drum.total} exerciții rezolvate</span>
                <span>{m.drum.pct}%</span>
              </div>
              <div style={{ background: 'var(--cream-dark)', borderRadius: 999, height: 9, overflow: 'hidden' }}>
                <div style={{ width: `${Math.max(0, Math.min(100, m.drum.pct))}%`, height: '100%', background: 'var(--gold)', borderRadius: 999, transition: 'width .4s ease' }} />
              </div>
            </div>
          )}

          <div style={{ fontSize: '.76rem', color: 'var(--text-muted)', marginTop: 10, lineHeight: 1.6 }}>
            Recompensă: {m.recompensa?.xp ?? 20} XP (+{m.recompensa?.perfect ?? 10} la 90% sau mai mult) și {m.recompensa?.coins ?? 5} 🪙;
            {' '}la fiecare {m.recompensa?.seriePas ?? 7} zile la rând, încă {m.recompensa?.serieXp ?? 30} XP.
            {' '}Misiuni îndeplinite: <strong>{m.total || 0}</strong>{m.record ? ` · record: ${m.record} ${m.record === 1 ? 'zi' : 'zile'} la rând` : ''}.
          </div>

          <AmintireMisiune notif={notif} setNotif={setNotif} isAdmin={isAdmin} />
        </>
      )}
    </div>
  );
}
