// =====================================================================
// src/components/CapitolePicker.jsx — selector de CAPITOLE reutilizabil:
// rolldown (dropdown) cu lista capitolelor programei (grupate pe clase),
// capitolele alese apar ca etichete cu ✕, plus un câmp liber în care se
// poate scrie un capitol care lipsește din listă sau alte indicații
// pentru AI. Folosit de:
//   • profesor → „Generează subiect examen” (PDF) și „Generează interactiv”;
//   • elev → Meditații cu AI → „Pregătire pentru lucrare/test”.
// props:
//   options      [{ id, title, group? }] — capitolele din listă
//   selected     [id, ...]               — capitolele alese
//   onChange     (ids) => void
//   extraText    string                  — capitol lipsă / alte indicații
//   onExtraText  (text) => void
//   label / extraLabel / extraPlaceholder / hint — texte opționale
//   max          numărul maxim de capitole selectabile (implicit 12)
// =====================================================================

const lbl = { fontSize: '.82rem', color: 'var(--text-light)' };
const inp = { border: '1px solid var(--border)', borderRadius: 8, padding: '9px 11px', fontSize: '.9rem', width: '100%', marginTop: 4, boxSizing: 'border-box', fontFamily: 'inherit', background: '#fff' };
const chip = { display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: '.78rem', fontWeight: 600, background: '#eef2fb', color: 'var(--navy)', borderRadius: 20, padding: '3px 8px 3px 12px' };

export default function CapitolePicker({
  options = [], selected = [], onChange, extraText = '', onExtraText,
  label = 'Capitolele testului (opțional) — gol = toată materia',
  extraLabel = 'Alt capitol (dacă lipsește din listă) sau alte indicații pentru AI (opțional)',
  extraPlaceholder = 'ex: „Ecuații cu modul” · „doar itemi de dificultate medie” · „include o problemă practică”',
  hint = null, max = 12,
}) {
  const byId = (id) => options.find((o) => o.id === id) || null;
  const groups = [...new Set(options.map((o) => o.group || ''))];

  const add = (id) => {
    if (!id || selected.includes(id) || selected.length >= max) return;
    onChange?.([...selected, id]);
  };
  const del = (id) => onChange?.(selected.filter((x) => x !== id));

  return (
    <div style={{ marginBottom: 10 }}>
      <label style={{ ...lbl, display: 'block' }}>{label}
        <select value="" disabled={selected.length >= max} style={inp}
          onChange={(e) => { add(e.target.value); e.target.value = ''; }}>
          <option value="">➕ adaugă un capitol din listă…</option>
          {groups.map((g) => (
            g
              ? (
                <optgroup key={g} label={g}>
                  {options.filter((o) => (o.group || '') === g).map((o) => (
                    <option key={o.id} value={o.id} disabled={selected.includes(o.id)}>{o.title}</option>
                  ))}
                </optgroup>
              )
              : options.filter((o) => !o.group).map((o) => (
                <option key={o.id} value={o.id} disabled={selected.includes(o.id)}>{o.title}</option>
              ))
          ))}
        </select>
      </label>
      {selected.length > 0 && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
          {selected.map((id) => {
            const o = byId(id);
            return (
              <span key={id} style={chip}>
                📘 {o ? o.title : id}
                <button onClick={() => del(id)} title="Scoate capitolul"
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#c0392b', fontWeight: 800, fontSize: '.8rem', padding: 0 }}>✕</button>
              </span>
            );
          })}
        </div>
      )}
      {onExtraText && (
        <label style={{ ...lbl, display: 'block', marginTop: 8 }}>{extraLabel}
          <textarea value={extraText} onChange={(e) => onExtraText(e.target.value)} rows={2}
            placeholder={extraPlaceholder} style={{ ...inp, resize: 'vertical' }} />
        </label>
      )}
      {hint && <div style={{ fontSize: '.72rem', color: 'var(--text-muted)', marginTop: 4 }}>{hint}</div>}
    </div>
  );
}
