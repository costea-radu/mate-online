// =====================================================================
// src/components/AcasaCont.jsx — prima pagină (Home), pe tipul de cont
// (11 nov. 2026)
//
// Cererea lui Radu, pentru pagina „home":
//   · ELEV: păstrează „Pregătește-mă de examen" (fără cuvântul „nou") și adaugă
//     „insignele mele (progresul meu)", „rezultatele", „teme", „mesageria",
//     „părerea ta despre ExamenMate";
//   · PĂRINTE: fără „Pregătește-mă de examen"; „rezultate elev", „asociază-te cu
//     copilul tău", „mesageria", „părerea ta despre ExamenMate";
//   · PROFESOR: fără „Pregătește-mă de examen"; „generează teste", „rezultate
//     elevi", „invită elevi", „mesageria grupei", „părerea ta despre ExamenMate"
//     (+ profesorii dau note, plusuri, minusuri, aprecieri — în „Rezultate elevi").
// Fiecare card duce direct la secțiunea lui din „Contul meu" (?rezultate=1 …),
// la mesagerie sau la generator; „Părerea ta" se scrie chiar aici.
// =====================================================================
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../lib/supabase';
import { aiClient } from '../lib/aiClient';
import { getMyBadges } from '../lib/badges';
import { arenaState } from '../lib/arena';
import { useChatUnread } from '../lib/chatUnread';
import { SiteReviewForm } from './ReviewWidget';
import { rezumatCatalog, fmtNotaCatalog } from './CatalogNote';

// o memorie scurtă (1 minut) pentru cererile la server ale cardurilor — revenirea în Home
// nu le mai repetă
const memorie = new Map();
function dinMemorie(cheie, fn, ttl = 60000) {
  const m = memorie.get(cheie);
  if (m && Date.now() - m.la < ttl) return m.p;
  const p = fn().catch((e) => { memorie.delete(cheie); throw e; });
  memorie.set(cheie, { p, la: Date.now() });
  return p;
}

const prenumeDin = (profile, user) => String(profile?.full_name || user?.user_metadata?.name || user?.user_metadata?.full_name || '').trim().split(/\s+/)[0] || '';

function copiaza(text, gata) {
  const ok = () => gata && gata();
  if (navigator.clipboard?.writeText) navigator.clipboard.writeText(text).then(ok).catch(() => {});
  else {
    try {
      const ta = document.createElement('textarea');
      ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select(); document.execCommand('copy'); document.body.removeChild(ta); ok();
    } catch { /* ignore */ }
  }
}

// un card: pictograma, titlul, rândul mic și (opțional) o valoare / un conținut.
// Tot cardul e link; cu `extra` (linkuri / butoane proprii) cardul e un <div>, iar
// linkul principal acoperă cardul pe sub ele (fără <a> în <a>, fără buton în <a>).
function Card({ to, icon, titlu, sub, children, accent = 'var(--gold)', id, extra = null }) {
  const continut = (
    <>
      <span className="acasa-ic" aria-hidden="true">{icon}</span>
      <span className="acasa-txt">
        <b>{titlu}</b>
        {sub && <small>{sub}</small>}
        {children}
        {extra}
      </span>
      <span className="acasa-go" aria-hidden="true">→</span>
    </>
  );
  if (!extra) {
    return <Link to={to} className="acasa-card" id={id} style={{ '--acasa-accent': accent }}>{continut}</Link>;
  }
  return (
    <div className="acasa-card acasa-card-div" id={id} style={{ '--acasa-accent': accent }}>
      <Link to={to} className="acasa-card-link" aria-label={titlu} />
      {continut}
    </div>
  );
}

// „Părerea ta despre ExamenMate" — se scrie direct în Home
function ParereCard() {
  return (
    <div className="acasa-card acasa-parere" id="acasa-parere">
      <span className="acasa-ic" aria-hidden="true">⭐</span>
      <div className="acasa-txt">
        <b>Părerea ta despre ExamenMate</b>
        <small>Cum te ajută platforma? După verificare, apare pe pagina principală. <Link to="/recenzii">Vezi recenziile →</Link></small>
        <div style={{ marginTop: 10 }}><SiteReviewForm compact /></div>
      </div>
    </div>
  );
}

