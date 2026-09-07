// =====================================================================
// test/credite-ciclu.test.js — RESETAREA creditelor AI la interval FIX
//
// Înainte, bugetul „lunar" se măsura pe ultimele 30 de zile RULANTE: creditele
// nu se resetau niciodată, se eliberau firimitură cu firimitură, iar elevului
// nu i se putea spune CÂND își recapătă bugetul. Acum ciclul e fix (ziua 1 a
// lunii, ora 00:00 a României), deci data resetării se poate calcula dinainte.
// Rulare: npm test   (node --test test/*.test.js)
// =====================================================================
const test = require('node:test');
const assert = require('node:assert');
const ai = require('../api/_lib/ai.js');

// ora locală (România) a unui instant, ca „YYYY-MM-DD HH:mm"
const roOra = (iso) => new Intl.DateTimeFormat('sv-SE', {
  timeZone: 'Europe/Bucharest', hour12: false,
  year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
}).format(new Date(iso));

test('cycleInfo: ciclul începe și se termină la 00:00, ora României', () => {
  const c = ai.cycleInfo(new Date('2026-09-07T12:00:00+03:00'));
  assert.strictEqual(roOra(c.startsAt), '2026-09-01 00:00');
  assert.strictEqual(roOra(c.resetsAt), '2026-10-01 00:00');
  assert.strictEqual(c.resetLabel, '1 octombrie 2026');
});

test('cycleInfo: rezistă la schimbarea orei de vară (ultima duminică din octombrie)', () => {
  // 5 noiembrie e DUPĂ trecerea la ora de iarnă; granițele trebuie să rămână
  // la miezul nopții local, nu la 23:00 sau 01:00.
  const c = ai.cycleInfo(new Date('2026-11-05T10:00:00+02:00'));
  assert.strictEqual(roOra(c.startsAt), '2026-11-01 00:00');
  assert.strictEqual(roOra(c.resetsAt), '2026-12-01 00:00');
  // ciclul care ÎNCEPE înainte de schimbare și se termină după ea
  const oct = ai.cycleInfo(new Date('2026-10-20T10:00:00+03:00'));
  assert.strictEqual(roOra(oct.startsAt), '2026-10-01 00:00');
  assert.strictEqual(roOra(oct.resetsAt), '2026-11-01 00:00');
});

test('cycleInfo: peste ani, ciclul lui decembrie trece în ianuarie', () => {
  const c = ai.cycleInfo(new Date('2026-12-20T09:00:00+02:00'));
  assert.strictEqual(roOra(c.startsAt), '2026-12-01 00:00');
  assert.strictEqual(roOra(c.resetsAt), '2027-01-01 00:00');
});

test('cycleInfo: la o secundă după resetare începe ciclul NOU (nu se agață de cel vechi)', () => {
  const c = ai.cycleInfo(new Date('2026-10-01T00:00:01+03:00'));
  assert.strictEqual(roOra(c.startsAt), '2026-10-01 00:00');
  assert.strictEqual(roOra(c.resetsAt), '2026-11-01 00:00');
  assert.ok(c.msLeft > 0, 'mai are de așteptat până la resetarea următoare');
});

test('cycleInfo: fereastra e ÎNTOTDEAUNA în trecut și acoperă momentul curent', () => {
  // exact cazul care contează: `startsAt` se dă ca `p_month_start` la SQL
  for (const iso of ['2026-01-01T00:00:00Z', '2026-03-29T04:00:00Z', '2026-06-15T23:59:00Z',
                     '2026-10-25T02:30:00Z', '2027-02-28T21:00:00Z']) {
    const now = new Date(iso);
    const c = ai.cycleInfo(now);
    assert.ok(new Date(c.startsAt) <= now, `startsAt după acum, la ${iso}`);
    assert.ok(new Date(c.resetsAt) > now, `resetsAt înainte de acum, la ${iso}`);
    assert.ok(c.days >= 28 && c.days <= 31, `ciclu de ${c.days} zile la ${iso}`);
    assert.strictEqual(c.msLeft, new Date(c.resetsAt).getTime() - now.getTime());
  }
});

test('cycleStart: e chiar startul ciclului (ce se trimite la ai_spent)', () => {
  const now = new Date('2026-09-07T12:00:00+03:00');
  assert.strictEqual(ai.cycleStart(now), ai.cycleInfo(now).startsAt);
});

test('fmtRamas: plural românesc corect, cu „de" de la 20 în sus', () => {
  assert.strictEqual(ai.fmtRamas(0), 'mai puțin de un minut');
  assert.strictEqual(ai.fmtRamas(30 * 1000), 'mai puțin de un minut');
  assert.strictEqual(ai.fmtRamas(60 * 1000), '1 minut');
  assert.strictEqual(ai.fmtRamas(5 * 60000), '5 minute');
  assert.strictEqual(ai.fmtRamas(20 * 60000), '20 de minute');
  assert.strictEqual(ai.fmtRamas(3600000), '1 oră');
  assert.strictEqual(ai.fmtRamas(2 * 3600000 + 21 * 60000), '2 ore și 21 de minute');
  assert.strictEqual(ai.fmtRamas(21 * 3600000), '21 de ore');
  assert.strictEqual(ai.fmtRamas(86400000), '1 zi');
  assert.strictEqual(ai.fmtRamas(3 * 86400000), '3 zile');
  assert.strictEqual(ai.fmtRamas(23 * 86400000 + 12 * 3600000), '23 de zile și 12 ore');
  assert.strictEqual(ai.fmtRamas(31 * 86400000), '31 de zile');
});

test('cycleInfo: `resetIn` e chiar traducerea lui `msLeft`', () => {
  const now = new Date('2026-09-07T12:00:00+03:00');
  const c = ai.cycleInfo(now);
  assert.strictEqual(c.resetIn, ai.fmtRamas(c.msLeft));
  assert.strictEqual(c.daysLeft, Math.floor(c.msLeft / 86400000));
});
