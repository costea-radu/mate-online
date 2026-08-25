# -*- coding: utf-8 -*-
"""Patch-uri pentru funcția „Temă pe grupă" (ExamenMate)."""
import io, os, sys

ROOT = os.path.join(os.environ['HOME'], 'mnt', 'mate-online')

def read(p):
    with io.open(os.path.join(ROOT, p), encoding='utf-8') as f:
        return f.read()

def write(p, s):
    with io.open(os.path.join(ROOT, p), 'w', encoding='utf-8', newline='') as f:
        f.write(s)

def sub(path, old, new, count=1):
    s = read(path)
    if new in s and old not in s:
        print('  = deja aplicat:', path)
        return
    n = s.count(old)
    if n != count:
        print('  ! ANCORA lipsește sau e ambiguă (%d) în %s' % (n, path))
        print('    ---', old[:110].replace('\n', '\\n'))
        sys.exit(1)
    write(path, s.replace(old, new, count))
    print('  ok', path)

# ─────────────────────────────────────────────────────────────── aiClient.js
sub('src/lib/aiClient.js',
    "  assignmentSend: ({ assignmentId, studentId }) => post('/api/ai-assignment', { action: 'send', assignmentId, studentId }),\n",
    "  assignmentSend: ({ assignmentId, studentId }) => post('/api/ai-assignment', { action: 'send', assignmentId, studentId }),\n"
    "\n"
    "  // ── Teme pe GRUPĂ: un singur link, teste DIFERITE per elev ─────────────────\n"
    "  //    (api/group-assignment.js + supabase/teme_grupa.sql)\n"
    "  groupAssignmentGroups: () => post('/api/group-assignment', { action: 'groups' }),\n"
    "  groupAssignmentCatalog: ({ source, category = null, format = 'interactive', q = '' }) =>\n"
    "    post('/api/group-assignment', { action: 'catalog', source, category, format, q }),\n"
    "  groupAssignmentCreate: (payload) => post('/api/group-assignment', { action: 'create', ...payload }),\n"
    "  groupAssignmentsMine: () => post('/api/group-assignment', { action: 'mine' }),\n"
    "  groupAssignmentReport: ({ id }) => post('/api/group-assignment', { action: 'report', id }),\n"
    "  groupAssignmentDelete: ({ id }) => post('/api/group-assignment', { action: 'delete', id }),\n"
    "  groupAssignmentOpen: ({ id }) => post('/api/group-assignment', { action: 'open', id }),\n"
    "  groupAssignmentPick: ({ pickId }) => post('/api/group-assignment', { action: 'pick', pickId }),\n"
    "  groupAssignmentScore: ({ pickId, score, maxScore }) =>\n"
    "    post('/api/group-assignment', { action: 'score', pickId, score, maxScore }),\n")

# ─────────────────────────────────────────────────────────────────── App.jsx
sub('src/App.jsx',
    "const AssignmentSolver = lazy(() => import('./pages/AssignmentSolver'));\n",
    "const AssignmentSolver = lazy(() => import('./pages/AssignmentSolver'));\n"
    "const GrupaTema = lazy(() => import('./pages/GrupaTema'));\n")
sub('src/App.jsx',
    '                <Route path="/tema" element={<AssignmentSolver />} />\n',
    '                <Route path="/tema" element={<AssignmentSolver />} />\n'
    '                <Route path="/tema-grupa" element={<GrupaTema />} />\n')

# ─────────────────────────────────────────────────────────────── Profile.jsx
sub('src/pages/Profile.jsx',
    "import AITeacherReport from '../components/AITeacherReport';\n",
    "import AITeacherReport from '../components/AITeacherReport';\n"
    "import GroupAssignment from '../components/GroupAssignment';\n")

