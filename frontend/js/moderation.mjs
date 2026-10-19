import { $, api, node, link, button, notice, date, identity, run } from './recruitment-ui.mjs';
let cursor;
async function reports(append = false) {
  const query = new URLSearchParams({ status: $('#report-state').value });
  if (append && cursor) query.set('before', cursor);
  const data = await api('/admin/reports?' + query);
  const list = $('#reports');
  if (!append) list.replaceChildren();
  for (const r of data.items) {
    const card = node('article', null, 'm-card');
    card.append(
      node('h2', `Signalement #${r.id}`),
      node(
        'p',
        `${r.reporter_name || 'Compte supprimé'} signale ${r.reported_name || 'Compte supprimé'}`
      ),
      node('p', r.reason_code + ' · ' + date(r.created_at)),
      node(
        'p',
        r.message_body ||
          'Signalement de la conversation. Le contenu privé des autres messages n’est pas accessible ici.'
      )
    );
    const actions = node('div', null, 'm-actions');
    if (r.status_code === 'OPEN')
      for (const [code, title] of [
        ['RESOLVED', 'Traité'],
        ['DISMISSED', 'Classé sans suite']
      ])
        actions.append(
          button(title, async () => {
            await api('/admin/reports/' + r.id, 'PATCH', { status_code: code });
            await reports();
          })
        );
    card.append(actions);
    list.append(card);
  }
  if (!list.children.length) list.append(node('p', 'Aucun signalement dans cet état.'));
  cursor = data.next;
  $('#more-reports').hidden = !cursor;
}
async function memberships() {
  const data = await api('/admin/club-memberships');
  const list = $('#memberships');
  list.replaceChildren();
  for (const m of data.items) {
    const row = node('div', null, 'm-contact-result');
    row.append(
      node(
        'span',
        `${m.username} (#${m.user_id}) · ${m.name} (#${m.club_id}) · ${m.is_active ? 'actif' : 'inactif'}`
      ),
      button(m.is_active ? 'Révoquer' : 'Activer', async () => {
        if (!confirm('Modifier l’accès à ce club ?')) return;
        await api('/admin/club-memberships', 'POST', {
          user_id: m.user_id,
          club_id: m.club_id,
          is_active: !m.is_active
        });
        await memberships();
      })
    );
    list.append(row);
  }
}
async function init() {
  if (!(await identity())) return;
  await api('/admin/me');
  $('#module-content').hidden = false;
  notice('');
  $('#report-state').onchange = () => run($('#refresh-reports'), () => reports());
  $('#refresh-reports').onclick = () => run($('#refresh-reports'), () => reports());
  $('#more-reports').onclick = () => run($('#more-reports'), () => reports(true));
  $('#membership-form').onsubmit = (e) => {
    e.preventDefault();
    run($('#grant-membership'), async () => {
      const raw = new FormData(e.target);
      await api('/admin/club-memberships', 'POST', {
        user_id: Number(raw.get('user_id')),
        club_id: Number(raw.get('club_id')),
        is_active: true
      });
      notice('Accès au club accordé.');
      await memberships();
    });
  };
  await Promise.all([reports(), memberships()]);
}
init().catch((e) => notice(e.message, true));
