// Teste pentru GHIDUL SITE-ULUI din widgetul Profesorului Virtual (api/_lib/siteGuide.js):
// întrebările care nu sunt o problemă de matematică („ajută-mă la subiectul 1 bac")
// primesc, FĂRĂ model, structura oficială a examenului + linkurile din site;
// cele de matematică merg la profesor (modelul), cu trimiteri spre meditații și
// teste interactive dedesubt. Plus integrarea în api/ai-chat.js (Supabase în memorie).
const test = require('node:test');
const assert = require('node:assert');
const G = require('../api/_lib/siteGuide');

const kindOf = (message, extra = {}) => { const r = G.route({ message, context: { page: '/' }, ...extra }); return r ? r.kind : 'AI'; };

test('ce merge la ghid și ce merge la profesor (modelul)', () => {
  const cases = {
    'ajută-mă la subiectul 1 bac': 'exam',
    'Ajuta-ma la subiectul I la bac mate-info': 'exam',
    'cum mă pregătesc pentru bac?': 'exam',
    'rezolvă subiectul 1 din varianta 3 bac 2024': 'exam',
    'vreau meditații': 'meditatii',
    'cât costă abonamentul?': 'preturi',
    'am uitat parola': 'cont',
    'bună': 'hello',
    'mulțumesc': 'thanks',
    'clasa a 6-a': 'clasa',
    'exercitii pentru clasa a 7a': 'clasa',
    'cum functioneaza site-ul?': 'general',
    // matematică → profesorul
    'rezolvă ecuația x^2-5x+6=0': 'AI',
    'ce este un polinom?': 'AI',
    'ajută-mă la subiectul 2 bac la matrice': 'AI',
    'cât face 25% din 80?': 'AI',
    'explică-mi teorema lui Pitagora': 'AI',
    'cum se calculează aria unui triunghi?': 'AI',
    // neclar / în afara școlii → profesorul (promptul îl readuce la matematică și la site)
    'nu înțeleg': 'AI',
    'cine a câștigat meciul?': 'AI',
  };
  for (const [q, want] of Object.entries(cases)) assert.strictEqual(kindOf(q), want, q);
});

test('ce a cerut: examenul, profilul, subiectul, exercițiul, subpunctul, clasa', () => {
  const r = G.route({ message: 'exercițiul 2 b de la subiectul 3 bac mate info', context: {} });
  assert.deepStrictEqual({ e: r.exam, p: r.profile, s: r.sub, x: r.ex, l: r.letter }, { e: 'bac', p: 'mate-info', s: 'III', x: 2, l: 'b' });
  assert.strictEqual(G.route({ message: 'ajută-mă la subiectul al doilea la evaluare', context: {} }).sub, 'II');
  assert.strictEqual(G.route({ message: 'ajută-mă la subiectul 2 la evaluare', context: {} }).exam, 'en');
  // pagina completează ce n-a spus elevul
  const t = G.route({ message: 'ajută-mă la subiectul 1', context: { page: '/bacalaureat/tehnologic' } });
  assert.deepStrictEqual({ e: t.exam, p: t.profile, s: t.sub }, { e: 'bac', p: 'tehnologic', s: 'I' });
});

test('„ajută-mă la subiectul 1 bac": structura corectă (fără polinoame) și unde îl lucrează pe site', () => {
  const a = G.answer(G.route({ message: 'ajută-mă la subiectul 1 bac', context: {} }));
  assert.match(a, /Subiectul I la BAC/);
  assert.match(a, /6 exerciții scurte, câte 5 puncte/);
  assert.doesNotMatch(a, /polinom/i, 'polinoamele sunt la Subiectul al II-lea');
  assert.match(a, /\[Începe cu Subiectul I, exercițiul 1\]\(\/meditatii\/pregatire\?pos=I\.1\)/);
  // etichetele linkurilor fără „. " (widgetul împarte textul în propoziții pentru voce)
  for (const [, label] of a.matchAll(/\[([^\]]+)\]\(\//g)) assert.doesNotMatch(label, /\.\s/, label);
  assert.match(a, /\]\(\/meditatii\)/);
  assert.match(a, /\]\(\/bacalaureat\)/);
  assert.match(a, /\]\(\/bacalaureat\?tab=pdf\)/);
  assert.match(a, /Scrie-mi enunțul/);
  // BAC: polinoamele apar la Subiectul al II-lea, ex. 2
  const ii = G.answer(G.route({ message: 'ce se dă la subiectul 2 la bac?', context: {} }));
  assert.match(ii, /ex\. 2: legi de compoziție sau polinoame/);
  // exercițiul exact, cu profilul
  const b = G.answer(G.route({ message: 'exercițiul 2 b de la subiectul 3 bac mate info', context: {} }));
  assert.match(b, /pregatire\?pos=III\.2\.b\)/);
  assert.match(b, /\(\/bacalaureat\/mate-info\)/);
  assert.match(b, /\(\/bacalaureat\/mate-info\?tab=pdf\)/);
  // EN: structura cu cele 3 subiecte
  const en = G.answer(G.route({ message: 'cum mă pregătesc pentru evaluarea națională?', context: {} }));
  assert.match(en, /3 subiecte × 30 de puncte/);
  assert.match(en, /\(\/evaluare-nationala\?tab=pdf\)/);
  // prețurile vin din setările meditațiilor (aceleași ca la plată)
  assert.match(G.answer(G.route({ message: 'cât costă meditatia 1 la 1?', context: {} })), /1-la-1, oricând\*\*[^\n]*— 30 lei/);
});

