# -*- coding: utf-8 -*-
"""Rafinări: numărătoarea rezolvărilor la testele PDF + linkul de previzualizare."""
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
        print('  = deja aplicat:', path); return
    n = s.count(old)
    if n != count:
        print('  ! ANCORA (%d) în %s:' % (n, path), old[:110].replace('\n', '\\n')); sys.exit(1)
    write(path, s.replace(old, new, count)); print('  ok', path)


# 1) „mine": testele PDF din site se bifează ca rezolvate din `progress`
sub('api/group-assignment.js',
    "  const ids = list.map((a) => a.id);\n"
    "  const { data: picks } = await supa.from('group_assignment_picks')\n"
    "    .select('assignment_id, student_id, score, max_score, completed_at').in('assignment_id', ids);\n"
    "  const agg = {};\n"
    "  (picks || []).forEach((p) => {\n"
    "    const a = (agg[p.assignment_id] || (agg[p.assignment_id] = { opened: 0, done: 0, sum: 0, n: 0 }));\n"
    "    a.opened += 1;\n"
    "    if (p.completed_at && p.max_score) { a.done += 1; a.sum += (p.score / p.max_score) * 100; a.n += 1; }\n"
    "  });\n",
    "  const ids = list.map((a) => a.id);\n"
    "  const { data: picks } = await supa.from('group_assignment_picks')\n"
    "    .select('assignment_id, item_id, student_id, score, max_score, completed_at').in('assignment_id', ids);\n"
    "\n"
    "  // Testele DIN SITE (interactive și PDF corectate de Prof. Virtual) își scriu\n"
    "  // scorul în `progress`, nu în repartizare — le luăm de acolo, ca numărul de\n"
    "  // „rezolvate\" să fie corect și pentru temele în format PDF.\n"
    "  const { data: its } = await supa.from('group_assignment_items')\n"
    "    .select('id, source, ref_id').in('assignment_id', ids);\n"
    "  const itemById = {};\n"
    "  (its || []).forEach((i) => { itemById[i.id] = i; });\n"
    "  const siteRefs = [...new Set((its || []).filter((i) => i.source === 'site').map((i) => i.ref_id))];\n"
    "  const studentIds = [...new Set((picks || []).map((p) => p.student_id))];\n"
    "  const progMap = {};\n"
    "  if (siteRefs.length && studentIds.length) {\n"
    "    const { data: prog } = await supa.from('progress')\n"
    "      .select('user_id, content_id, score, max_score, completed_at')\n"
    "      .in('content_id', siteRefs).in('user_id', studentIds);\n"
    "    (prog || []).forEach((p) => { progMap[`${p.user_id}:${p.content_id}`] = p; });\n"
    "  }\n"
    "\n"
    "  const agg = {};\n"
    "  (picks || []).forEach((p) => {\n"
    "    const a = (agg[p.assignment_id] || (agg[p.assignment_id] = { opened: 0, done: 0, sum: 0, n: 0 }));\n"
    "    a.opened += 1;\n"
    "    const it = itemById[p.item_id];\n"
    "    const pr = it && it.source === 'site' ? progMap[`${p.student_id}:${it.ref_id}`] : null;\n"
    "    const sc = p.score != null ? p.score : (pr ? pr.score : null);\n"
    "    const mx = p.max_score != null ? p.max_score : (pr ? pr.max_score : null);\n"
    "    const done = !!(p.completed_at || pr?.completed_at);\n"
    "    if (done && mx) { a.done += 1; a.sum += (sc / mx) * 100; a.n += 1; }\n"
    "  });\n")

# 2) Previzualizarea profesorului: fără `&gt=` gol în adresă
sub('src/pages/GrupaTema.jsx',
    "  const t = data.target || {};\n  const back = `/tema-grupa?id=${id}`;\n",
    "  const t = data.target || {};\n"
    "  const back = `/tema-grupa?id=${id}`;\n"
    "  // profesorul care își previzualizează propriul link nu are repartizare\n"
    "  const gtQ = data.pickId ? `&gt=${data.pickId}` : '';\n")

sub('src/pages/GrupaTema.jsx',
    "      navigate(`/exercitiu?id=${t.contentId}&gt=${data.pickId || ''}`, {\n",
    "      navigate(`/exercitiu?id=${t.contentId}${gtQ}`, {\n")

sub('src/pages/GrupaTema.jsx',
    "      navigate(`/pdf-viewer?id=${t.contentId}&gt=${data.pickId || ''}`, {\n",
    "      navigate(`/pdf-viewer?id=${t.contentId}${gtQ}`, {\n")

print('PATCH 2 APLICAT')
