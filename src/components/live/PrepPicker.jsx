// =====================================================================
// src/components/live/PrepPicker.jsx — „Pregătire de examen": elevul alege
// ORICE exercițiu din examen, nu neapărat la rând — Subiectul I ex. 5,
// Subiectul al II-lea ex. 2 b), Subiectul al III-lea ex. 1 c) … (la BAC,
// problemele de la Subiectele II și III se pot exersa și pe subpuncte).
// Folosit la intrarea în clasă, în „🗺️ Plan" (sala) și în cardul din „Planul meu".
// =====================================================================
const SUB_LABEL = { I: 'Subiectul I', II: 'Subiectul al II-lea', III: 'Subiectul al III-lea' };
const STATE = { stapanit: 'is-ok', in_lucru: 'is-work' };

export default function PrepPicker({ positions = [], current = null, selected = null, onPick, compact = false, dark = false, defaultLabel = null, onDefault = null, disabled = false }) {
  const main = positions.filter((p) => !p.parent);
  const subsOf = (pos) => positions.filter((p) => p.parent === pos);
  const groups = ['I', 'II', 'III'].map((s) => ({ s, list: main.filter((p) => p.sub === s) })).filter((g) => g.list.length);
  const chip = (p, text) => {
    const on = selected ? selected === p.pos : current === p.pos;
    return (
      <button key={p.pos} type="button" disabled={disabled} onClick={() => onPick && onPick(p)}
        className={`pp-chip ${STATE[p.status] || ''}${on ? ' is-on' : ''}`}
        title={`${p.label}${p.mastered ? ' · testul trecut ✓' : p.done ? ` · ${p.done} ${p.done === 1 ? 'exercițiu lucrat' : 'exerciții lucrate'}` : ''}`}>
        {text}{p.mastered ? <i aria-hidden="true">✓</i> : null}
      </button>
    );
  };
  return (
    <div className={`pp${compact ? ' is-compact' : ''}${dark ? ' is-dark' : ''}`}>
      {defaultLabel && (
        <button type="button" disabled={disabled} className={`pp-chip is-wide${!selected ? ' is-on' : ''}`} onClick={onDefault}>▶ {defaultLabel}</button>
      )}
      {groups.map((g) => (
        <div key={g.s} className="pp-sec">
          <div className="pp-head">{SUB_LABEL[g.s]}</div>
          <div className="pp-row">
            {g.list.map((p) => {
              const subs = subsOf(p.pos);
              if (!subs.length) return chip(p, `${p.ex}`);
              return (
                <span key={p.pos} className="pp-ex">
                  {chip(p, `Ex. ${p.ex}`)}
                  {subs.map((sp) => chip(sp, `${sp.letter})`))}
                </span>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
