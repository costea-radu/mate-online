// =====================================================================
// api/_lib/catalog.js — catalogul de teste/exerciții care se pot trimite
// elevilor și „rezolvarea" unui element ales către ce vede elevul, concret.
//
// Sursele sunt aceleași peste tot în platformă:
//   • 'site'     → tabela `content` („Examene" și „Clase"), fără bareme/manuale;
//   • 'personal' → testele generate chiar de profesor (`ai_personal_items`);
//   • 'public'   → Biblioteca utilizatorilor (`ai_public_library`).
//
// Folosit de:
//   • api/group-assignment.js — TEST pe grupă (un link, alt test per elev);
//   • api/homework.js         — TEMĂ pe grupă / pe elev (același set pentru toți).
// =====================================================================
const ai = require('./ai');

const SOURCES = ['personal', 'public', 'site'];
const FORMATS = ['interactive', 'pdf'];

// „Testele" din site: fără bareme (cheia de răspunsuri) și fără manuale.
function siteQuery(supa, { format, category }) {
  let q = supa.from('content')
    .select('id, title, category, subcategory, content_type, is_free, sort_order')
    .eq('content_type', format === 'pdf' ? 'pdf' : 'interactive')
    .neq('category', 'manuale')
    .order('sort_order', { ascending: true })
    .limit(400);
  if (category) q = q.eq('category', category);
  return q;
}
const notBarem = (r) => r.subcategory !== 'bareme' && !/barem/i.test(r.title || '');

// Lista testelor dintr-o singură sursă.
async function catalogList(supa, userId, { source, category, format }) {
  if (source === 'site') {
    const { data } = await siteQuery(supa, { format, category });
    return (data || []).filter(notBarem).map((r) => ({
      source: 'site', refId: r.id, kind: format, title: r.title,
      category: r.category, isFree: !!r.is_free, note: r.subcategory || null,
    }));
  }
  const kinds = format === 'pdf' ? ['pdf', 'exam'] : ['interactive'];
  if (source === 'personal') {
    // testele generate chiar de profesor (private)
    let qq = supa.from('ai_personal_items').select('id, kind, title, category, topic')
      .eq('user_id', userId).in('kind', kinds).order('created_at', { ascending: false }).limit(200);
    if (category) qq = qq.eq('category', category);
    const { data } = await qq;
    return (data || []).map((r) => ({
      source: 'personal', refId: r.id, kind: r.kind, title: r.title || 'Test generat',
      category: r.category, isFree: true, note: r.topic || null,
    }));
  }
  // Biblioteca utilizatorilor
  let qq = supa.from('ai_public_library').select('id, kind, title, category, creator_name, is_free')
    .in('kind', kinds).order('created_at', { ascending: false }).limit(200);
  if (category) qq = qq.eq('category', category);
  const { data } = await qq;
  return (data || []).map((r) => ({
    source: 'public', refId: r.id, kind: r.kind, title: r.title,
    category: r.category, isFree: !!r.is_free, note: r.creator_name || null,
  }));
}