// 🔗 linkul de asociere / invitație, cu „Copiază" chiar în card
function InvitaCard({ to, titlu, sub, cod, icon = '🔗' }) {
  const [copiat, setCopiat] = useState(false);
  const link = cod && typeof window !== 'undefined' ? `${window.location.origin}/asociere?cod=${cod}` : '';
  return (
    <Card to={to} icon={icon} titlu={titlu} sub={sub} accent="#2e7d32"
      extra={link ? (
        <span className="acasa-link">
          <code>{link.replace(/^https?:\/\//, '')}</code>
          <button type="button" onClick={() => copiaza(link, () => { setCopiat(true); setTimeout(() => setCopiat(false), 1800); })}>
            {copiat ? '✓ Copiat' : 'Copiază linkul'}
          </button>
        </span>
      ) : null} />
  );
}

function MesageriaCard({ to = '/mesagerie', titlu = 'Mesageria', sub = 'discuțiile tale cu colegii, profesorii și părinții' }) {
  const { user } = useAuth();
  const u = useChatUnread(!!user);
  return (
    <Card to={to} icon="💬" titlu={titlu} sub={sub} accent="#1565c0">
      {u.count > 0 && <span className="acasa-pill acasa-pill-rosu">{u.count} {u.count === 1 ? 'mesaj nou' : 'mesaje noi'}</span>}
    </Card>
  );
}

function Antet({ titlu, sub }) {
  return (
    <div className="acasa-head">
      <h2>{titlu}</h2>
      {sub && <p>{sub}</p>}
    </div>
  );
}

// ─── ELEV ────────────────────────────────────────────────────────────────────
export function AcasaElev() {
  const { user, profile } = useAuth();
  const [insigne, setInsigne] = useState(null);
  const [arena, setArena] = useState(null);
  const [rez, setRez] = useState(null);       // { n, media }
  const [teme, setTeme] = useState(null);     // { pending, mentor }
  const [catalog, setCatalog] = useState(null);
  useEffect(() => {
    if (!user?.id) return undefined;
    let viu = true;
    getMyBadges(user.id).then((b) => { if (viu) setInsigne(b); }).catch(() => {});
    arenaState().then((a) => { if (viu) setArena(a); }).catch(() => {});
    supabase.from('progress').select('score, max_score', { count: 'exact' }).eq('user_id', user.id)
      .order('completed_at', { ascending: false }).limit(20)
      .then(({ data, count }) => {
        if (!viu) return;
        const rows = (data || []).filter((r) => r.max_score > 0);
        const media = rows.length ? Math.round(rows.reduce((a, r) => a + (r.score / r.max_score) * 100, 0) / rows.length) : null;
        setRez({ n: count ?? (data || []).length, media });
      }, () => { if (viu) setRez({ n: 0, media: null }); });
    dinMemorie(`teme:${user.id}`, () => aiClient.homeworkStudentList()).then((r) => { if (viu) setTeme({ pending: (r.pending || []).length, mentor: !!r.hasTeacher }); }).catch(() => { if (viu) setTeme({ pending: 0, mentor: false }); });
    dinMemorie(`catalog:${user.id}`, () => aiClient.catalogMine()).then((r) => { if (viu) setCatalog(r.marks || []); }).catch(() => { if (viu) setCatalog([]); });
    return () => { viu = false; };
  }, [user?.id]);

  const prenume = prenumeDin(profile, user);
  const cat = rezumatCatalog(catalog || []);
  const ultimaNota = cat.note[0] || null;    // cele mai noi primele (my_marks)
  const nivel = arena?.nivel;
  return (
    <section className="acasa" aria-label="Contul tău">
      <div className="container">
        <Antet titlu={prenume ? `Bună, ${prenume}! 👋` : 'Contul tău'} sub="Tot ce ai de făcut, dintr-o privire." />
        <div className="acasa-grid">
          <Card to="/profil?insigne=1" icon="🏅" titlu="Insignele mele" sub="progresul meu">
            {insigne && insigne.length > 0 && (
              <span className="acasa-insigne" aria-label={`${insigne.length} insigne`}>
                {insigne.slice(0, 6).map((b) => <span key={b.id} title={b.name}>{b.icon}</span>)}
                {insigne.length > 6 && <em>+{insigne.length - 6}</em>}
              </span>
            )}
            <span className="acasa-mic">
              {insigne ? `${insigne.length} ${insigne.length === 1 ? 'insignă' : 'insigne'}` : '…'}
              {nivel && nivel.level ? ` · nivelul ${nivel.level}${nivel.name ? ` (${nivel.name})` : ''}` : ''}
              {arena?.stats?.streak ? ` · 🔥 ${arena.stats.streak} ${arena.stats.streak === 1 ? 'zi' : 'zile'}` : ''}
            </span>
          </Card>
          <Card to="/profil?rezultate=1" icon="📊" titlu="Rezultatele mele" sub="testele, notele și ce ți-au dat profesorii" accent="var(--navy)">
            <span className="acasa-mic">
              {rez ? (rez.n ? `${rez.n} ${rez.n === 1 ? 'test rezolvat' : 'teste rezolvate'}${rez.media != null ? ` · media ${rez.media}%` : ''}` : 'Încă niciun test rezolvat') : '…'}
            </span>
            {(ultimaNota || cat.plusuri > 0 || cat.aprecieri > 0) && (
              <span className="acasa-mic">
                📒 {ultimaNota ? `ultima notă: ${fmtNotaCatalog(ultimaNota.value)}` : ''}
                {cat.plusuri > 0 ? ` · ➕${cat.plusuri}` : ''}{cat.minusuri > 0 ? ` · ➖${cat.minusuri}` : ''}{cat.aprecieri > 0 ? ` · 👏${cat.aprecieri}` : ''}
              </span>
            )}
          </Card>
          <Card to="/profil?teme=1" icon="📝" titlu="Teme" sub="de la profesor și de la părinți" accent="#e65100">
            {teme && teme.pending > 0 && <span className="acasa-pill acasa-pill-rosu">{teme.pending} de făcut</span>}
            {teme && teme.pending === 0 && <span className="acasa-mic">{teme.mentor ? '🎉 Nicio temă nefăcută' : 'Temele primite apar aici'}</span>}
          </Card>
          <MesageriaCard />
          <ParereCard />
        </div>
      </div>
    </section>
  );
}

// ─── PĂRINTE ─────────────────────────────────────────────────────────────────
export function AcasaParinte() {
  const { user, profile } = useAuth();
  const prenume = prenumeDin(profile, user);
  return (
    <section className="acasa" aria-label="Contul tău">
      <div className="container">
        <Antet titlu={prenume ? `Bună, ${prenume}! 👋` : 'Contul tău'} sub="Cum merge copilul tău la matematică — dintr-o privire." />
        <div className="acasa-grid">
          <Card to="/profil?rezultate=1" icon="📊" titlu="Rezultate elev" sub="testele, notele, temele și ce i-au dat profesorii" accent="var(--navy)" />
          <InvitaCard to="/profil?asociere=1" titlu="Asociază-te cu copilul tău" sub="trimite-i linkul: după ce îl deschide, îi vezi rezultatele" cod={profile?.teacher_code} />
          <MesageriaCard sub="cu profesorii copilului și cu grupa" />
          <ParereCard />
        </div>
      </div>
    </section>
  );
}

// ─── PROFESOR ────────────────────────────────────────────────────────────────
export function AcasaProfesor() {
  const { user, profile } = useAuth();
  const prenume = prenumeDin(profile, user);
  return (
    <section className="acasa" aria-label="Contul tău">
      <div className="container">
        <Antet titlu={prenume ? `Bună ziua, ${prenume}! 👋` : 'Contul tău'} sub="Testele, elevii și catalogul tău, dintr-o privire." />
        <div className="acasa-grid">
          <Card to="/profesor-virtual?tab=interactive" icon="🧩" titlu="Generează teste" sub="interactive sau PDF, după modelele oficiale" accent="#7c5cbf"
            extra={<span className="acasa-mic acasa-linkuri"><Link to="/profesor-virtual?tab=exam">📄 Subiect de examen</Link><Link to="/profesor-virtual?tab=interactive&mod=elevi">👥 Teste diferite / elev</Link></span>} />
          <Card to="/profil?rezultate=1" icon="📊" titlu="Rezultate elevi" sub="grupe, medii și catalogul: note, plusuri, minusuri, aprecieri" accent="var(--navy)" />
          <InvitaCard to="/profil?invita=1" titlu="Invită elevi" sub="un link: elevii se asociază cu un clic" cod={profile?.teacher_code} />
          <MesageriaCard to="/profil?mesagerie=1" titlu="Mesageria grupei" sub="tu, elevii grupei și părinții lor" />
          <ParereCard />
        </div>
      </div>
    </section>
  );
}
