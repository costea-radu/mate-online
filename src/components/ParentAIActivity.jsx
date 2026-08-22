// =====================================================================
// src/components/ParentAIActivity.jsx
// Pentru părinte: pentru fiecare copil asociat, un rolldown cu activitatea
// la Profesorul Virtual (subiecte generate, interactive, antrenament,
// exerciții de la profesor, întrebări, progres).
// =====================================================================
import { useState, useEffect } from 'react';
import { aiClient } from '../lib/aiClient';
import { notaDinScor } from '../lib/nota';

const pct = (m) => `${Math.round((m || 0) * 100)}%`;
const dt = (d) => (d ? new Date(d).toLocaleDateString('ro-RO') : '');

export default function ParentAIActivity() {
  const [children, setChildren] = useState(null);
  const [openId, setOpenId] = useState(null);
  const [details, setDetails] = useState({}); // studentId -> data
  const [loadingId, setLoadingId] = useState(null);

  useEffect(() => {
    (async () => {
      try { const { children } = await aiClient.activityChildren(); setChildren(children || []); }
      catch { setChildren([]); }
    })();
  }, []);

  async function toggle(id) {
    if (openId === id) { setOpenId(null); return; }
    setOpenId(id);
    if (!details[id]) {
      setLoadingId(id);
      try { const d = await aiClient.activityDetail({ studentId: id }); setDetails((x) => ({ ...x, [id]: d })); }
      catch (e) { setDetails((x) => ({ ...x, [id]: { error: e.message } })); }
      finally { setLoadingId(null); }
    }
  }

  if (children === null) return <div style={{ padding: 20, textAlign: 'center' }}><div className="spinner" /></div>;
  if (!children.length) return <p style={{ color: 'var(--text-muted)', fontSize: '.9rem' }}>Niciun copil asociat încă. Folosește codul de asociere din „Rezultate elevi".</p>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {children.map((c) => {
        const d = details[c.id];
        const open = openId === c.id;
        return (
          <div key={c.id} style={{ border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden' }}>
            <button onClick={() => toggle(c.id)}
              style={{ width: '100%', textAlign: 'left', padding: '12px 14px', background: open ? 'rgba(232,185,49,.08)' : '#fff', border: 'none', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <strong style={{ color: 'var(--navy)' }}>👦 {c.name}</strong>
              <span style={{ color: 'var(--text-muted)' }}>{open ? '▲' : '▼'}</span>
            </button>
            {open && (
              <div style={{ padding: 14, borderTop: '1px solid var(--border)' }}>
                {loadingId === c.id && <div style={{ textAlign: 'center', padding: 16 }}><div className="spinner" /></div>}
                {d && d.error && <div style={{ color: '#b71c1c', fontSize: '.85rem' }}>⚠️ {d.error}</div>}
                {d && !d.error && <ChildDetail d={d} />}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function Section({ title, count, children }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ fontWeight: 700, color: 'var(--navy)', fontSize: '.9rem', marginBottom: 6 }}>{title}{count != null ? ` (${count})` : ''}</div>
      {children}
    </div>
  );
}

function List({ items, render, empty }) {
  if (!items || !items.length) return <div style={{ fontSize: '.82rem', color: 'var(--text-muted)' }}>{empty}</div>;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
      {items.map((it, i) => (
        <div key={i} style={{ fontSize: '.83rem', color: 'var(--text)', padding: '6px 10px', background: '#f7f9fc', borderRadius: 7 }}>{render(it)}</div>
      ))}
    </div>
  );
}

const EXAM_SHORT = {
  'evaluare-nationala': 'Evaluarea Națională', 'bac-mate-info': 'BAC Mate-Info',
  'bac-stiinte': 'BAC Șt. Naturii', 'bac-tehnologic': 'BAC Tehnologic',
};

function MeditatiiReport({ m }) {
  const chipStyle = { display: 'inline-block', background: 'rgba(15,43,68,.07)', color: 'var(--navy)', borderRadius: 14, padding: '3px 10px', fontSize: '.76rem', fontWeight: 700, marginRight: 6, marginBottom: 4 };
  const errLabels = { calcul: 'greșeli de calcul', formula: 'formule aplicate greșit', concept: 'confuzii între concepte', regula: 'reguli uitate', neatentie: 'neatenție', necunoscut: 'de analizat' };
  return (
    <div style={{ border: '1.5px solid var(--gold)', background: 'rgba(232,185,49,.06)', borderRadius: 10, padding: '12px 14px', marginBottom: 14 }}>
      <div style={{ fontWeight: 700, color: 'var(--navy)', fontSize: '.92rem', marginBottom: 8 }}>🎓 Meditații cu Profesorul Virtual</div>
      <div style={{ marginBottom: 8 }}>
        <span style={chipStyle}>Clasa a {m.grade}-a</span>
        {m.examTarget && <span style={chipStyle}>🎯 {EXAM_SHORT[m.examTarget] || m.examTarget}</span>}
        {m.level && <span style={chipStyle} title="Nivelul stabilit la testul inițial de meditații">Nivel (ev. inițială): {m.level}</span>}
        <span style={chipStyle}>Plan: {m.planProgress}%</span>
        <span style={chipStyle}>⏱ {m.totalMinutes} min de studiu</span>
        {m.streakDays > 0 && <span style={chipStyle}>🔥 {m.streakDays} zile la rând</span>}
      </div>
      <div style={{ fontSize: '.83rem', color: 'var(--text)', lineHeight: 1.6 }}>
        <div><strong>Capitole finalizate ({m.chaptersDone.length}):</strong> {m.chaptersDone.length ? m.chaptersDone.join('; ') : 'încă niciunul'}</div>
        {m.inProgress.length > 0 && <div><strong>În lucru:</strong> {m.inProgress.join('; ')}</div>}
        <div><strong>Teme:</strong> {m.homework.done}/{m.homework.total} finalizate{m.homework.incomplete ? ` (${m.homework.incomplete} incomplet${m.homework.incomplete === 1 ? 'ă' : 'e'} — se pot relua oricând)` : ''}{m.homework.avgPercent != null ? ` · medie ${m.homework.avgPercent}%` : ''}{m.homework.pending ? ` · ${m.homework.pending} în așteptare` : ''}</div>
        {(m.recentResults || []).length > 0 && (
          <div style={{ marginTop: 6 }}>
            <strong>Rezultate recente (exerciții, recapitulări, simulări):</strong>
            {m.recentResults.map((r, i) => {
              const kindIcon = { evaluare: '🧭', exercitii: '✍️', remediere: '🩹', recapitulare: '🔁', simulare: '🎯', tema: '📚' }[r.kind] || '✍️';
              const p = r.maxScore ? Math.round((r.score / r.maxScore) * 100) : 0;
              return (
                <div key={i} style={{ marginTop: 3 }}>
                  {kindIcon} {r.label}{r.topic ? ` · ${EXAM_SHORT[r.topic] || r.topic}` : ''} — <strong>{r.score}/{r.maxScore} ({p}%){notaDinScor(r.score, r.maxScore) != null ? ` · nota ${notaDinScor(r.score, r.maxScore)}` : ''}</strong>
                  <span style={{ color: 'var(--text-muted)' }}> · {dt(r.at)}</span>
                </div>
              );
            })}
          </div>
        )}
        {(m.difficulties.weakChapters.length > 0 || m.difficulties.topErrors.length > 0) && (
          <div><strong>Dificultăți:</strong> {[
            m.difficulties.weakChapters.length ? `capitole slabe: ${m.difficulties.weakChapters.join('; ')}` : null,
            m.difficulties.topErrors.length ? `tipuri de greșeli: ${m.difficulties.topErrors.map((e) => `${errLabels[e.type] || e.type} (${e.count}×)`).join(', ')}` : null,
          ].filter(Boolean).join(' · ')}</div>
        )}
        <div style={{ marginTop: 6, padding: '7px 10px', background: '#fff', borderRadius: 8 }}>
          <strong>💡 Recomandări pentru perioada următoare:</strong>
          {m.recommendations.map((r, i) => <div key={i} style={{ marginTop: 3 }}>• {r}</div>)}
        </div>
      </div>
    </div>
  );
}

function ChildDetail({ d }) {
  const lib = d.library || {};
  const scoreTxt = (it) => {
    if (it.score == null || !it.max_score) return '';
    const nota = notaDinScor(it.score, it.max_score);
    return ` — scor ${it.score}/${it.max_score}${nota != null ? ` · nota ${nota}` : ''}`;
  };
  return (
    <div>
      {d.meditatii
        ? <MeditatiiReport m={d.meditatii} />
        : <div style={{ fontSize: '.8rem', color: 'var(--text-muted)', marginBottom: 12 }}>🎓 Nu folosește încă „Meditații cu Profesorul Virtual".</div>}

      <Section title="📄 Subiecte de examen generate (PDF)" count={(lib.exam || []).length}>
        <List items={lib.exam} empty="Niciunul încă." render={(it) => <>{it.title} <span style={{ color: 'var(--text-muted)' }}>· {dt(it.created_at)}</span></>} />
      </Section>

      <Section title="🧩 Exerciții interactive generate + rezultate" count={(lib.interactive || []).length}>
        <List items={lib.interactive} empty="Niciunul încă." render={(it) => <>{it.title}{scoreTxt(it)} <span style={{ color: 'var(--text-muted)' }}>· {dt(it.completed_at || it.created_at)}</span></>} />
      </Section>

      <Section title="🏛️ Exerciții din Biblioteca utilizatorilor rezolvate" count={(d.publicSolved || []).length}>
        <List items={d.publicSolved} empty="Niciunul încă."
          render={(a) => <>{a.title} <span style={{ color: 'var(--text-muted)' }}>· scor {a.score}/{a.maxScore}{notaDinScor(a.score, a.maxScore) != null ? ` · nota ${notaDinScor(a.score, a.maxScore)}` : ''} · {a.attempts} încercări · {dt(a.completedAt)}</span></>} />
      </Section>

      <Section title="👩‍🏫 Exerciții primite de la profesor + rezolvate" count={(d.assignments || []).length}>
        <List items={d.assignments} empty="Niciunul (funcția de trimitere de la profesor se activează separat)."
          render={(a) => <>{a.title} <span style={{ color: 'var(--text-muted)' }}>· generat de {a.creatorRole === 'parinte' ? 'părintele' : 'profesorul'} {a.creator || ''} · scor {a.score}/{a.maxScore}{notaDinScor(a.score, a.maxScore) != null ? ` · nota ${notaDinScor(a.score, a.maxScore)}` : ''} · {a.attempts} încercări</span></>} />
      </Section>

      <Section title="💬 Întrebări puse Profesorului Virtual">
        <div style={{ fontSize: '.83rem', color: 'var(--text)' }}>
          Învață/explicații: <strong>{(d.chat?.tutor || 0) + (d.chat?.explain || 0)}</strong> · Cere indicii: <strong>{d.chat?.hint || 0}</strong> · Total întrebări: <strong>{d.chat?.total || 0}</strong>
        </div>
      </Section>

      <details style={{ marginBottom: 6 }}>
        <summary style={{ cursor: 'pointer', fontWeight: 700, color: 'var(--navy)', fontSize: '.9rem' }}>📈 Progresul pe subiecte ({(d.mastery || []).length})</summary>
        <div style={{ marginTop: 8 }}>
          <List items={d.mastery} empty="Încă fără date de progres."
            render={(m) => <><strong>{m.topic}</strong> <span style={{ color: 'var(--text-muted)' }}>· {m.category || 'general'} · stăpânire {pct(m.mastery)} · {m.attempts} încercări</span></>} />
        </div>
      </details>
    </div>
  );
}
