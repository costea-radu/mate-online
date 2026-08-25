// Teste pentru BUGETUL buclei de unelte (api/_lib/claude.js → chatClaudeTools).
//
// Regresia reparată: agentul SEO rula cu max_tokens = 3000, dar argumentul
// uneltei `publish_article` e articolul COMPLET (600–1500 de cuvinte). Runda se
// tăia cu stop_reason = 'max_tokens' fix în mijlocul blocului tool_use, bucla
// ieșea tăcut (verifica doar `stop !== 'tool_use'`), propunerea nu se mai crea
// și adminul rămânea cu preambulul „Scriu articolul complet." și coada goală.
//
// Apelurile către API sunt simulate prin global.fetch — fără rețea.
process.env.ANTHROPIC_API_KEY = 'test-key';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const claude = require('../api/_lib/claude');

// Un răspuns Anthropic minimal, în forma pe care o citește apiCallOnce.
function reply({ stop, text = '', tool = null }) {
  const content = [];
  if (text) content.push({ type: 'text', text });
  if (tool) content.push({ type: 'tool_use', id: 'tu_1', name: tool.name, input: tool.input });
  return {
    ok: true,
    status: 200,
    json: async () => ({ content, stop_reason: stop, usage: { input_tokens: 100, output_tokens: 200 } }),
  };
}

const TOOLS = [{ name: 'publish_article', description: 'x', input_schema: { type: 'object' } }];
const MSG = [{ role: 'user', content: 'Scrie articolul despre suma lui Gauss.' }];

test('runda tăiată de buget se reia cu buget dublat — apelul uneltei nu se mai pierde', async () => {
  const budgets = [];
  const executed = [];
  global.fetch = async (url, opts) => {
    budgets.push(JSON.parse(opts.body).max_tokens);
    // 1) tăiat exact în apelul uneltei (textul de preambul EXISTĂ — de-asta
    //    reîncercarea din apiCall, condiționată de text gol, nu se declanșa)
    if (budgets.length === 1) return reply({ stop: 'max_tokens', text: 'Am tot ce-mi trebuie. Scriu articolul complet.' });
    // 2) cu buget dublat, apelul uneltei încape
    if (budgets.length === 2) return reply({ stop: 'tool_use', text: 'Trimit articolul.', tool: { name: 'publish_article', input: { slug: 'suma-lui-gauss' } } });
    return reply({ stop: 'end_turn', text: 'Gata — propunerea e în coada de aprobare.' });
  };

  const r = await claude.chatClaudeTools({
    system: 'test', messages: MSG, tools: TOOLS, maxTokens: 4000, maxIters: 4,
    executeTool: async (name, input) => { executed.push([name, input.slug]); return 'Propunerea 7 a fost trimisă în coada de aprobare.'; },
  });

  assert.deepStrictEqual(executed, [['publish_article', 'suma-lui-gauss']], 'unealta trebuia executată după reluare');
  assert.strictEqual(budgets[0], 4000);
  assert.strictEqual(budgets[1], 8000, 'runda tăiată trebuia reluată cu buget dublat');
  assert.strictEqual(r.toolCalls, 1);
  assert.strictEqual(r.stopReason, 'end_turn');
  assert.ok(!r.text.includes('⚠️'), 'nu avertizăm când unealta a plecat până la urmă');
});

test('tăiat și după reluări: răspunsul spune EXPLICIT că acțiunea nu a plecat', async () => {
  const budgets = [];
  global.fetch = async (url, opts) => {
    budgets.push(JSON.parse(opts.body).max_tokens);
    return reply({ stop: 'max_tokens', text: 'Scriu articolul complet.' });
  };

  const r = await claude.chatClaudeTools({
    system: 'test', messages: MSG, tools: TOOLS, maxTokens: 4000, maxIters: 3,
    executeTool: async () => { throw new Error('nu trebuia executată nicio unealtă'); },
  });

  assert.deepStrictEqual(budgets, [4000, 8000, 16000], 'două reluări cu buget dublat, apoi renunțare');
  assert.strictEqual(r.stopReason, 'max_tokens', 'UI-ul se bazează pe stopReason ca să avertizeze');
  assert.strictEqual(r.toolCalls, 0);
  assert.ok(/nu a mai apucat să plece/.test(r.text), `lipsește avertismentul de trunchiere: ${r.text}`);
  assert.ok(r.text.startsWith('Scriu articolul complet.'), 'textul modelului se păstrează');
});

test('bucla normală (fără trunchiere) nu cere runde suplimentare', async () => {
  const budgets = [];
  global.fetch = async (url, opts) => {
    budgets.push(JSON.parse(opts.body).max_tokens);
    if (budgets.length === 1) return reply({ stop: 'tool_use', tool: { name: 'publish_article', input: { slug: 'ok' } } });
    return reply({ stop: 'end_turn', text: 'Raport final.' });
  };
  const r = await claude.chatClaudeTools({
    system: 'test', messages: MSG, tools: TOOLS, maxTokens: 16000, maxIters: 4,
    executeTool: async () => 'ok',
  });
  assert.deepStrictEqual(budgets, [16000, 16000], 'niciun apel în plus când nimic nu e tăiat');
  assert.strictEqual(r.text, 'Raport final.');
});

test('agentul SEO rulează cu buget destul cât să încapă un articol întreg', () => {
  // Garda pentru regresie: cu 3000 de tokeni, publish_article NU încape (numai
  // content_md are minim 800 de caractere și țintește 600–1500 de cuvinte).
  const src = fs.readFileSync(path.join(__dirname, '..', 'api', '_lib', 'seo.js'), 'utf8');
  const m = src.match(/chatClaudeTools\(\{[^}]*maxTokens:\s*(\d+)/);
  assert.ok(m, 'nu am găsit apelul chatClaudeTools din runAgent');
  assert.ok(Number(m[1]) >= 8000, `bugetul buclei de unelte e prea mic (${m[1]}) — articolul nu încape în apelul uneltei`);
});