sub('src/pages/Profile.jsx',
    "            {/* Raport AI — după „Rezultate elevi\", ca rolldown */}\n            {isTeacher && (\n",
    "            {/* Temă pe grupă: un link, teste DIFERITE pentru fiecare elev.\n"
    "                Aceeași funcție e și în „Asistent AI\", după „Testele și\n"
    "                exercițiile mele\" (src/pages/ProfesorVirtual.jsx). */}\n"
    "            {isTeacher && (\n"
    "              <details className=\"card\" style={{ marginBottom: 24 }}>\n"
    "                <summary style={{ cursor: 'pointer', fontWeight: 700, color: 'var(--navy)', fontFamily: 'var(--font-display)', fontSize: '1.05rem', listStyle: 'none', display: 'flex', alignItems: 'center', gap: 8 }}>\n"
    "                  👥 Temă pe grupă — fiecare elev primește alt test\n"
    "                </summary>\n"
    "                <div style={{ marginTop: 16 }}>\n"
    "                  <GroupAssignment />\n"
    "                </div>\n"
    "              </details>\n"
    "            )}\n"
    "\n"
    "            {/* Raport AI — după „Rezultate elevi\", ca rolldown */}\n            {isTeacher && (\n")

# ────────────────────────────────────────────────────────── ProfesorVirtual.jsx
sub('src/pages/ProfesorVirtual.jsx',
    "import SendToStudents from '../components/SendToStudents';\n",
    "import SendToStudents from '../components/SendToStudents';\n"
    "import GroupAssignment from '../components/GroupAssignment';\n")

sub('src/pages/ProfesorVirtual.jsx',
    "        { id: 'library', label: '📚 Testele și exercițiile mele' },\n",
    "        { id: 'library', label: '📚 Testele și exercițiile mele' },\n"
    "        { id: 'grupa', label: '👥 Temă pe grupă (teste diferite)' },\n")

sub('src/pages/ProfesorVirtual.jsx',
    "          {tab === 'library' && <LibraryTab />}\n",
    "          {tab === 'library' && <LibraryTab />}\n"
    "          {tab === 'grupa' && <GroupTab />}\n")

sub('src/pages/ProfesorVirtual.jsx',
    "// ─── PROGRES ─────────────────────────────────────────────────────────────────\n",
    "// ─── TEMĂ PE GRUPĂ: un link, teste diferite pentru fiecare elev ──────────────\n"
    "// Aceeași funcție e montată și în „Contul meu\" (src/pages/Profile.jsx).\n"
    "function GroupTab() {\n"
    "  const { isTeacher, isAdmin } = useAuth();\n"
    "  const card = { background: '#fff', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', padding: 20, marginBottom: 18 };\n"
    "  if (!isTeacher && !isAdmin) {\n"
    "    return (\n"
    "      <div style={card}>\n"
    "        <p style={{ color: 'var(--text-muted)', fontSize: '.9rem', margin: 0 }}>\n"
    "          Trimiterea temelor pe grupă e disponibilă conturilor de <strong>profesor</strong> (grupele se fac în „Contul meu\" → Rezultate elevi).\n"
    "        </p>\n"
    "      </div>\n"
    "    );\n"
    "  }\n"
    "  return (\n"
    "    <div style={card}>\n"
    "      <h3 style={{ fontFamily: 'var(--font-display)', color: 'var(--navy)', marginBottom: 4 }}>👥 Temă pe grupă — fiecare elev primește alt test</h3>\n"
    "      <p style={{ fontSize: '.8rem', color: 'var(--text-muted)', marginBottom: 16 }}>\n"
    "        Trimiți un singur link unei grupe, iar sistemul dă fiecărui elev un test diferit de al colegilor.\n"
    "      </p>\n"
    "      <GroupAssignment />\n"
    "    </div>\n"
    "  );\n"
    "}\n"
    "\n"
    "// ─── PROGRES ─────────────────────────────────────────────────────────────────\n")

# ─────────────────────────────────────────────────────── InteractiveViewer.jsx
sub('src/pages/InteractiveViewer.jsx',
    "  const temaId = searchParams.get('temaId'); // deschis ca TEMĂ de la Meditatorul AI\n",
    "  const temaId = searchParams.get('temaId'); // deschis ca TEMĂ de la Meditatorul AI\n"
    "  const gtId = searchParams.get('gt');       // TEMĂ PE GRUPĂ (/tema-grupa): repartizarea acestui elev\n")

