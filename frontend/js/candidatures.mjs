import {
  $,
  api,
  node,
  link,
  button,
  notice,
  date,
  options,
  label,
  identity,
  profileView,
  run
} from './recruitment-ui.mjs';
let cursor;
const transitions = {
  SENT: ['VIEWED', 'DISCUSSING', 'TRIAL_PROPOSED', 'ACCEPTED', 'REJECTED', 'WITHDRAWN'],
  VIEWED: ['DISCUSSING', 'TRIAL_PROPOSED', 'ACCEPTED', 'REJECTED', 'WITHDRAWN'],
  DISCUSSING: ['TRIAL_PROPOSED', 'ACCEPTED', 'REJECTED', 'WITHDRAWN'],
  TRIAL_PROPOSED: ['TRIAL_ACCEPTED', 'DISCUSSING', 'REJECTED', 'WITHDRAWN'],
  TRIAL_ACCEPTED: ['ACCEPTED', 'REJECTED', 'WITHDRAWN']
};
async function detail(id) {
  const data = await api('/applications/' + id),
    a = data.application;
  const box = $('#application-detail');
  box.replaceChildren(
    node('h2', a.title),
    node('p', `${a.player_name} → ${a.club_name}`),
    node('p', label('application_statuses', a.status_code))
  );
  const actions = node('div', null, 'm-actions');
  if (a.conversation_id)
    actions.append(
      link('Ouvrir la conversation', 'messages.html?conversation=' + a.conversation_id, 'm-button')
    );
  for (const status of transitions[a.status_code] || []) {
    if (['WITHDRAWN', 'TRIAL_ACCEPTED'].includes(status) !== a.is_player) continue;
    actions.append(
      button(label('application_statuses', status), async () => {
        if (!confirm('Confirmer : ' + label('application_statuses', status) + ' ?')) return;
        await api('/applications/' + a.id, 'PATCH', { status_code: status });
        await detail(id);
        await load();
      })
    );
  }
  box.append(actions);
  if (!a.is_player && a.conversation_id) {
    const p = await api(`/profiles/${a.player_user_id}?conversation_id=${a.conversation_id}`);
    box.append(
      profileView(p, true),
      link(
        'Voir le CV complet',
        `cv.html?user=${a.player_user_id}&conversation=${a.conversation_id}`
      )
    );
  }
  const timeline = node('ol', null, 'm-timeline');
  data.history.forEach((h) =>
    timeline.append(
      node('li', date(h.created_at) + ' · ' + label('application_statuses', h.new_status_code))
    )
  );
  box.append(node('h3', 'Suivi de la candidature'), timeline);
  $('#application-dialog').showModal();
}
async function load(append = false) {
  const data = await api('/applications' + (append && cursor ? '?before=' + cursor : ''));
  const list = $('#application-list');
  if (!append) list.replaceChildren();
  const ad = new URLSearchParams(location.search).get('ad');
  for (const a of data.items) {
    if (ad && String(a.ad_id) !== ad) continue;
    const card = node('article', null, 'm-card');
    card.append(
      node('span', label('application_statuses', a.status_code), 'm-tag'),
      node('h2', a.title),
      node('p', a.is_player ? a.club_name : a.player_name),
      node('p', date(a.created_at))
    );
    const actions = node('div', null, 'm-actions');
    actions.append(button('Consulter et suivre', () => detail(a.id)));
    if (a.conversation_id)
      actions.append(link('Messages', 'messages.html?conversation=' + a.conversation_id));
    card.append(actions);
    list.append(card);
  }
  if (!list.children.length)
    list.append(
      node('p', 'Aucune candidature. Vous pouvez aussi prendre contact sans postuler.', 'm-empty')
    );
  cursor = data.next;
  $('#more-applications').hidden = !cursor;
}
async function init() {
  await options();
  if (!(await identity())) return;
  $('#module-content').hidden = false;
  notice('');
  $('#more-applications').onclick = () => run($('#more-applications'), () => load(true));
  $('#refresh-applications').onclick = () => run($('#refresh-applications'), () => load());
  document
    .querySelectorAll('[data-close]')
    .forEach((b) => (b.onclick = () => b.closest('dialog').close()));
  await load();
  const id = new URLSearchParams(location.search).get('id');
  if (id) await detail(id);
}
init().catch((e) => notice(e.message, true));
