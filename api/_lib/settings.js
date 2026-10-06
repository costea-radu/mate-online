// =====================================================================
// api/_lib/settings.js — setările site-ului alese din Admin, într-o tabelă
// cheie → valoare (public.app_settings, supabase/setari_ordine_gratuite.sql):
//   • 'content_new_position' — unde apar materialele noi (primele / la sfârșit),
//     pe tot site-ul, pe categorie sau pe rubrică (citită și de triggerul SQL);
//   • 'live_free_lessons'    — meditațiile live gratuite (lecțiile alese).
// Doar serverul citește și scrie (service role). Dacă scriptul SQL nu a fost
// rulat încă, citirea întoarce { setup: false } (nimic nu se strică), iar
// scrierea dă un mesaj clar despre ce trebuie rulat.
// =====================================================================
const TABLE = 'app_settings';
const SETUP_HINT = 'Setarea nu se poate salva încă: rulează o dată supabase/setari_ordine_gratuite.sql în Supabase → SQL Editor.';

const isMissingTable = (err) => !!err && /relation .* does not exist|does not exist|schema cache|could not find the table/i.test(String(err.message || err));

function fail(status, message, code = null) {
  const e = new Error(message);
  e.status = status;
  if (code) e.code = code;
  return e;
}

// { setup: true, value, updatedAt } | { setup: false, value: null }
async function readSetting(supa, key) {
  const { data, error } = await supa.from(TABLE).select('value, updated_at').eq('key', key).maybeSingle();
  if (error) {
    if (isMissingTable(error)) return { setup: false, value: null, updatedAt: null };
    throw fail(500, `Setările: ${error.message}`);
  }
  return { setup: true, value: data ? data.value : null, updatedAt: data ? data.updated_at : null };
}

async function writeSetting(supa, key, value, userId = null) {
  const row = { key, value, updated_at: new Date().toISOString(), updated_by: userId || null };
  const { error } = await supa.from(TABLE).upsert(row, { onConflict: 'key' });
  if (error) {
    if (isMissingTable(error)) throw fail(503, SETUP_HINT, 'SETTINGS_SETUP');
    throw fail(500, `Salvarea setării a eșuat: ${error.message}`);
  }
  return value;
}

// Scrie valoarea DOAR dacă cheia nu există încă (ex. alegerea automată a
// meditațiilor gratuite, ca să rămână stabilă). Întoarce true dacă a scris.
async function insertSettingIfMissing(supa, key, value) {
  const { error } = await supa.from(TABLE)
    .upsert({ key, value, updated_at: new Date().toISOString() }, { onConflict: 'key', ignoreDuplicates: true });
  return !error;
}

module.exports = { TABLE, SETUP_HINT, isMissingTable, readSetting, writeSetting, insertSettingIfMissing };
