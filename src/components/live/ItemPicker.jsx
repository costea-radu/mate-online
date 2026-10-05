// =====================================================================
// src/components/live/ItemPicker.jsx — „📋 Exerciții": elevul alege ORICE
// exercițiu din subiect, nu neapărat la rând (ex. Subiectul I ex. 5,
// Subiectul al II-lea ex. 2 b), Subiectul al III-lea ex. 1 c)).
// Folosit în sala live (panoul lateral, 1-la-1) și la intrare („Cu ce începi?").
// =====================================================================
import { groupItems } from '../../lib/live/items';

const MARK = { corect: '✓', gresit: '✗', vazut: '•' };

export default function ItemPicker({ items, current = null, status = {}, onPick, disabled = false, note = null, compact = false, selectedRef = null, allowAll = false, onAll = null }) {
  const secs = groupItems(items);
  if (!secs.length) return <div className="lv-ip-empty">Exercițiile apar imediat ce lecția e pregătită.</div>;
  const chip = (it, text) => {
    const on = selectedRef ? selectedRef === it.ref : current != null && it.item === current;
    const st = it.item != null ? status[it.item] : null;
    return (
      <button key={it.ref} type="button" disabled={disabled}
        className={`lv-ip-chip${on ? ' is-on' : ''}${st ? ` is-${st}` : ''}`}
        title={`${it.title || it.ref}${st === 'corect' ? ' · rezolvat corect' : st === 'gresit' ? ' · de revăzut' : st === 'vazut' ? ' · văzut' : ''}`}
        onClick={() => onPick && onPick(it)}>
        {text}{st && <i aria-hidden="true">{MARK[st]}</i>}
      </button>
    );
  };
  return (
    <div className={`lv-ip${compact ? ' is-compact' : ''}`}>
      {allowAll && (
        <div className="lv-ip-row" style={{ marginBottom: 8 }}>
          <button type="button" className={`lv-ip-chip is-wide${!selectedRef ? ' is-on' : ''}`} onClick={onAll}>▶ De la început, în ordine</button>
        </div>
      )}
      {secs.map((sec) => (
        <div key={sec.section} className="lv-ip-sec">
          <div className="lv-ip-head">{sec.label}</div>
          <div className="lv-ip-row">
            {sec.groups.map((g) => (g.items.length === 1 && !g.items[0].letter
              ? chip(g.items[0], `${g.ex}`)
              : (
                <span key={g.ex} className="lv-ip-ex">
                  <b>Ex. {g.ex}</b>
                  {g.items.map((it) => chip(it, `${it.letter})`))}
                </span>
              )))}
          </div>
        </div>
      ))}
      {note && <div className="lv-ip-note">{note}</div>}
    </div>
  );
}
