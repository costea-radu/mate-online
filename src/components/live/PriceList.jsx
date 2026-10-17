// =====================================================================
// src/components/live/PriceList.jsx — „💳 Prețuri" din lobby-ul meditațiilor live
//
// Lista prețurilor, cu și fără abonament: ședința de grup (20 lei), ședința
// 1-la-1 (30 lei — un subiect întreg sau un singur tip de exercițiu), Pregătirea
// de examen („Planul meu", tot 1-la-1 — aceleași 8 incluse) și meditațiile gratuite. Sumele vin de la server (`prices` din acțiunea
// `program` — aceleași care se încasează; se schimbă din env, fără cod);
// abonamentul, din src/lib/plans.js (ca pe pagina /preturi).
// =====================================================================
import { useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { PLANS } from '../../lib/plans';

const plural = (n, one, many) => (n === 1 ? one : many);

export default function PriceList({ prices, timesLabel, roomsCount, freeCount = 0, freeScope = '', me = null, onClose }) {
  const closeRef = useRef(null);
  useEffect(() => {
    const back = document.activeElement;            // la închidere, focusul revine pe „💳 Prețuri"
    closeRef.current?.focus();
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('keydown', onKey); back?.focus?.(); };
  }, [onClose]);

  const p = prices || {};
  const grup = p.grup ?? 20;
  const privat = p.privat ?? 30;
  const min = p.privatMin ?? 60;
  const incluse = p.privatIncluse ?? 8;
  const gratuite = p.gratuiteLuna ?? 4;
  const rows = [
    { id: 'grup', title: '👥 Ședință de grup', desc: `zilnic, ${timesLabel}, câte un subiect în ${roomsCount} ${plural(roomsCount, 'sală', 'săli')}`,
      fara: `${grup} lei / ședință`, cu: 'inclusă, oricâte' },
    { id: 'privat', title: '🎓 Ședință 1-la-1', desc: `oricând: un subiect întreg sau un singur tip de exercițiu — ${min} de minute, prelungite până termini`,
      fara: `${privat} lei / ședință`, cu: `${incluse} pe lună incluse, apoi ${privat} lei` },
    { id: 'pregatire', title: '📚 Pregătire de examen', desc: 'din „Planul meu" — 1-la-1 în clasă, exercițiu cu exercițiu',
      fara: `${privat} lei / ședință`, cu: `din aceleași ${incluse} incluse, apoi ${privat} lei` },
    // câte una pe examen (freeScope: „pentru fiecare examen" / „la Evaluarea Națională și …")
    ...(freeCount > 0 ? [{ id: 'gratuit', title: '🎁 Meditații gratuite', desc: `${plural(freeCount, 'o lecție 1-la-1', 'câte o lecție 1-la-1')}${freeScope ? ` ${freeScope}` : ''}`,
      fara: `gratuit, cu cont (cel mult ${gratuite} pe lună)`, cu: `gratuit — nu consumă cele ${incluse} incluse` }] : []),
  ];

  const priv = me?.private || null;
  const mine = [];
  if (me?.loggedIn) {
    if (me.admin) mine.push('✓ Cont de administrator — acces nelimitat.');
    else if (priv?.included > 0) mine.push(`✓ Luna aceasta mai ai ${priv.includedLeft} din ${priv.included} ședințe 1-la-1 incluse.`);
    if (priv?.unusedTickets > 0) mine.push(`🎟 Ai ${priv.unusedTickets} ${plural(priv.unusedTickets, 'bilet 1-la-1 nefolosit', 'bilete 1-la-1 nefolosite')}.`);
    if (me.free && freeCount > 0) mine.push(`🎁 Mai ai ${me.free.left} din ${me.free.monthly} meditații gratuite luna aceasta.`);
  }
  const [lunar, anual] = [PLANS.find((x) => x.id === 'lunar'), PLANS.find((x) => x.id === 'anual')];

  return (
    <div className="lvp-backdrop" onClick={onClose}>
      <div className="lvp" role="dialog" aria-modal="true" aria-labelledby="lvp-title" onClick={(e) => e.stopPropagation()}>
        <div className="lvp-head">
          <h2 id="lvp-title">💳 Prețuri — meditații live</h2>
          <button ref={closeRef} type="button" className="lvp-x" onClick={onClose} aria-label="Închide lista de prețuri">✕</button>
        </div>
        <div className="lvp-table" role="table" aria-label="Prețurile meditațiilor">
          <div className="lvp-tr lvp-th" role="row">
            <span role="columnheader">Meditația</span>
            <span role="columnheader">Fără abonament</span>
            <span role="columnheader">Cu abonament</span>
          </div>
          {rows.map((r) => (
            <div key={r.id} className="lvp-tr" role="row">
              <span className="lvp-what" role="rowheader"><b>{r.title}</b><small>{r.desc}</small></span>
              <span className="lvp-cell" role="cell" data-label="Fără abonament">{r.fara}</span>
              <span className="lvp-cell is-sub" role="cell" data-label="Cu abonament">{r.cu}</span>
            </div>
          ))}
        </div>
        <ul className="lvp-notes">
          <li>Prelungirea peste {min} de minute, cât lucrezi, e <b>fără cost în plus</b>.</li>
          <li>Ședința inclusă sau biletul se consumă abia când pornește lecția.</li>
          <li>Un bilet 1-la-1 merge oriunde: la o ședință 1-la-1 live sau la Pregătirea de examen.</li>
        </ul>
        {mine.length > 0 && <div className="lvp-mine">{mine.map((t) => <span key={t}>{t}</span>)}</div>}
        <div className="lvp-sub">
          {me?.premium && !me?.admin
            ? <span>✓ Ai abonament ExamenMate.</span>
            : <span>Abonamentul: <b>{lunar?.pret} lei / lună</b> sau <b>{anual?.pret} lei / an</b>{anual?.economie ? ` (${anual.economie})` : ''}.</span>}
          {!me?.premium && !me?.admin && <Link to="/preturi" className="lv-btn-primary" onClick={onClose}>Vezi abonamentul →</Link>}
        </div>
      </div>
    </div>
  );
}
