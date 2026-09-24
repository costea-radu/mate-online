// =====================================================================
// test/tools/fakeSupabase.js — un Supabase „de buzunar", în memorie, pentru
// testele de integrare ale api/live.js: aceleași apeluri ca supabase-js
// (from().select().eq()…maybeSingle(), insert/update/upsert/delete, count,
// filtre pe câmpuri JSON „state->>startedAt", or(...), storage), fără rețea.
// Nu e un Postgres: acoperă doar ce folosesc handlerele testate.
// =====================================================================
const crypto = require('node:crypto');

const DEFAULTS = {
  live_sessions: () => ({ kind: 'grup', status: 'programata', state: {}, created_at: new Date().toISOString(), updated_at: new Date().toISOString() }),
  live_lessons: () => ({ version: 1, status: 'nou', progress: {}, cost_micro: 0, created_at: new Date().toISOString(), updated_at: new Date().toISOString() }),
  live_participants: () => ({ joined_at: new Date().toISOString(), last_seen: new Date().toISOString(), seconds: 0 }),
  live_messages: () => ({ role: 'elev', to_teacher: false, hidden: false, created_at: new Date().toISOString() }),
  live_poll_answers: () => ({ created_at: new Date().toISOString() }),
  live_tickets: () => ({ status: 'platit', created_at: new Date().toISOString() }),
};
const SERIAL = new Set(['live_messages']);
const NO_ID = new Set(['live_participants', 'live_poll_answers']);

// valoarea unei coloane sau a unei căi JSON („state->>startedAt", „barem->title")
function getPath(row, path) {
  const m = String(path).split(/->>|->/);
  let v = row[m[0].trim()];
  for (let i = 1; i < m.length; i++) {
    if (v == null) return null;
    if (typeof v === 'string') { try { v = JSON.parse(v); } catch { return null; } }
    v = v[m[i].trim()];
  }
  if (String(path).includes('->>') && v != null && typeof v !== 'string') v = typeof v === 'object' ? JSON.stringify(v) : String(v);
  return v === undefined ? null : v;
}
const cmp = (a, b) => {
  if (a == null && b == null) return 0;
  if (a == null) return -1;
  if (b == null) return 1;
  const na = Number(a), nb = Number(b);
  if (typeof a !== 'boolean' && a !== '' && b !== '' && !Number.isNaN(na) && !Number.isNaN(nb) && !/^\d{4}-\d\d-\d\d/.test(String(a))) return na - nb;
  return String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0;
};
const parseVal = (s) => (s === 'null' ? null : s === 'true' ? true : s === 'false' ? false : s);

function test(row, f) {
  const v = getPath(row, f.col);
  switch (f.op) {
    case 'eq': return v === f.val || (v != null && f.val != null && String(v) === String(f.val));
    case 'neq': return v == null || String(v) !== String(f.val);
    case 'in': return f.val.some((x) => String(x) === String(v));
    case 'is': return f.val === null ? v == null : v === f.val;
    case 'gt': return v != null && cmp(v, f.val) > 0;
    case 'gte': return v != null && cmp(v, f.val) >= 0;
    case 'lt': return v != null && cmp(v, f.val) < 0;
    case 'lte': return v != null && cmp(v, f.val) <= 0;
    case 'not': return !test(row, { col: f.col, op: f.inner, val: f.val });
    case 'or': return f.alts.some((a) => test(row, a));
    default: throw new Error(`fakeSupabase: filtru necunoscut ${f.op}`);
  }
}

function project(row, cols) {
  if (!cols || cols.trim() === '*') return { ...row };
  const out = {};
  for (const part of cols.split(',').map((s) => s.trim()).filter(Boolean)) {
    if (part === '*') { Object.assign(out, row); continue; }
    const [alias, expr] = part.includes(':') ? part.split(':').map((s) => s.trim()) : [part.split(/->>|->/).pop().trim(), part];
    out[alias] = getPath(row, expr);
  }
  return out;
}

class Query {
  constructor(db, table) {
    this.db = db; this.table = table;
    this.op = 'select'; this.cols = '*'; this.filters = []; this.orders = []; this.lim = null;
    this.single = null; this.countMode = null; this.head = false; this.payload = null; this.opts = {}; this.returning = false;
  }
  select(cols = '*', opts = {}) {
    if (this.op === 'select') { this.cols = cols; this.countMode = opts.count || null; this.head = !!opts.head; }
    else { this.returning = true; this.cols = cols; }
    return this;
  }
  insert(rows) { this.op = 'insert'; this.payload = rows; return this; }
  update(patch) { this.op = 'update'; this.payload = patch; return this; }
  upsert(rows, opts = {}) { this.op = 'upsert'; this.payload = rows; this.opts = opts; return this; }
  delete() { this.op = 'delete'; return this; }
  eq(col, val) { this.filters.push({ col, op: 'eq', val }); return this; }
  neq(col, val) { this.filters.push({ col, op: 'neq', val }); return this; }
  in(col, val) { this.filters.push({ col, op: 'in', val: [...val] }); return this; }
  is(col, val) { this.filters.push({ col, op: 'is', val }); return this; }
  gt(col, val) { this.filters.push({ col, op: 'gt', val }); return this; }
  gte(col, val) { this.filters.push({ col, op: 'gte', val }); return this; }
  lt(col, val) { this.filters.push({ col, op: 'lt', val }); return this; }
  lte(col, val) { this.filters.push({ col, op: 'lte', val }); return this; }
  not(col, op, val) { this.filters.push({ col, op: 'not', inner: op, val }); return this; }
  or(expr) {
    const alts = String(expr).split(',').map((p) => {
      const [col, op, ...rest] = p.split('.');
      return { col, op, val: parseVal(rest.join('.')) };
    });
    this.filters.push({ op: 'or', alts }); return this;
  }
  order(col, { ascending = true } = {}) { this.orders.push({ col, asc: ascending }); return this; }
  limit(n) { this.lim = n; return this; }
  maybeSingle() { this.single = 'maybe'; return this; }
  single() { this.single = 'one'; return this; }
  then(res, rej) { return Promise.resolve().then(() => this._run()).then(res, rej); }

