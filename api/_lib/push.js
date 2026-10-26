// =====================================================================
// api/_lib/push.js — NOTIFICĂRILE WEB PUSH („✅ Prof. Tudor e gata — intră")
//
// Elevul care așteaptă pregătirea unei lecții live apasă „🔔 Anunță-mă când e
// gata": browserul îi dă o abonare (endpoint + chei), pe care o ținem în
// public.push_subscriptions (supabase/notificari_lectii.sql). Când lecția devine
// jucabilă, serverul trimite notificarea — ajunge și cu pagina închisă (Chrome,
// Edge, Firefox, Android, aplicația ExamenMate; pe iPhone doar aplicația pusă pe
// ecranul principal, iOS 16.4+). Service worker-ul o afișează (public/sw-push.js).
//
// Cheile VAPID: VAPID_PUBLIC_KEY + VAPID_PRIVATE_KEY din Vercel, dacă există;
// altfel le generează serverul o singură dată și le ține în app_settings
// ('web_push_vapid' — tabela pe care o citește doar serverul). Fără tabela de
// abonări (SQL-ul nerulat) totul merge ca înainte: sunetul și notificarea din
// pagină rămân, doar notificarea cu pagina închisă lipsește.
// =====================================================================
const SET = require('./settings');

const TABLE = 'push_subscriptions';
const VAPID_KEY = 'web_push_vapid';
const MAX_SUBS_PER_USER = 6;

let _webpush = null;
const webpush = () => (_webpush || (_webpush = require('web-push')));

const isMissing = (err) => !!err && /relation .* does not exist|does not exist|schema cache|could not find the table|column .* does not exist/i.test(String(err.message || err));

// subiectul VAPID: o adresă de contact a site-ului (cerință a serviciilor de push)
const subject = () => (process.env.VAPID_SUBJECT || '').trim()
  || `${String(process.env.SITE_URL || process.env.PUBLIC_SITE_URL || 'https://examenmate.com').replace(/\/+$/, '')}`;

// ─── cheile ───────────────────────────────────────────────────────────────────
let keyCache = null;   // { at, keys: { publicKey, privateKey } | null }
async function vapidKeys(supa, { create = true } = {}) {
  const envPub = (process.env.VAPID_PUBLIC_KEY || '').trim();
  const envPriv = (process.env.VAPID_PRIVATE_KEY || '').trim();
  if (envPub && envPriv) return { publicKey: envPub, privateKey: envPriv, from: 'env' };
  if (keyCache && Date.now() - keyCache.at < 10 * 60 * 1000 && (keyCache.keys || !create)) return keyCache.keys;
  let keys = null;
  try {
    const cur = await SET.readSetting(supa, VAPID_KEY);
    if (cur.setup && cur.value?.publicKey && cur.value?.privateKey) keys = { publicKey: cur.value.publicKey, privateKey: cur.value.privateKey, from: 'db' };
    else if (cur.setup && create) {
      const k = webpush().generateVAPIDKeys();
      // doar prima scriere câștigă (două instanțe care generează deodată → aceeași pereche pentru toți)
      await SET.insertSettingIfMissing(supa, VAPID_KEY, { publicKey: k.publicKey, privateKey: k.privateKey, at: new Date().toISOString() });
      const again = await SET.readSetting(supa, VAPID_KEY);
      if (again.value?.publicKey && again.value?.privateKey) keys = { publicKey: again.value.publicKey, privateKey: again.value.privateKey, from: 'db' };
    }
  } catch { keys = null; }
  keyCache = { at: Date.now(), keys };
  return keys;
}

// ─── e pornit? (tabela există + avem chei) ────────────────────────────────────
let infoCache = null;
async function pushInfo(supa) {
  if (infoCache && Date.now() - infoCache.at < 10 * 60 * 1000) return infoCache.info;
  let info = { on: false, key: null, why: null };
  try {
    const { error } = await supa.from(TABLE).select('endpoint', { head: true, count: 'exact' }).limit(1);
    if (error) info.why = isMissing(error) ? 'sql' : error.message;
    else {
      const k = await vapidKeys(supa);
      info = k ? { on: true, key: k.publicKey, why: null } : { on: false, key: null, why: 'chei' };
    }
  } catch (e) { info.why = String(e.message || e); }
  infoCache = { at: Date.now(), info };
  return info;
}
const resetCache = () => { infoCache = null; keyCache = null; };

