// =====================================================================
// api/_lib/testlock.js — „în timpul unui test pe grupă"
//
// Cât timp elevul rezolvă un TEST PE GRUPĂ, i se opresc:
//   • mesageria (canalul grupei ȘI discuțiile cu colegii) — api/messages.js;
//   • Profesorul Virtual: chatul și foto-rezolvarea — api/ai-chat.js,
//     api/ai-chat-stream.js, api/ai-vision.js.
//
// NU se oprește corectarea („📝 Răspunde în chat", api/ai-correct.js): la
// testele PDF ea E modul în care punctajul ajunge la profesor. Elevul nu poate
// CERE ajutor, dar își poate TRIMITE răspunsurile.
//
// Semnalul e `group_assignment_picks.active_until` (supabase/mesagerie.sql):
// se pune la „acum + 3 ore" când elevul apasă „Începe testul" și se șterge
// când trimite rezultatul sau apasă „Am terminat testul".
// =====================================================================

const TEST_MSG_CHAT = 'Profesorul Virtual e oprit cât timp ai un test pe grupă în desfășurare. Trimite testul (sau apasă „Am terminat testul") și revine.';
const TEST_MSG_CHAT_SHORT = 'Profesorul Virtual e oprit în timpul testului.';
const TEST_MSG_MSG = 'Mesageria e oprită cât timp ai un test pe grupă în desfășurare. Trimite testul (sau apasă „Am terminat testul") și revii la conversații.';

// { locked: boolean, title?: string }
async function activeTest(supa, userId) {
  if (!userId) return { locked: false };
  try {
    const { data, error } = await supa.from('group_assignment_picks')
      .select('id, assignment_id, active_until, completed_at')
      .eq('student_id', userId)
      .is('completed_at', null)
      .gt('active_until', new Date().toISOString())
      .limit(1);
    // coloana `active_until` apare după rularea supabase/mesagerie.sql —
    // până atunci nu blocăm nimic (funcția merge, doar oprirea nu se aplică)
    if (error || !data || !data.length) return { locked: false };
    const { data: a } = await supa.from('group_assignments')
      .select('title').eq('id', data[0].assignment_id).maybeSingle();
    return { locked: true, title: a?.title || 'Test pe grupă' };
  } catch {
    return { locked: false };
  }
}

module.exports = { activeTest, TEST_MSG_CHAT, TEST_MSG_CHAT_SHORT, TEST_MSG_MSG };