// Elementele bifate manual — verificate ca profesorul chiar are drept pe ele.
// `fmt` = null → se acceptă și interactive, și PDF (butonul „dă temă" nu cere
// un singur format: profesorul poate amesteca exerciții interactive cu PDF-uri).
async function resolveChosen(supa, userId, items, fmt = null, max = 60) {
  const out = [];
  const bySource = { site: [], personal: [], public: [] };
  (items || []).slice(0, max).forEach((i) => {
    if (i && SOURCES.includes(i.source) && i.refId) bySource[i.source].push(i.refId);
  });

  if (bySource.site.length) {
    const { data } = await supa.from('content')
      .select('id, title, category, subcategory, content_type, is_free').in('id', bySource.site);
    (data || []).forEach((r) => out.push({
      source: 'site', refId: r.id, kind: r.content_type === 'pdf' ? 'pdf' : 'interactive',
      title: r.title, category: r.category, isFree: !!r.is_free,
    }));
  }
  if (bySource.personal.length) {
    const { data } = await supa.from('ai_personal_items')
      .select('id, kind, title, category, user_id').in('id', bySource.personal).eq('user_id', userId);
    (data || []).forEach((r) => out.push({
      source: 'personal', refId: r.id, kind: r.kind, title: r.title || 'Test generat',
      category: r.category, isFree: true,
    }));
  }
  if (bySource.public.length) {
    const { data } = await supa.from('ai_public_library')
      .select('id, kind, title, category, is_free').in('id', bySource.public);
    (data || []).forEach((r) => out.push({
      source: 'public', refId: r.id, kind: r.kind, title: r.title, category: r.category, isFree: !!r.is_free,
    }));
  }
  // păstrează ordinea bifelor
  const key = (s, r) => `${s}:${r}`;
  const order = new Map((items || []).map((i, idx) => [key(i.source, i.refId), idx]));
  out.sort((a, b) => (order.get(key(a.source, a.refId)) ?? 99) - (order.get(key(b.source, b.refId)) ?? 99));
  if (!fmt) return out;
  return out.filter((x) => (fmt === 'pdf' ? x.kind !== 'interactive' : x.kind === 'interactive'));
}

// Ce primește elevul, concret (test din site / generat / din bibliotecă).
// `item` are forma rândului din group_assignment_items / homework_items.
async function resolveTarget(supa, item, { userId, profile, premiumFree = false }) {
  const canPremium = premiumFree || profile.subscription_status === 'active' || profile.is_admin;

  if (item.source === 'site') {
    const { data: c } = await supa.from('content')
      .select('id, title, category, subcategory, content_type, is_free, file_url')
      .eq('id', item.ref_id).maybeSingle();
    if (!c) return { type: 'missing' };
    if (!c.is_free && !canPremium) return { type: 'locked', title: c.title };
    // „Grant": lasă viewerul să deschidă un material premium pentru acest elev
    // (temă trimisă de admin cu „premium gratis"), fără abonament.
    const grant = (!c.is_free && premiumFree)
      ? ai.signToken({ t: 'gt', c: c.id, u: userId }, 12 * 3600) : null;
    return {
      type: c.content_type === 'pdf' ? 'site-pdf' : 'site-interactive',
      contentId: c.id, grant,
      item: { id: c.id, title: c.title, category: c.category, subcategory: c.subcategory || null, content_type: c.content_type, is_free: c.is_free, file_url: c.file_url },
    };
  }

  const table = item.source === 'personal' ? 'ai_personal_items' : 'ai_public_library';
  const { data: r } = await supa.from(table).select('*').eq('id', item.ref_id).maybeSingle();
  if (!r) return { type: 'missing' };
  const isFree = item.source === 'personal' ? true : !!r.is_free;
  if (!isFree && !canPremium) return { type: 'locked', title: r.title };

  if (r.kind === 'interactive') {
    return {
      type: 'quiz', title: r.title,
      questions: r.payload?.questions || null,
      html: r.payload?.questions ? null : (r.payload?.html || ''),
    };
  }
  if (r.kind === 'exam') {
    return { type: 'exam', title: r.title, exam: r.payload?.exam || null };
  }
  if (r.kind === 'pdf') {
    let url = null;
    const p = r.payload || {};
    if (p.pdfPath) {
      try {
        const { data: signed } = await supa.storage.from(p.bucket || 'personal-pdfs').createSignedUrl(p.pdfPath, 3600);
        url = signed?.signedUrl || null;
      } catch (e) { console.warn('catalog signedUrl:', e.message); }
    }
    return { type: 'pdf-file', title: r.title, url, pdfBase64: url ? null : (p.pdfBase64 || null) };
  }
  return { type: 'missing' };
}

const publicItem = (i) => ({ id: i.id, source: i.source, kind: i.kind, title: i.title, category: i.category, isFree: i.is_free });

module.exports = { SOURCES, FORMATS, siteQuery, notBarem, catalogList, resolveChosen, resolveTarget, publicItem };
