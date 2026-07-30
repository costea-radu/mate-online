// =====================================================================
// api/seo-actions.js — COADA DE APROBARE a agentului SEO (admin-only).
// (Faza 1e din GHID_AGENT_SEO_ACTIUNI.md)
//
// POST { action }
//   action='list'            → { actions[] }  (ultimele 100, toate statusurile)
//   action='update', id, patch → EDITEAZĂ o propunere „proposed" (textele
//                              postărilor/articolelor/metadatelor YouTube),
//                              cu aceleași validări ca la creare
//   action='approve', id     → aprobă + EXECUTĂ acțiunea; scrie result
//   action='reject',  id     → respinge (nu se execută nimic)
//   action='revert',  id     → anulează o acțiune EXECUTATĂ (meta/redenumire),
//                              folosind valorile vechi din payload
//
// Fluxul: agentul propune (status 'proposed') → adminul decide aici.
// Execuția reală e în api/_lib/seo.js → executeAction / revertAction.
// =====================================================================
const ai = require('./_lib/ai');
const seo = require('./_lib/seo');

module.exports = async function handler(req, res) {
  ai.applyCors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  const supa = ai.admin();
  try {
    const userId = await ai.authUser(req, supa);
    await ai.requireAdmin(supa, userId);

    const { action = 'list', id = null, patch = null } = req.body || {};

    if (action === 'list') {
      const { data, error } = await supa
        .from('seo_actions')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(100);
      if (error) {
        // tabelul lipsește → mesaj clar în loc de 500 criptic
        return res.status(200).json({ actions: [], warning: `Tabelul seo_actions lipsește — rulează supabase/seo_agent.sql în Supabase (${error.message})` });
      }
      return res.status(200).json({ actions: data || [] });
    }

    if (!id) return res.status(400).json({ error: 'Lipsește id-ul acțiunii.' });
    const { data: row, error: readErr } = await supa.from('seo_actions').select('*').eq('id', id).maybeSingle();
    if (readErr) return res.status(500).json({ error: readErr.message });
    if (!row) return res.status(404).json({ error: 'Acțiunea nu există.' });

    if (action === 'update') {
      if (row.status !== 'proposed') return res.status(409).json({ error: `Acțiunea are deja statusul „${row.status}" — doar propunerile în așteptare se editează.` });
      try {
        const payload = seo.editActionPayload(row, patch && typeof patch === 'object' ? patch : {});
        // marcajul [editat de admin] apare o singură dată, oricâte editări ar fi
        const baseNote = String(row.note || '').replace(/\s*\[editat de admin\]\s*$/, '').slice(0, 900);
        const { data: upd, error } = await supa.from('seo_actions')
          .update({ payload, note: (baseNote ? baseNote + ' ' : '') + '[editat de admin]' })
          .eq('id', id).select('*').single();
        if (error) return res.status(500).json({ error: error.message });
        return res.status(200).json({ action: upd });
      } catch (editErr) {
        return res.status(400).json({ error: editErr.message });
      }
    }

    if (action === 'reject') {
      if (row.status !== 'proposed') return res.status(409).json({ error: `Acțiunea are deja statusul „${row.status}".` });
      const { data: upd, error } = await supa.from('seo_actions')
        .update({ status: 'rejected', decided_at: new Date().toISOString() })
        .eq('id', id).select('*').single();
      if (error) return res.status(500).json({ error: error.message });
      return res.status(200).json({ action: upd });
    }

    if (action === 'approve') {
      // 'failed' se poate REEXECUTA: execuția eșuată nu a produs efecte
      // (ex. „Bucket not found" la primul create_video — admin rulează
      // supabase/agent_media.sql și apasă „Reîncearcă execuția").
      if (row.status !== 'proposed' && row.status !== 'failed') {
        return res.status(409).json({ error: `Acțiunea are deja statusul „${row.status}".` });
      }
      const decidedAt = new Date().toISOString();
      try {
        const result = await seo.executeAction(supa, row);
        const { data: upd, error } = await supa.from('seo_actions')
          .update({ status: 'executed', decided_at: decidedAt, executed_at: new Date().toISOString(), result })
          .eq('id', id).select('*').single();
        if (error) return res.status(500).json({ error: error.message });
        return res.status(200).json({ action: upd });
      } catch (execErr) {
        await supa.from('seo_actions')
          .update({ status: 'failed', decided_at: decidedAt, result: { error: execErr.message } })
          .eq('id', id);
        return res.status(502).json({ error: `Execuția a eșuat: ${execErr.message}` });
      }
    }

    if (action === 'revert') {
      if (row.status !== 'executed') return res.status(409).json({ error: 'Doar acțiunile executate se pot anula.' });
      try {
        const result = await seo.revertAction(supa, row);
        const { data: upd, error } = await supa.from('seo_actions')
          .update({ status: 'reverted', result: { ...(row.result || {}), revert: result, reverted_at: new Date().toISOString() } })
          .eq('id', id).select('*').single();
        if (error) return res.status(500).json({ error: error.message });
        return res.status(200).json({ action: upd });
      } catch (revErr) {
        return res.status(502).json({ error: `Anularea a eșuat: ${revErr.message}` });
      }
    }

    return res.status(400).json({ error: `Acțiune necunoscută: ${action}` });
  } catch (err) {
    console.error('seo-actions error:', err);
    return res.status(err.status || 500).json({ error: err.message || 'Eroare server' });
  }
};