test('ghidul nu intervine pe un PDF / test deschis, pe tabla din Planul meu, la profesori/părinți, cu poze sau la „Regenerează"', () => {
  const q = 'ajută-mă la subiectul 1 bac';
  for (const context of [{ pdf: true }, { interactive: true }, { meditatii: true }, { contentId: 'x' }, { exerciseText: 'Calculați…' }]) {
    assert.strictEqual(G.route({ message: q, context }), null, JSON.stringify(context));
  }
  assert.strictEqual(G.route({ message: q, mode: 'exams' }), null);
  assert.strictEqual(G.route({ message: q, images: ['data:image/png;base64,AAA'] }), null);
  assert.strictEqual(G.route({ message: q, regenerate: true }), null);
  // într-o discuție în curs: „unde găsesc exerciții de felul ăsta?" ține de subiectul discuției
  assert.strictEqual(G.route({ message: 'unde găsesc exerciții de felul ăsta?', conversationId: 'c1' }), null);
  assert.strictEqual(G.route({ message: 'vreau meditații', conversationId: 'c1' }).kind, 'meditatii');
});

test('trimiterile de sub o explicație de matematică: prima întrebare sau când pomenește examenul', () => {
  const f = G.footer({ message: 'cum rezolv ecuatia 2x+3=7 de la subiectul 1 bac', context: { page: '/' } });
  assert.match(f, /Teste interactive BAC\]\(\/bacalaureat\)/);
  assert.match(f, /Pregătire de examen: Subiectul I, exercițiul 1\]\(\/meditatii\/pregatire\?pos=I\.1\)/);
  assert.match(f, /Meditații live\]\(\/meditatii\)/);
  assert.match(G.footer({ message: 'ce e un polinom', context: { page: '/clase/7' } }), /\(\/clase\/7\)/);
  assert.match(G.footer({ message: 'ce e un polinom', context: { page: '/' } }), /Planul meu/);
  assert.strictEqual(G.footer({ message: 'și mai departe?', context: { page: '/' }, priorCount: 4 }), '', 'nu la fiecare mesaj');
  assert.notStrictEqual(G.footer({ message: 'dar la bac cum se dă?', context: { page: '/' }, priorCount: 4 }), '');
  assert.strictEqual(G.footer({ message: 'ce e un polinom', context: { pdf: true } }), '');
  assert.strictEqual(G.footer({ message: 'ce e un polinom', context: { page: '/' }, reply: 'Vezi [Teste BAC](/bacalaureat).' }), '', 'modelul a dat deja linkurile');
});

test('promptul profesorului are structura oficială a examenelor (polinoamele la BAC S. II ex. 2)', () => {
  const ai = require('../api/_lib/ai');
  const sys = ai.systemFor('tutor', '(fără context)');
  assert.match(sys, /STRUCTURA OFICIALĂ A EXAMENELOR/);
  assert.match(sys, /Polinoamele și legile de compoziție sunt la Subiectul al II-lea, ex\. 2/);
  assert.match(sys, /\/meditatii\/pregatire/);
});