sub('src/pages/InteractiveViewer.jsx',
    "  const [item, setItem] = useState(state?.item || null);\n",
    "  const [item, setItem] = useState(state?.item || null);\n"
    "  // „Grant\": deschide un material PREMIUM pentru un elev fără abonament, când\n"
    "  // adminul a trimis tema pe grupă cu opțiunea „testele premium gratuit\".\n"
    "  const [grant, setGrant] = useState(state?.grant || null);\n")

sub('src/pages/InteractiveViewer.jsx',
    "    (async () => {\n"
    "      const { data } = await supabase.from('content').select('*').eq('id', idParam).single();\n"
    "      if (data) setItem(data);\n"
    "      else { setError('Materialul nu a fost găsit.'); setLoading(false); }\n"
    "    })();\n"
    "  }, [idParam]); // eslint-disable-line\n",
    "    (async () => {\n"
    "      const { data } = await supabase.from('content').select('*').eq('id', idParam).single();\n"
    "      if (data) { setItem(data); return; }\n"
    "      // Temă pe grupă cu material premium dat gratuit: RLS nu-i lasă elevului\n"
    "      // rândul din `content`, deci îl aducem de pe server (cu grant).\n"
    "      if (gtId) {\n"
    "        try {\n"
    "          const r = await aiClient.groupAssignmentPick({ pickId: gtId });\n"
    "          if (r?.target?.item) { setItem(r.target.item); setGrant(r.target.grant || null); return; }\n"
    "        } catch { /* cade pe mesajul de mai jos */ }\n"
    "      }\n"
    "      setError('Materialul nu a fost găsit.'); setLoading(false);\n"
    "    })();\n"
    "  }, [idParam]); // eslint-disable-line\n")

sub('src/pages/InteractiveViewer.jsx',
    "    const canAccess = item.is_free || isPremium || isAdmin;\n",
    "    const canAccess = item.is_free || isPremium || isAdmin || !!grant;\n")

sub('src/pages/InteractiveViewer.jsx',
    "          body: JSON.stringify({ contentId: item.id }),\n",
    "          body: JSON.stringify({ contentId: item.id, grant }),\n")

sub('src/pages/InteractiveViewer.jsx',
    "  }, [item, isPremium, authLoading]);\n",
    "  }, [item, isPremium, authLoading, grant]);\n")

sub('src/pages/InteractiveViewer.jsx',
    "      if (temaId) {\n"
    "        aiClient.meditatii({ action: 'homework_score', id: temaId, score, maxScore, answers: ans })\n"
    "          .then((r) => { if (r?.ok) setHwMarked({ grade: r.grade }); })\n"
    "          .catch(() => {});\n"
    "      }\n",
    "      if (temaId) {\n"
    "        aiClient.meditatii({ action: 'homework_score', id: temaId, score, maxScore, answers: ans })\n"
    "          .then((r) => { if (r?.ok) setHwMarked({ grade: r.grade }); })\n"
    "          .catch(() => {});\n"
    "      }\n"
    "\n"
    "      // TEMĂ PE GRUPĂ (deschisă cu ?gt=...): rezultatul intră direct în raportul\n"
    "      // profesorului, lângă testul repartizat acestui elev.\n"
    "      if (gtId) aiClient.groupAssignmentScore({ pickId: gtId, score, maxScore }).catch(() => {});\n")

# ────────────────────────────────────────────────────────────────── PDFViewer.jsx
sub('src/pages/PDFViewer.jsx',
    "  const idParam = searchParams.get('id');\n  const [item, setItem] = useState(state?.item || null);\n",
    "  const idParam = searchParams.get('id');\n"
    "  const gtId = searchParams.get('gt');       // TEMĂ PE GRUPĂ (/tema-grupa)\n"
    "  const [item, setItem] = useState(state?.item || null);\n"
    "  // „Grant\": material premium trimis gratuit de admin printr-o temă pe grupă.\n"
    "  const [grant, setGrant] = useState(state?.grant || null);\n")

