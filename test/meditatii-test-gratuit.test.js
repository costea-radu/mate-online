// Testul inițial GRATUIT pentru elevii asociați cu un părinte.
// Verifică poarta de acces din api/ai-meditatii.js: cine primește testul fără
// abonament, cine nu, și cum se numără șansa gratuită.
const test = require('node:test');
const assert = require('node:assert');

const med = require('../api/ai-meditatii.js');

// ─── Supabase simulat: doar interogările folosite de poartă ─────────────────
// parentLinks  = rândurile din `mentor_students` pentru elevul curent
// assessments  = câte sesiuni 'evaluare' FINALIZATE are elevul
function fakeSupa({ parentLinks = [], assessments = 0, tableMissing = false } = {}) {
  return {
    from(table) {
      const q = {
        _filters: {},
        select(_cols, opts) { q._head = !!(opts && opts.head); return q; },
        eq(col, val) { q._filters[col] = val; return q; },
        neq(col, val) { q._filters['neq:' + col] = val; return q; },
        limit() {
          if (tableMissing) return Promise.resolve({ data: null, error: { message: 'relation does not exist' } });
          return Promise.resolve({ data: parentLinks, error: null });
        },
        then(resolve) { // `select(..., {head:true})` se așteaptă direct
          if (table === 'ai_meditatii_sessions') {
            return Promise.resolve({ count: assessments, error: null }).then(resolve);
          }
          return Promise.resolve({ data: parentLinks, error: null }).then(resolve);
        },
      };
      return q;
    },
  };
}

const elev = { id: 'u1', is_admin: false, subscription_status: null };
const abonat = { id: 'u2', is_admin: false, subscription_status: 'active' };
const adminUser = { id: 'u3', is_admin: true, subscription_status: null };

test('elev asociat cu un părinte primește testul inițial gratuit', async () => {
  const supa = fakeSupa({ parentLinks: [{ mentor_id: 'p1' }], assessments: 0 });
  const r = await med.requireAssessmentAccess(supa, 'u1', elev, { generating: true });
  assert.strictEqual(r.free, true);
});

test('elev FĂRĂ părinte asociat este trimis către asociere, nu către plată', async () => {
  const supa = fakeSupa({ parentLinks: [], assessments: 0 });
  await assert.rejects(
    () => med.requireAssessmentAccess(supa, 'u1', elev, { generating: true }),
    (e) => {
      assert.strictEqual(e.status, 402);
      assert.strictEqual(e.code, 'PARENT_LINK_REQUIRED');
      assert.match(e.message, /părinte/i);
      return true;
    },
  );
});

test('un elev asociat cu un profesor (nu părinte) nu primește testul gratuit', async () => {
  // interogarea filtrează mentor_role='parinte', deci lista vine goală
  const supa = fakeSupa({ parentLinks: [], assessments: 0 });
  await assert.rejects(() => med.requireAssessmentAccess(supa, 'u1', elev, { generating: true }));
});

test('testul gratuit se dă o singură dată', async () => {
  const supa = fakeSupa({ parentLinks: [{ mentor_id: 'p1' }], assessments: 1 });
  await assert.rejects(
    () => med.requireAssessmentAccess(supa, 'u1', elev, { generating: true }),
    (e) => { assert.strictEqual(e.code, 'PREMIUM_REQUIRED'); return true; },
  );
});

test('testul deja început poate fi TRIMIS chiar dacă șansa gratuită s-a consumat', async () => {
  // fără `generating` nu se mai numără — altfel elevul rămâne cu testul necorectat
  const supa = fakeSupa({ parentLinks: [{ mentor_id: 'p1' }], assessments: 1 });
  const r = await med.requireAssessmentAccess(supa, 'u1', elev);
  assert.strictEqual(r.free, true);
});

test('abonatul și adminul trec fără să atingă baza de date', async () => {
  const explodeaza = { from() { throw new Error('nu ar trebui interogat'); } };
  assert.deepStrictEqual(await med.requireAssessmentAccess(explodeaza, 'u2', abonat, { generating: true }), { free: false });
  assert.deepStrictEqual(await med.requireAssessmentAccess(explodeaza, 'u3', adminUser, { generating: true }), { free: false });
});

test('tabela mentor_students lipsă → refuz curat, nu eroare 500', async () => {
  const supa = fakeSupa({ tableMissing: true });
  await assert.rejects(
    () => med.requireAssessmentAccess(supa, 'u1', elev, { generating: true }),
    (e) => { assert.strictEqual(e.status, 402); return true; },
  );
});