  _rows() { return this.db.tables[this.table] || (this.db.tables[this.table] = []); }
  _match() { return this._rows().filter((r) => this.filters.every((f) => test(r, f))); }
  _newRow(r) {
    const row = { ...(DEFAULTS[this.table] ? DEFAULTS[this.table]() : {}), ...r };
    if (row.id == null && !NO_ID.has(this.table)) row.id = SERIAL.has(this.table) ? ++this.db.serial : crypto.randomUUID();
    return row;
  }
  _out(rows) {
    let out = rows.map((r) => project(r, this.cols));
    if (this.single === 'maybe') {
      if (out.length > 1) return { data: null, error: { message: 'JSON object requested, multiple (or no) rows returned' } };
      return { data: out[0] || null, error: null };
    }
    if (this.single === 'one') {
      if (out.length !== 1) return { data: null, error: { message: 'JSON object requested, multiple (or no) rows returned' } };
      return { data: out[0], error: null };
    }
    return { data: out, error: null };
  }
  _run() {
    if (this.db.failTables.has(this.table)) return { data: null, error: { message: `relation "public.${this.table}" does not exist` } };
    this.db.log.push({ table: this.table, op: this.op });
    const now = new Date().toISOString();
    if (this.op === 'select') {
      let rows = this._match();
      for (const o of [...this.orders].reverse()) rows = [...rows].sort((a, b) => (o.asc ? 1 : -1) * cmp(getPath(a, o.col), getPath(b, o.col)));
      const count = rows.length;
      if (this.lim != null) rows = rows.slice(0, this.lim);
      if (this.head) return { data: null, error: null, count };
      const r = this._out(rows);
      if (this.countMode) r.count = count;
      return r;
    }
    if (this.op === 'insert') {
      const list = (Array.isArray(this.payload) ? this.payload : [this.payload]).map((r) => this._newRow(r));
      this._rows().push(...list);
      return this.returning ? this._out(list) : { data: null, error: null };
    }
    if (this.op === 'update') {
      const rows = this._match();
      for (const r of rows) Object.assign(r, this.payload, this.table.startsWith('live_') && 'updated_at' in r ? { updated_at: now } : {});
      return this.returning ? this._out(rows) : { data: null, error: null };
    }
    if (this.op === 'upsert') {
      const keys = String(this.opts.onConflict || 'id').split(',').map((s) => s.trim());
      const list = Array.isArray(this.payload) ? this.payload : [this.payload];
      const out = [];
      for (const r of list) {
        const ex = this._rows().find((x) => keys.every((k) => String(x[k]) === String(r[k])));
        if (ex) { if (!this.opts.ignoreDuplicates) { Object.assign(ex, r); out.push(ex); } }
        else { const n = this._newRow(r); this._rows().push(n); out.push(n); }
      }
      return this.returning ? this._out(out) : { data: null, error: null };
    }
    if (this.op === 'delete') {
      const rows = this._match();
      this.db.tables[this.table] = this._rows().filter((r) => !rows.includes(r));
      return this.returning ? this._out(rows) : { data: null, error: null };
    }
    throw new Error('fakeSupabase: operație necunoscută');
  }
}

function createFakeSupabase(seed = {}) {
  const db = { tables: JSON.parse(JSON.stringify(seed)), serial: 0, log: [], failTables: new Set(), uploads: [] };
  return {
    db,
    from: (table) => new Query(db, table),
    storage: {
      from: (bucket) => ({
        upload: async (path, body) => { db.uploads.push({ bucket, path, size: body?.length || 0 }); return { data: { path }, error: null }; },
        getPublicUrl: (path) => ({ data: { publicUrl: `https://fake.supabase/storage/v1/object/public/${bucket}/${path}` } }),
      }),
    },
  };
}

// răspunsul HTTP „de buzunar" pentru handlerele Vercel (req, res)
function fakeRes() {
  const r = { statusCode: 200, headers: {}, body: undefined };
  r.status = (c) => { r.statusCode = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  r.end = () => r;
  r.setHeader = (k, v) => { r.headers[k.toLowerCase()] = v; };
  r.getHeader = (k) => r.headers[k.toLowerCase()];
  return r;
}

module.exports = { createFakeSupabase, fakeRes, getPath };