sub('src/pages/PDFViewer.jsx',
    "  useEffect(() => {\n"
    "    if (item || !idParam) return;\n"
    "    (async () => {\n"
    "      const { data } = await supabase.from('content').select('*').eq('id', idParam).single();\n"
    "      if (data) setItem(data);\n"
    "      else { setError('Materialul nu a fost găsit.'); setLoading(false); }\n"
    "    })();\n"
    "  }, [idParam]); // eslint-disable-line\n",
    "  useEffect(() => {\n"
    "    if (item || !idParam) return;\n"
    "    (async () => {\n"
    "      const { data } = await supabase.from('content').select('*').eq('id', idParam).single();\n"
    "      if (data) { setItem(data); return; }\n"
    "      // Temă pe grupă cu PDF premium dat gratuit: rândul nu trece de RLS,\n"
    "      // deci îl aducem de pe server (cu grant).\n"
    "      if (gtId) {\n"
    "        try {\n"
    "          const r = await aiClient.groupAssignmentPick({ pickId: gtId });\n"
    "          if (r?.target?.item) { setItem(r.target.item); setGrant(r.target.grant || null); return; }\n"
    "        } catch { /* cade pe mesajul de mai jos */ }\n"
    "      }\n"
    "      setError('Materialul nu a fost găsit.'); setLoading(false);\n"
    "    })();\n"
    "  }, [idParam]); // eslint-disable-line\n")

sub('src/pages/PDFViewer.jsx',
    "    if (!item.is_free && !isPremium) { navigate('/preturi'); return; }\n",
    "    if (!item.is_free && !isPremium && !isAdmin && !grant) { navigate('/preturi'); return; }\n")

sub('src/pages/PDFViewer.jsx',
    "          body: JSON.stringify({ contentId: item.id }),\n",
    "          body: JSON.stringify({ contentId: item.id, grant }),\n")

sub('src/pages/PDFViewer.jsx',
    "  }, [authLoading, item, isPremium]);\n",
    "  }, [authLoading, item, isPremium, isAdmin, grant]);\n")

# ────────────────────────────────────────────────────────── ExercitiuAIViewer.jsx
sub('src/pages/ExercitiuAIViewer.jsx',
    "      if (state?.id && state?.mode === 'library') aiClient.updateLibraryScore(state.id, sc, mx).catch(() => {});\n",
    "      if (state?.id && state?.mode === 'library') aiClient.updateLibraryScore(state.id, sc, mx).catch(() => {});\n"
    "      // Temă pe grupă: scorul merge la profesor, pe repartizarea acestui elev.\n"
    "      if (state?.gtId) aiClient.groupAssignmentScore({ pickId: state.gtId, score: sc, maxScore: mx }).catch(() => {});\n")

# ───────────────────────────────────────────────────────────── get-file-url.js
sub('api/get-file-url.js',
    "    // Premium — verifică abonamentul utilizatorului REAL (din token).\n"
    "    const userId = await authUser(req, supabase);\n"
    "    const { data: profile, error: profileError } = await supabase\n"
    "      .from('profiles').select('subscription_status, is_admin').eq('id', userId).single();\n"
    "    if (profileError || (profile?.subscription_status !== 'active' && !profile?.is_admin)) {\n"
    "      return res.status(403).json({ error: 'Acces interzis. Necesită abonament Premium.' });\n"
    "    }\n",
    "    // Premium — verifică abonamentul utilizatorului REAL (din token).\n"
    "    const userId = await authUser(req, supabase);\n"
    "    const { data: profile, error: profileError } = await supabase\n"
    "      .from('profiles').select('subscription_status, is_admin').eq('id', userId).single();\n"
    "    const subscribed = !profileError && (profile?.subscription_status === 'active' || profile?.is_admin);\n"
    "\n"
    "    // „Grant\" — temă pe grupă trimisă de ADMIN cu opțiunea „testele premium\n"
    "    // gratuit\": tokenul e semnat pe server (api/group-assignment.js) și deschide\n"
    "    // EXACT acest material, EXACT acestui elev, pentru 12 ore.\n"
    "    let granted = false;\n"
    "    const { grant } = req.body || {};\n"
    "    if (!subscribed && grant) {\n"
    "      const g = require('./_lib/ai').verifyToken(grant);\n"
    "      granted = !!(g && g.t === 'gt' && g.c === contentId && g.u === userId);\n"
    "    }\n"
    "    if (!subscribed && !granted) {\n"
    "      return res.status(403).json({ error: 'Acces interzis. Necesită abonament Premium.' });\n"
    "    }\n")

print('TOATE PATCH-URILE APLICATE')