// ─── abonarea venită din browser (PushSubscription.toJSON()) ──────────────────
function cleanSubscription(raw) {
  const s = raw && typeof raw === 'object' ? raw : null;
  const endpoint = String(s?.endpoint || '').trim();
  const p256dh = String(s?.keys?.p256dh || '').trim();
  const auth = String(s?.keys?.auth || '').trim();
  if (!/^https:\/\/[^\s]{10,800}$/.test(endpoint)) return null;
  if (!/^[A-Za-z0-9_\-=+/]{40,200}$/.test(p256dh) || !/^[A-Za-z0-9_\-=+/]{10,64}$/.test(auth)) return null;
  return { endpoint, p256dh, auth };
}

async function saveSubscription(supa, userId, raw, userAgent = '') {
  const sub = cleanSubscription(raw);
  if (!sub || !userId) return false;
  const row = { ...sub, user_id: userId, user_agent: String(userAgent || '').slice(0, 200) || null, created_at: new Date().toISOString(), fails: 0 };
  const { error } = await supa.from(TABLE).upsert(row, { onConflict: 'endpoint' });
  if (error) return false;
  // cel mult câteva abonări pe elev (telefon, laptop, aplicație): cele vechi pleacă
  const { data } = await supa.from(TABLE).select('endpoint, created_at').eq('user_id', userId).order('created_at', { ascending: false });
  const extra = (data || []).slice(MAX_SUBS_PER_USER).map((r) => r.endpoint);
  if (extra.length) await supa.from(TABLE).delete().in('endpoint', extra);
  return true;
}

async function removeSubscription(supa, userId, endpoint) {
  if (!endpoint) return;
  await supa.from(TABLE).delete().eq('user_id', userId).eq('endpoint', String(endpoint));
}

// ─── trimiterea ───────────────────────────────────────────────────────────────
// payload: { title, body, url, tag, kind } — service worker-ul îl afișează (sw-push.js)
// → { sent, failed, gone } (gone = abonări expirate, șterse)
async function sendToUser(supa, userId, payload, { ttl = 900, urgency = 'high' } = {}) {
  const out = { sent: 0, failed: 0, gone: 0 };
  if (!userId) return out;
  const keys = await vapidKeys(supa, { create: false });
  if (!keys) return out;
  const { data: subs, error } = await supa.from(TABLE).select('endpoint, p256dh, auth, fails').eq('user_id', userId).order('created_at', { ascending: false }).limit(MAX_SUBS_PER_USER);
  if (error || !subs?.length) return out;
  const body = JSON.stringify(payload || {});
  const opts = { TTL: ttl, urgency, vapidDetails: { subject: subject(), publicKey: keys.publicKey, privateKey: keys.privateKey }, timeout: 8000 };
  await Promise.all(subs.map(async (s) => {
    try {
      await webpush().sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, body, opts);
      out.sent++;
      supa.from(TABLE).update({ last_ok_at: new Date().toISOString(), fails: 0 }).eq('endpoint', s.endpoint).then(() => {}, () => {});
    } catch (e) {
      const code = Number(e?.statusCode || 0);
      if (code === 404 || code === 410) {             // abonarea nu mai există (browser dezinstalat, permisiune retrasă)
        out.gone++;
        await supa.from(TABLE).delete().eq('endpoint', s.endpoint);
      } else {
        out.failed++;
        const fails = (Number(s.fails) || 0) + 1;
        if (fails >= 8) await supa.from(TABLE).delete().eq('endpoint', s.endpoint);
        else await supa.from(TABLE).update({ fails }).eq('endpoint', s.endpoint);
      }
    }
  }));
  return out;
}

module.exports = { TABLE, VAPID_KEY, vapidKeys, pushInfo, resetCache, cleanSubscription, saveSubscription, removeSubscription, sendToUser, isMissing, subject };
