import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';

// Harta categorii → rute
const CATEGORY_ROUTES = {
  'clasa-5': '/clase/5', 'clasa-6': '/clase/6', 'clasa-7': '/clase/7', 'clasa-8': '/clase/8',
  'clasa-9': '/clase/9', 'clasa-10': '/clase/10', 'clasa-11': '/clase/11', 'clasa-12': '/clase/12',
  'evaluare-nationala': '/evaluare-nationala', 'bacalaureat': '/bacalaureat/mate-info',
};

const CATEGORY_LABELS = {
  'clasa-5':'Clasa a V-a','clasa-6':'Clasa a VI-a','clasa-7':'Clasa a VII-a','clasa-8':'Clasa a VIII-a',
  'clasa-9':'Clasa a IX-a','clasa-10':'Clasa a X-a','clasa-11':'Clasa a XI-a','clasa-12':'Clasa a XII-a',
  'evaluare-nationala':'Evaluare Națională','bacalaureat':'Bacalaureat',
};

function ProgressBar({ value, max, color = 'var(--gold)' }) {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0;
  return (
    <div>
      <div style={{ display:'flex', justifyContent:'space-between', fontSize:'0.75rem', color:'var(--text-muted)', marginBottom:4 }}>
        <span>{value} / {max} exerciții</span>
        <span style={{ fontWeight:700, color: pct >= 80 ? '#2e7d32' : pct >= 50 ? '#e65100' : 'var(--text-muted)' }}>{pct}%</span>
      </div>
      <div style={{ height:8, background:'#eef0f4', borderRadius:20, overflow:'hidden' }}>
        <div style={{ height:'100%', width:`${pct}%`, background: pct >= 80 ? '#2e7d32' : pct >= 50 ? '#e65100' : color, borderRadius:20, transition:'width 0.6s ease' }} />
      </div>
    </div>
  );
}

export default function UserProgress() {
  const { user } = useAuth();
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    loadStats();
  }, [user]);

  async function loadStats() {
    setLoading(true);
    // Încarcă progresul exercițiilor interactive
    const { data: progressData } = await supabase
      .from('progress')
      .select('content_id, score, max_score')
      .eq('user_id', user.id);

    // Încarcă toate exercițiile interactive cu categoria lor
    const { data: allInteractive } = await supabase
      .from('content')
      .select('id, category, content_type')
      .eq('content_type', 'interactive');

    if (!progressData || !allInteractive) { setLoading(false); return; }

    const completedIds = new Set(progressData.map(p => p.content_id));
    const avgScore = progressData.length > 0
      ? Math.round(progressData.reduce((acc, p) => acc + (p.score / p.max_score) * 100, 0) / progressData.length)
      : 0;

    // Grupăm pe categorii
    const byCategory = {};
    for (const item of allInteractive) {
      const cat = item.category;
      if (!CATEGORY_LABELS[cat]) continue;
      if (!byCategory[cat]) byCategory[cat] = { total: 0, done: 0 };
      byCategory[cat].total++;
      if (completedIds.has(item.id)) byCategory[cat].done++;
    }

    setStats({ byCategory, total: allInteractive.length, done: progressData.length, avgScore });
    setLoading(false);
  }

  if (!user) return null;

  return (
    <div style={{ background:'#fff', borderRadius:14, border:'1.5px solid #eef0f4', padding:'24px 28px', boxShadow:'0 2px 8px rgba(15,43,68,0.06)' }}>
      <h3 style={{ fontFamily:'var(--font-display)', color:'var(--navy)', fontSize:'1.1rem', marginBottom:20 }}>
        📊 Progresul meu
      </h3>

      {loading ? (
        <div style={{ color:'var(--text-muted)', fontSize:'0.88rem' }}>Se încarcă...</div>
      ) : !stats ? (
        <div style={{ color:'var(--text-muted)', fontSize:'0.88rem' }}>Nu există date de progres.</div>
      ) : (
        <>
          {/* Sumar global */}
          <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:12, marginBottom:24 }}>
            {[
              { label:'Exerciții rezolvate', value: stats.done, icon:'✅' },
              { label:'Total disponibile', value: stats.total, icon:'📚' },
              { label:'Scor mediu', value: stats.avgScore + '%', icon:'🎯' },
            ].map(s => (
              <div key={s.label} style={{ background:'#f7f9fc', borderRadius:10, padding:'14px', textAlign:'center' }}>
                <div style={{ fontSize:'1.4rem', marginBottom:4 }}>{s.icon}</div>
                <div style={{ fontSize:'1.3rem', fontWeight:800, color:'var(--navy)' }}>{s.value}</div>
                <div style={{ fontSize:'0.72rem', color:'var(--text-muted)', marginTop:2 }}>{s.label}</div>
              </div>
            ))}
          </div>

          {/* Progres per categorie */}
          <div style={{ display:'flex', flexDirection:'column', gap:16 }}>
            {Object.entries(stats.byCategory)
              .filter(([, v]) => v.total > 0)
              .sort((a, b) => b[1].done - a[1].done)
              .map(([cat, v]) => (
                <div key={cat}>
                  <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:6 }}>
                    <Link to={CATEGORY_ROUTES[cat] || '/'} style={{ fontWeight:600, color:'var(--navy)', fontSize:'0.88rem', textDecoration:'none' }}>
                      {CATEGORY_LABELS[cat]}
                    </Link>
                    {v.done > 0 && (
                      <span style={{ fontSize:'0.72rem', background:'#e8f5e9', color:'#2e7d32', padding:'2px 8px', borderRadius:20, fontWeight:700 }}>
                        {v.done} rezolvate
                      </span>
                    )}
                  </div>
                  <ProgressBar value={v.done} max={v.total} />
                </div>
              ))
            }
          </div>

          {stats.done === 0 && (
            <p style={{ color:'var(--text-muted)', fontSize:'0.88rem', textAlign:'center', marginTop:8 }}>
              Începe exercițiile interactive pentru a urmări progresul!
            </p>
          )}
        </>
      )}
    </div>
  );
}