// ─── integrarea în api/ai-chat.js ─────────────────────────────────────────────
test('api/ai-chat: ghidul răspunde fără model și fără să consume acțiuni AI; matematica merge la model, cu trimiteri', async () => {
  const { createFakeSupabase, fakeRes } = require('./tools/fakeSupabase');
  const ai = require('../api/_lib/ai');
  const handler = require('../api/ai-chat');
  const U = '77777777-7777-4777-8777-777777777777';
  const fake = createFakeSupabase({
    profiles: [{ id: U, subscription_status: null, role: 'elev', is_admin: false }],
    // a folosit deja acțiunile AI gratuite → modelul l-ar refuza
    ai_usage: [{ user_id: U, endpoint: 'ai-chat', created_at: new Date().toISOString() }, { user_id: U, endpoint: 'ai-chat', created_at: new Date().toISOString() }],
    ai_conversations: [], ai_messages: [],
  });
  const saved = { admin: ai.admin, authUser: ai.authUser, chat: ai.chat, prepareChat: ai.prepareChat, enforceRateLimit: ai.enforceRateLimit, enforceFreeQuota: ai.enforceFreeQuota, logUsage: ai.logUsage };
  let modelCalls = 0;
  ai.admin = () => fake;
  ai.authUser = async () => U;
  ai.chat = async () => { modelCalls++; return { text: 'Pentru $x^2=4$ avem $x=\\pm 2$.', usage: { in: 1, out: 1, model: 'test' } }; };
  try {
    const call = async (body) => { const res = fakeRes(); await handler({ method: 'POST', headers: {}, query: {}, body }, res); return res; };
    const r = await call({ message: 'ajută-mă la subiectul 1 bac', context: { page: '/' } });
    assert.strictEqual(r.statusCode, 200, JSON.stringify(r.body));
    assert.match(r.body.reply, /Subiectul I la BAC/);
    assert.strictEqual(modelCalls, 0, 'fără model');
    assert.strictEqual(fake.db.tables.ai_usage.length, 2, 'nu consumă acțiuni AI');
    const msgs = fake.db.tables.ai_messages;
    assert.deepStrictEqual(msgs.map((m) => m.role), ['user', 'assistant']);
    assert.strictEqual(msgs[1].metadata.ghid, 'exam');
    assert.ok(r.body.conversationId);

    // matematica: modelul (aici: scutit de cote în test) + trimiterile spre site
    ai.enforceRateLimit = async () => ({});
    ai.enforceFreeQuota = async () => {};
    ai.logUsage = async () => {};
    ai.prepareChat = async () => ({ convId: r.body.conversationId, primaryMaterial: null, priorMsgs: [], system: 's', sources: [], baremItem: null, regenerated: false, attachments: [], tools: null });
    const m = await call({ message: 'rezolvă ecuația x^2=4 de la bac', context: { page: '/' } });
    assert.strictEqual(m.statusCode, 200, JSON.stringify(m.body));
    assert.strictEqual(modelCalls, 1);
    assert.match(m.body.reply, /^Pentru \$x\^2=4\$/);
    assert.match(m.body.reply, /📚 Exersează și pe site: \[Teste interactive BAC\]\(\/bacalaureat\)/);
  } finally { Object.assign(ai, saved); }
});

test('api/ai-chat-stream: ghidul vine pe flux (meta → bucăți → done), fără model', async () => {
  const { createFakeSupabase, fakeRes } = require('./tools/fakeSupabase');
  const ai = require('../api/_lib/ai');
  const handler = require('../api/ai-chat-stream');
  const U = '88888888-8888-4888-8888-888888888888';
  const fake = createFakeSupabase({ profiles: [{ id: U, subscription_status: 'active', role: 'elev', is_admin: false }], ai_conversations: [], ai_messages: [] });
  const saved = { admin: ai.admin, authUser: ai.authUser, chatStream: ai.chatStream, enforceRateLimit: ai.enforceRateLimit };
  let modelCalls = 0;
  ai.admin = () => fake;
  ai.authUser = async () => U;
  ai.chatStream = async function* () { modelCalls++; yield 'x'; };
  ai.enforceRateLimit = async () => { throw new Error('ghidul nu trece prin limitele AI'); };
  try {
    const res = fakeRes();
    const lines = [];
    res.write = (s) => { lines.push(...String(s).split('\n').filter(Boolean).map((l) => JSON.parse(l))); return true; };
    await handler({ method: 'POST', headers: {}, query: {}, body: { message: 'vreau meditații', context: { page: '/' } } }, res);
    assert.deepStrictEqual([lines[0].type, lines[lines.length - 1].type], ['meta', 'done']);
    const text = lines.filter((l) => l.type === 'delta').map((l) => l.text).join('');
    assert.match(text, /Meditațiile de pe ExamenMate/);
    assert.match(text, /\(\/meditatii\/pregatire\)/);
    assert.strictEqual(modelCalls, 0);
    assert.strictEqual(fake.db.tables.ai_messages.length, 2);
  } finally { Object.assign(ai, saved); }
});
