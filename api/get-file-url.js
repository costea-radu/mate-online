// api/get-file-url.js — signed URL pentru materiale premium din bibliotecă
//
// { contentId, grant?, variante? } → { url } — și, cu `variante: true` (vizualizatorul
// PDF), la testele de EN care au varianta „fără suprafață neagră" (alb peste
// dreptunghiul de pe pagina 2 — api/_lib/pagina2Run.js): { url, alb } — linkul
// semnat al copiei albe, cu aceleași reguli de acces ca originalul.
const { admin, handledMethod, authUser, signedUrlFromPublic } = require('./_lib/http');
const { albSignedUrl } = require('./_lib/pagina2Alb');

// linkul variantei albe (dacă există) — o eroare aici nu oprește deschiderea originalului
async function withAlb(supabase, content, url, want) {
  if (!want) return { url };
  let alb = null;
  try { alb = await albSignedUrl(supabase, content, 300); } catch { alb = null; }
  return alb ? { url, alb } : { url };
}

module.exports = async function handler(req, res) {
  if (handledMethod(req, res)) return;
  const supabase = admin();
  try {
    const { contentId } = req.body || {};
    if (!contentId) return res.status(400).json({ error: 'contentId obligatoriu' });

    const { data: content, error: contentError } = await supabase
      .from('content').select('id, file_url, is_free, content_type, category, subcategory').eq('id', contentId).single();
    if (contentError || !content) return res.status(404).json({ error: 'Material negăsit' });

    // Fișierele gratuite — semnate și ele (fără autentificare). Semnarea merge
    // și pe bucket public, și pe privat, deci bucket-ul `content-files` poate fi
    // ținut PRIVAT (altfel premium-ul e descărcabil direct de la file_url-ul
    // public, care e world-readable din tabela content).
    const variante = (req.body || {}).variante === true;
    if (content.is_free) {
      const url = await signedUrlFromPublic(supabase, content.file_url, 300);
      return res.status(200).json(await withAlb(supabase, content, url, variante));
    }

    // Premium — verifică abonamentul utilizatorului REAL (din token).
    const userId = await authUser(req, supabase);
    const { data: profile, error: profileError } = await supabase
      .from('profiles').select('subscription_status, is_admin').eq('id', userId).single();
    const subscribed = !profileError && (profile?.subscription_status === 'active' || profile?.is_admin);

    // „Grant" — temă pe grupă trimisă de ADMIN cu opțiunea „testele premium
    // gratuit": tokenul e semnat pe server (api/group-assignment.js) și deschide
    // EXACT acest material, EXACT acestui elev, pentru 12 ore.
    let granted = false;
    const { grant } = req.body || {};
    if (!subscribed && grant) {
      const g = require('./_lib/ai').verifyToken(grant);
      granted = !!(g && g.t === 'gt' && g.c === contentId && g.u === userId);
    }
    if (!subscribed && !granted) {
      return res.status(403).json({ error: 'Acces interzis. Necesită abonament Premium.' });
    }

    const url = await signedUrlFromPublic(supabase, content.file_url, 300); // 5 min
    return res.status(200).json(await withAlb(supabase, content, url, variante));
  } catch (err) {
    console.error('get-file-url error:', err);
    return res.status(err.status || 500).json({ error: err.message || 'Eroare server' });
  }
};
