// =====================================================================
// src/components/Mesagerie.jsx — mesageria
//
// Două feluri de conversații, cu reguli diferite:
//   • CANALUL GRUPEI — profesorul grupei, elevii ei și părinții acelor elevi,
//     cu rolul scris în paranteză. Din grupă NU se deschid discuții 1-la-1.
//   • COLEGI — discuții 1-la-1 pe tot site-ul, cu oricine ți-a acceptat cererea:
//     profesori, elevi sau părinți (src/components/ColegiiMei.jsx).
//
// `scope`:
//   'group' → doar canalele de grupă (montat în „Contul meu");
//   'all'   → canale + colegi (pagina /mesagerie, din bara de sus).
//
// În timpul unui TEST PE GRUPĂ mesageria e OPRITĂ: conversațiile se citesc,
// dar bara de scriere e înlocuită de un mesaj explicativ.
//
// Profesorul poate atașa la un mesaj LINKUL unei teme sau al unui test (🔗).
// =====================================================================
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { aiClient } from '../lib/aiClient';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { setChatUnread } from '../lib/chatUnread';

const ROLE_TAG = { profesor: 'profesor', elev: 'elev', parinte: 'părinte' };
const ROLE_ICON = { profesor: '🧑‍🏫', elev: '🎓', parinte: '👨‍👩‍👧' };

// Câte conversații / nume se văd deodată; restul vin prin derulare.
const CONV_VIZIBILE = 5;
const INALTIME_CONV = 58;
const PERSOANE_VIZIBILE = 5;
const INALTIME_PERSOANA = 38;

// ─── TIMP REAL ───────────────────────────────────────────────────────────────
// Mesajele apar instant, prin Supabase Realtime, pe câte un canal de tip
// „broadcast" per conversație (`mesagerie:<threadId>`). Cine trimite un mesaj
// dă un semnal pe canalul conversației; ceilalți îl primesc în milisecunde și
// reîncarcă firul (sau doar lista, dacă au conversația închisă).
//
// De ce broadcast și nu `postgres_changes`: semnalul NU conține mesajul, doar
// id-ul conversației. Așa nu trebuie deschis tabelul `chat_messages` către
// browser cu politici RLS de citire — conținutul vine în continuare doar prin
// /api/messages, care verifică apartenența la grupă / legătura de colegi.
//
// Interogarea periodică rămâne ca plasă de siguranță: rară cât timp canalul e
// conectat, mai deasă dacă websocket-ul nu merge (rețea, proxy, extensii).
const RT_CANAL = (threadId) => `mesagerie:${threadId}`;
const RT_EVENIMENT = 'mesaj';
const MAX_CANALE = 24;                       // câte conversații ascultăm deodată
const POLL_MESAJE = { rt: 25000, fara: 8000 };
const POLL_LISTA = { rt: 45000, fara: 20000 };

function fmtTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  return sameDay
    ? d.toLocaleTimeString('ro-RO', { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleDateString('ro-RO', { day: '2-digit', month: 'short' }) + ' ' +
      d.toLocaleTimeString('ro-RO', { hour: '2-digit', minute: '2-digit' });
}

// `onOpenChange(deschis)` — pagina care găzduiește mesageria află când
// conversația e închisă cu „✕", ca să lățească panoul „Lista persoane".
// `openRequest` — { id, n }: firul cerut din afară (clic pe un nume din listă).
// `n` crește la fiecare clic, ca aceeași persoană să poată fi redeschisă.
export default function Mesagerie({ scope = 'all', height = 460, onOpenChange = null, openRequest = null }) {
  const navigate = useNavigate();
  const { isTeacher, isAdmin } = useAuth();
  const onlyGroups = scope === 'group';

  const [data, setData] = useState(null);        // { threads, colegi, total, testMode }
  const [error, setError] = useState(null);
  const [active, setActive] = useState(null);    // threadId
  const [msgs, setMsgs] = useState(null);
  const [members, setMembers] = useState([]);
  const [title, setTitle] = useState('');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [showPeople, setShowPeople] = useState(false);
  const [attach, setAttach] = useState(null);    // { type, url, title }
  const [attachList, setAttachList] = useState(null);
  const [showAttach, setShowAttach] = useState(false);
  const listRef = useRef(null);
  const openedRef = useRef(false);

  const loadThreads = useCallback(async () => {
    try { const r = await aiClient.chatThreads(); setData(r); return r; }
    catch (e) { setError(e.message); return null; }
  }, []);
  useEffect(() => { loadThreads(); }, [loadThreads]);

  // starea „conversație deschisă / închisă", raportată paginii
  useEffect(() => { onOpenChange?.(!!active); }, [active, onOpenChange]);

  // Bulina roșie din bara de sus se ia după lista de aici (o avem deja
  // încărcată), deci nu mai e nevoie de încă o cerere la server.
  useEffect(() => {
    const list = data?.threads;
    if (!list) return;
    const cuNoi = list.filter((t) => (t.unread || 0) > 0);
    const celMaiNou = cuNoi
      .slice()
      .sort((a, b) => new Date(b.lastMessageAt || 0) - new Date(a.lastMessageAt || 0))[0];
    setChatUnread({
      count: list.reduce((a, t) => a + (t.unread || 0), 0),
      threads: cuNoi.length,
      last: celMaiNou?.last ? {
        threadId: celMaiNou.id,
        senderName: celMaiNou.last.senderName || 'Cineva',
        roleLabel: celMaiNou.kind === 'direct' ? (celMaiNou.roleLabel || '') : '',
        body: celMaiNou.last.body || '',
        at: celMaiNou.last.at,
      } : null,
    });
  }, [data]);

  // „✕" pe conversația deschisă: rămâne doar lista, iar pagina lățește „Lista persoane"
  function closeThread() {
    setActive(null); setMsgs(null); setMembers([]); setTitle('');
    setText(''); setAttach(null); setShowAttach(false); setError(null);
  }

  const openThread = useCallback(async (threadId) => {
    setActive(threadId); setMsgs(null); setError(null);
    try {
      const r = await aiClient.chatMessages({ threadId });
      setMsgs(r.messages || []);
      setMembers(r.members || []);
      setTitle(r.title || '');
      setData((d) => (d ? {
        ...d,
        testMode: r.testMode, testMessage: r.testMessage, testTitle: r.testTitle,
        threads: d.threads.map((t) => (t.id === threadId ? { ...t, unread: 0 } : t)),
      } : d));
    } catch (e) { setError(e.message); setMsgs([]); }
  }, []);

  const threads = useMemo(() => {
    const all = data?.threads || [];
    return onlyGroups ? all.filter((t) => t.kind === 'group') : all;
  }, [data, onlyGroups]);

  // prima conversație se deschide singură
  useEffect(() => {
    if (openedRef.current || !threads.length) return;
    openedRef.current = true;
    openThread((threads.find((t) => t.unread > 0) || threads[0]).id);
  }, [threads, openThread]);

  // Clic pe un nume din „Lista persoane" → firul cerut se deschide aici, chiar
  // dacă e o conversație nou-creată (o mai aducem o dată în listă).
  useEffect(() => {
    if (!openRequest?.id) return;
    openedRef.current = true;
    openThread(openRequest.id);
    loadThreads();
  }, [openRequest, openThread, loadThreads]);

  // ── TIMP REAL ─────────────────────────────────────────────────────────────
  // Reîncarcă firul deschis fără să depindă de starea din closure (îl chemăm
  // și din canalul Realtime, și din tic-ul de siguranță).
  const activeRef = useRef(null);
  useEffect(() => { activeRef.current = active; }, [active]);

  const refreshActive = useCallback(async () => {
    const id = activeRef.current;
    if (!id) return;
    try {
      const r = await aiClient.chatMessages({ threadId: id });
      setMsgs(r.messages || []);
      setData((d) => (d ? { ...d, testMode: r.testMode, testMessage: r.testMessage, testTitle: r.testTitle } : d));
    } catch { /* rețea — reîncercăm la următorul semnal sau tic */ }
  }, []);

  // Câte un canal per conversație. Semnalul spune doar „s-a scris în firul X".
  const chansRef = useRef({});
  const debounceRef = useRef(null);
  const [rtOk, setRtOk] = useState(false);
  const threadKey = useMemo(() => threads.map((t) => t.id).join(','), [threads]);

  useEffect(() => {
    if (!threadKey) return undefined;
    const ids = threadKey.split(',').filter(Boolean).slice(0, MAX_CANALE);
    const canale = ids.map((id) => {
      const ch = supabase.channel(RT_CANAL(id), { config: { broadcast: { self: false } } });
      ch.on('broadcast', { event: RT_EVENIMENT }, () => {
        // câteva mesaje trimise una după alta → o singură reîncărcare
        clearTimeout(debounceRef.current);
        debounceRef.current = setTimeout(() => {
          if (activeRef.current === id) refreshActive();  // firul deschis → mesajele
          else loadThreads();                             // altul → doar bulina de necitite
        }, 250);
      });
      ch.subscribe((status) => {
        if (status === 'SUBSCRIBED') setRtOk(true);
        else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') setRtOk(false);
      });
      chansRef.current[id] = ch;
      return ch;
    });
    return () => {
      clearTimeout(debounceRef.current);
      canale.forEach((c) => { try { supabase.removeChannel(c); } catch { /* deja închis */ } });
      ids.forEach((id) => { delete chansRef.current[id]; });
    };
  }, [threadKey, refreshActive, loadThreads]);

  // Plasă de siguranță: rar cât timp canalul e conectat, mai des dacă nu e.
  useEffect(() => {
    if (!active) return undefined;
    const tick = () => { if (document.visibilityState !== 'hidden') refreshActive(); };
    const t = setInterval(tick, rtOk ? POLL_MESAJE.rt : POLL_MESAJE.fara);
    return () => clearInterval(t);
  }, [active, rtOk, refreshActive]);

  useEffect(() => {
    const t = setInterval(() => { if (document.visibilityState === 'visible') loadThreads(); },
      rtOk ? POLL_LISTA.rt : POLL_LISTA.fara);
    return () => clearInterval(t);
  }, [loadThreads, rtOk]);

  // Revenirea în tab / pe fereastră aduce imediat ce s-a scris între timp.
  useEffect(() => {
    const catchUp = () => {
      if (document.visibilityState === 'hidden') return;
      refreshActive(); loadThreads();
    };
    window.addEventListener('focus', catchUp);
    document.addEventListener('visibilitychange', catchUp);
    return () => {
      window.removeEventListener('focus', catchUp);
      document.removeEventListener('visibilitychange', catchUp);
    };
  }, [refreshActive, loadThreads]);

  useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [msgs]);

  const testMode = !!data?.testMode;

  async function sendMsg(e) {
    e?.preventDefault?.();
    const body = text.trim();
    if ((!body && !attach) || !active || busy || testMode) return;
    setBusy(true); setError(null);
    try {
      const r = await aiClient.chatSend({ threadId: active, body, attachment: attach });
      setMsgs((m) => [...(m || []), r.message]);
      setText(''); setAttach(null);
      // semnal în timp real către ceilalți din conversație (fără conținut)
      try {
        chansRef.current[active]?.send({
          type: 'broadcast', event: RT_EVENIMENT, payload: { threadId: active },
        });
      } catch { /* fără websocket → ceilalți îl văd la următorul tic */ }
      loadThreads();
    } catch (e2) {
      setError(e2.message);
      if (e2.code === 'TEST_MODE') setData((d) => (d ? { ...d, testMode: true, testMessage: e2.message } : d));
    }
    finally { setBusy(false); }
  }

  async function startDirect(otherId) {
    setBusy(true);
    try {
      const r = await aiClient.chatDirect({ otherId });
      await loadThreads();
      openThread(r.threadId);
      setShowPeople(false);
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }

  async function loadAttachables() {
    setShowAttach((v) => !v);
    if (attachList) return;
    try { const r = await aiClient.chatAttachables(); setAttachList(r.items || []); }
    catch { setAttachList([]); }
  }

  const colegi = onlyGroups ? [] : (data?.colegi || []);
  const activeThread = threads.find((t) => t.id === active) || null;
  const peopleOfActive = activeThread ? members : [];

  // ── stiluri ───────────────────────────────────────────────────────────────
  const box = { border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden', background: '#fff' };
  const sideBtn = (on) => ({
    display: 'flex', alignItems: 'center', gap: 8, width: '100%', textAlign: 'left',
    padding: '10px 12px', border: 'none', borderBottom: '1px solid var(--border)',
    background: on ? 'rgba(232,185,49,.14)' : 'transparent', cursor: 'pointer',
    fontFamily: 'var(--font-body)',
  });
  const bubble = (mine) => ({
    maxWidth: '78%', alignSelf: mine ? 'flex-end' : 'flex-start',
    background: mine ? 'var(--navy)' : 'var(--cream)', color: mine ? '#fff' : 'var(--text)',
    borderRadius: mine ? '14px 14px 4px 14px' : '14px 14px 14px 4px',
    padding: '8px 12px', fontSize: '.86rem', lineHeight: 1.45, wordBreak: 'break-word',
  });

  if (error && !data) return <div style={{ fontSize: '.85rem', color: '#b71c1c' }}>⚠️ {error}</div>;
  if (!data) return <div style={{ padding: 20, textAlign: 'center' }}><div className="spinner" /></div>;

  if (!threads.length && !colegi.length) {
    return (
      <div>
        {testMode && <TestBanner text={data.testMessage} title={data.testTitle} />}
        <div style={{ fontSize: '.87rem', color: 'var(--text-muted)', background: 'var(--cream)', borderRadius: 10, padding: '14px 16px' }}>
          {onlyGroups ? (
            isTeacher || isAdmin
              ? <>Nu ai încă nicio grupă cu elevi. Fă o grupă în „Grupe / Rezultate elevi" și adaugă elevi în ea — apoi aici apare canalul grupei, cu elevii și părinții lor.</>
              : <>Canalul grupei se deschide după ce profesorul tău te pune într-o grupă. Cere-i linkul de asociere sau codul lui de profesor.</>
          ) : (
            <>Nicio conversație încă. Caută-ți oamenii din „👥 Lista persoane" (Contul meu) — profesori, elevi sau părinți — și, după ce cererea e acceptată, puteți discuta 1-la-1.</>
          )}
        </div>
      </div>
    );
  }

  return (
    <div>
      {testMode && <TestBanner text={data.testMessage} title={data.testTitle} />}

      <div className="mesagerie-grid"
        style={{
          display: 'grid',
          // conversație închisă („✕") → rămâne doar lista, pe toată lățimea
          gridTemplateColumns: active ? 'minmax(0, 210px) minmax(0, 1fr)' : 'minmax(0, 1fr)',
          gap: 12, alignItems: 'stretch',
        }}>
        {/* ── Coloana din stânga: întâi „Scrie cuiva", apoi conversațiile ── */}
        {/* `alignSelf: start` — cartonașul se oprește sub ultima conversație,
            nu se întinde degeaba cât fereastra de mesaje de alături. */}
        <div style={{ ...box, display: 'flex', flexDirection: 'column', maxHeight: height, alignSelf: 'start' }}>
          <div style={{ padding: '9px 12px', borderBottom: '1px solid var(--border)', fontSize: '.72rem', fontWeight: 800, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '.04em', display: 'flex', justifyContent: 'space-between', gap: 8 }}>
            <span>{onlyGroups ? 'Canalul grupei' : 'Conversații'}</span>
            {!active && <span style={{ fontWeight: 600, textTransform: 'none', letterSpacing: 0 }}>alege una ca să o deschizi</span>}
          </div>

          {/* „Scrie cuiva din listă" — primul, cu altă culoare, ca rolldown.
              Doar în mesageria de pe tot site-ul (canalul grupei n-are 1-la-1). */}
          {!onlyGroups && (
            <div style={{ borderBottom: '1px solid var(--border)' }}>
              <button type="button" onClick={() => setShowPeople((v) => !v)} aria-expanded={showPeople}
                style={{
                  display: 'flex', alignItems: 'center', gap: 8, width: '100%', textAlign: 'left',
                  background: showPeople ? 'var(--gold)' : 'rgba(232,185,49,.18)',
                  border: 'none', borderBottom: showPeople ? '1px solid var(--border)' : 'none',
                  padding: '10px 12px', cursor: 'pointer', color: 'var(--navy)',
                  fontWeight: 800, fontSize: '.82rem', fontFamily: 'var(--font-body)',
                }}>
                <span>✍️</span>
                <span style={{ flex: 1 }}>Scrie cuiva din listă</span>
                <span style={{ fontSize: '.7rem', opacity: .7 }}>{showPeople ? '▲' : '▼'}</span>
              </button>
              {showPeople && (
                <div style={{ maxHeight: PERSOANE_VIZIBILE * INALTIME_PERSOANA, overflowY: 'auto' }}>
                  {colegi.length === 0 ? (
                    <div style={{ padding: '9px 12px', fontSize: '.76rem', color: 'var(--text-muted)' }}>
                      Nu ai încă pe nimeni în listă. Îi cauți din „👥 Lista persoane", în dreapta.
                    </div>
                  ) : colegi.map((c) => (
                    <button key={c.id} type="button" disabled={busy} onClick={() => startDirect(c.id)}
                      style={{ ...sideBtn(false), fontSize: '.8rem' }}>
                      <span>{ROLE_ICON[c.role] || '💬'}</span>
                      <span style={{ flex: 1, minWidth: 0, color: 'var(--navy)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {c.name} <span style={{ color: 'var(--text-muted)' }}>({c.roleLabel})</span>
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Conversațiile: câteva vizibile, restul prin derulare */}
          <div style={{
            overflowY: 'auto', maxHeight: CONV_VIZIBILE * INALTIME_CONV,
            flex: '0 1 auto', minHeight: 0,
          }}>
            {threads.map((t) => (
              <button key={t.id} type="button" style={sideBtn(t.id === active)} onClick={() => openThread(t.id)}>
                <span style={{ fontSize: '1.05rem' }}>{t.kind === 'group' ? '👥' : (ROLE_ICON[t.role] || '💬')}</span>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: 'block', fontWeight: 700, color: 'var(--navy)', fontSize: '.83rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {t.title}
                    {t.kind === 'direct' && <span style={{ fontWeight: 500, color: 'var(--text-muted)' }}> ({t.roleLabel})</span>}
                  </span>
                  <span style={{ display: 'block', fontSize: '.72rem', color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {t.last ? `${t.last.senderName ? t.last.senderName.split(' ')[0] + ': ' : ''}${t.last.body}` : (t.kind === 'group' ? 'canalul grupei' : 'conversație nouă')}
                  </span>
                </span>
                {t.unread > 0 && (
                  <span style={{ background: '#e74c3c', color: '#fff', borderRadius: 10, fontSize: '.65rem', fontWeight: 700, padding: '1px 6px' }}>{t.unread}</span>
                )}
              </button>
            ))}
          </div>
        </div>

        {/* ── Conversația deschisă ───────────────────────────────────────── */}
        {active && (
        <div style={{ ...box, display: 'flex', flexDirection: 'column', minHeight: 340, maxHeight: height }}>
          <div style={{ padding: '9px 13px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'flex-start', gap: 8 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <strong style={{ color: 'var(--navy)', fontSize: '.88rem' }}>
                {activeThread?.kind === 'group' ? '👥 ' : ''}{title || activeThread?.title || 'Conversație'}
                {peopleOfActive.length > 1 && (
                  <span style={{ fontWeight: 500, color: 'var(--text-muted)', fontSize: '.74rem', marginLeft: 6 }}>
                    {peopleOfActive.length} membri
                  </span>
                )}
              </strong>
              {/* Numele participanților nu mai umplu jumătate de fereastră:
                  se văd câteva, restul se derulează. */}
              {peopleOfActive.length > 0 && (
                <div style={{
                  fontSize: '.72rem', color: 'var(--text-muted)', marginTop: 2, lineHeight: 1.45,
                  maxHeight: 34, overflowY: 'auto', paddingRight: 4,
                }}>
                  {peopleOfActive.map((m) => `${m.name} (${m.roleLabel || ROLE_TAG[m.role] || m.role})`).join(' · ')}
                </div>
              )}
            </div>
            <button type="button" onClick={closeThread} title="Închide conversația" aria-label="Închide conversația"
              style={{
                flexShrink: 0, background: 'none', border: '1px solid var(--border)', borderRadius: 8,
                width: 28, height: 28, cursor: 'pointer', color: 'var(--text-muted)',
                fontSize: '.9rem', lineHeight: 1, fontFamily: 'var(--font-body)',
              }}>✕</button>
          </div>

          <div ref={listRef} style={{ flex: 1, overflowY: 'auto', padding: '12px 13px', display: 'flex', flexDirection: 'column', gap: 8 }}>
            {msgs === null && <div style={{ textAlign: 'center', padding: 16 }}><div className="spinner" /></div>}
            {msgs !== null && msgs.length === 0 && (
              <div style={{ fontSize: '.83rem', color: 'var(--text-muted)', textAlign: 'center', margin: 'auto' }}>
                Niciun mesaj încă. Scrie primul. 👋
              </div>
            )}
            {(msgs || []).map((m) => (
              <div key={m.id} style={{ display: 'flex', flexDirection: 'column', alignItems: m.mine ? 'flex-end' : 'flex-start' }}>
                {!m.mine && (
                  <span style={{ fontSize: '.7rem', color: 'var(--text-muted)', marginBottom: 2, paddingLeft: 4 }}>
                    {m.sender_name} <strong style={{ fontWeight: 600 }}>({m.roleLabel})</strong>
                  </span>
                )}
                <div style={bubble(m.mine)}>
                  {m.body}
                  {m.attachment?.url && (
                    <button type="button" onClick={() => navigate(m.attachment.url)}
                      style={{
                        display: 'block', marginTop: m.body ? 8 : 0, width: '100%', textAlign: 'left',
                        background: m.mine ? 'rgba(255,255,255,.14)' : '#fff', color: m.mine ? '#fff' : 'var(--navy)',
                        border: `1px solid ${m.mine ? 'rgba(255,255,255,.3)' : 'var(--border)'}`,
                        borderRadius: 8, padding: '7px 10px', cursor: 'pointer', fontSize: '.8rem', fontWeight: 600,
                        fontFamily: 'var(--font-body)',
                      }}>
                      {m.attachment.type === 'test' ? '🧩 Test pe grupă' : '📝 Temă'} · {m.attachment.title}
                      <span style={{ display: 'block', fontWeight: 500, opacity: .75, fontSize: '.72rem' }}>Deschide →</span>
                    </button>
                  )}
                </div>
                <span style={{ fontSize: '.66rem', color: 'var(--text-muted)', marginTop: 2 }}>{fmtTime(m.created_at)}</span>
              </div>
            ))}
          </div>

          {error && <div style={{ padding: '6px 13px', fontSize: '.78rem', color: '#b71c1c' }}>⚠️ {error}</div>}

          {attach && !testMode && (
            <div style={{ padding: '7px 13px', borderTop: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 8, background: 'rgba(39,174,96,.07)' }}>
              <span style={{ fontSize: '.78rem', color: 'var(--navy)', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                🔗 {attach.title}
              </span>
              <button type="button" onClick={() => setAttach(null)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#c0392b', fontSize: '.9rem' }}>✕</button>
            </div>
          )}

          {showAttach && !testMode && (
            <div style={{ borderTop: '1px solid var(--border)', maxHeight: 150, overflowY: 'auto' }}>
              {attachList === null && <div style={{ padding: 12, textAlign: 'center' }}><div className="spinner" /></div>}
              {attachList?.length === 0 && (
                <div style={{ padding: '10px 13px', fontSize: '.78rem', color: 'var(--text-muted)' }}>
                  Nu ai încă teme sau teste create. Le faci cu „📝 Dă temă" (lângă grupă / elev) sau cu „Test pe grupă".
                </div>
              )}
              {(attachList || []).map((it) => (
                <button key={`${it.type}:${it.url}`} type="button"
                  onClick={() => { setAttach({ type: it.type, url: it.url, title: it.title }); setShowAttach(false); }}
                  style={{ ...sideBtn(false), fontSize: '.8rem' }}>
                  <span>{it.type === 'test' ? '🧩' : '📝'}</span>
                  <span style={{ flex: 1, minWidth: 0, color: 'var(--navy)' }}>
                    {it.title}{it.note ? <span style={{ color: 'var(--text-muted)' }}> · {it.note}</span> : null}
                  </span>
                </button>
              ))}
            </div>
          )}

          {testMode ? (
            <div style={{ padding: '11px 13px', borderTop: '1px solid var(--border)', background: 'rgba(198,40,40,.06)', fontSize: '.8rem', color: '#8a3b3b', fontWeight: 600 }}>
              🔒 Nu poți scrie acum — ai un test pe grupă în desfășurare.
            </div>
          ) : (
            <form onSubmit={sendMsg} style={{ display: 'flex', gap: 8, padding: '9px 11px', borderTop: '1px solid var(--border)', alignItems: 'center' }}>
              {(isTeacher || isAdmin) && (
                <button type="button" onClick={loadAttachables} title="Atașează linkul unei teme sau al unui test"
                  style={{ background: 'none', border: '1px solid var(--border)', borderRadius: 8, cursor: 'pointer', fontSize: '.95rem', padding: '6px 9px' }}>🔗</button>
              )}
              <input value={text} onChange={(e) => setText(e.target.value)} maxLength={2000}
                placeholder="Scrie un mesaj…" disabled={!active}
                style={{ flex: 1, minWidth: 0, border: '1px solid var(--border)', borderRadius: 20, padding: '9px 14px', fontSize: '.85rem', fontFamily: 'var(--font-body)' }} />
              <button className="btn btn-sm btn-primary" type="submit" disabled={busy || !active || (!text.trim() && !attach)}>
                {busy ? '…' : 'Trimite'}
              </button>
            </form>
          )}
        </div>
        )}
      </div>

      <style>{`
        @media (max-width: 640px) {
          .mesagerie-grid { grid-template-columns: 1fr !important; }
        }
      `}</style>
    </div>
  );
}

// ─── „Mesageria e oprită în timpul testului" ────────────────────────────────
export function TestBanner({ text, title }) {
  return (
    <div style={{
      display: 'flex', gap: 10, alignItems: 'flex-start',
      background: 'rgba(198,40,40,.07)', border: '1px solid rgba(198,40,40,.35)',
      borderRadius: 12, padding: '11px 14px', marginBottom: 12,
    }}>
      <span style={{ fontSize: '1.15rem', lineHeight: 1 }}>🔒</span>
      <div>
        <div style={{ fontWeight: 700, color: '#8a3b3b', fontSize: '.87rem' }}>
          Mesageria e oprită în timpul testului{title ? ` „${title}"` : ''}
        </div>
        <div style={{ fontSize: '.8rem', color: 'var(--text-muted)', marginTop: 2 }}>
          {text || 'Trimite testul (sau apasă „Am terminat testul") și revii la conversații.'}
        </div>
      </div>
    </div>
  );
}
