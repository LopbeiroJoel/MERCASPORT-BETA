import {
  $,
  api,
  node,
  link,
  button,
  notice,
  date,
  avatar,
  linkedText,
  options,
  label,
  identity,
  profileView,
  select,
  run
} from './recruitment-ui.mjs';
let me,
  current,
  listCursor,
  historyCursor,
  source,
  failures = 0,
  pendingNonce = null,
  loading = false,
  again = false,
  profile,
  live = true;
const root = $('#module-content'),
  layout = $('#chat-layout'),
  inbox = $('#conversation-list'),
  history = $('#message-history');
async function conversationList(append = false) {
  const query = new URLSearchParams({ filter: $('#inbox-filter').value });
  if (append && listCursor) {
    query.set('before_time', listCursor.before_time);
    query.set('before_id', listCursor.before_id);
  }
  const data = await api('/conversations?' + query);
  if (!append) inbox.replaceChildren();
  for (const item of data.items) {
    const row = button('', () => open(item.id), 'm-conversation');
    row.setAttribute('aria-current', String(item.id === current?.id));
    const copy = node('span');
    copy.append(
      node('strong', item.peer_name),
      node('small', item.last_message || 'Nouvelle conversation'),
      node('small', date(item.last_message_at || item.updated_at))
    );
    if (item.application_status)
      copy.append(node('small', label('application_statuses', item.application_status)));
    row.append(avatar(item.peer_avatar, item.peer_name), copy);
    if (item.unread_count) row.append(node('span', item.unread_count, 'm-badge'));
    inbox.append(row);
  }
  if (!inbox.children.length)
    inbox.append(node('p', 'Aucune conversation dans ce filtre.', 'm-empty'));
  listCursor = data.next;
  $('#more-conversations').hidden = !data.next;
}
function messageBubble(message) {
  const box = node('article', null, 'm-bubble' + (message.mine ? ' mine' : ''));
  box.dataset.id = message.id;
  const content = node('p');
  content.append(linkedText(message.message_body));
  box.append(
    content,
    node(
      'small',
      date(message.created_at) + (message.mine ? ' · ' + (message.read ? 'Lu' : 'Envoyé') : '')
    )
  );
  if (!message.mine) box.append(button('Signaler', () => report(message.id)));
  return box;
}
async function loadMessages(older = false) {
  const cid = current?.id;
  if (!cid) return;
  const data = await api(
    `/conversations/${cid}/messages` + (older && historyCursor ? '?before=' + historyCursor : '')
  );
  if (current?.id !== cid) return;
  const oldHeight = history.scrollHeight,
    nearBottom = history.scrollHeight - history.scrollTop - history.clientHeight < 100;
  if (!older) history.replaceChildren();
  const fragment = document.createDocumentFragment();
  data.items.forEach((m) => fragment.append(messageBubble(m)));
  if (older) history.prepend(fragment);
  else history.append(fragment);
  historyCursor = data.next_before;
  $('#older-messages').hidden = !historyCursor;
  if (older) history.scrollTop = history.scrollHeight - oldHeight;
  else if (nearBottom || !history.dataset.loaded) {
    history.scrollTop = history.scrollHeight;
    history.dataset.loaded = 'yes';
  }
  if (!document.hidden && data.items.length && !older) {
    await api(`/conversations/${cid}/read`, 'PATCH', { last_message_id: data.items.at(-1).id });
  }
}
async function loadProfile() {
  const cid = current.id;
  const data = await api(`/conversations/${cid}/profile`);
  if (current?.id !== cid) return;
  profile = data;
  const side = $('#profile-panel');
  side.replaceChildren(
    button('Fermer', () => side.classList.remove('is-open'), 'm-mobile-back'),
    profileView(data, true)
  );
  const actions = node('div', null, 'm-actions');
  const url =
    data.role === 'PLAYER'
      ? `cv.html?user=${data.user.id}&conversation=${cid}`
      : `cv.html?club=${current.acting_club_id || data.profile?.id}`;
  actions.append(
    link(
      data.role === 'PLAYER' ? 'Voir le CV sportif complet' : 'Voir le profil du club',
      url,
      'm-button'
    )
  );
  side.append(actions);
}
async function open(id) {
  current = await api('/conversations/' + id);
  history.dataset.loaded = '';
  layout.classList.add('thread-open');
  document.body.classList.add('chat-active');
  $('#chat-title').textContent = current.peer.name;
  $('#chat-role').textContent = current.peer.role === 'PLAYER' ? 'Joueur' : 'Club';
  $('#conversation-actions').replaceChildren();
  const actions = $('#conversation-actions');
  actions.append(
    button('Profil / CV', () => $('#profile-panel').classList.toggle('is-open')),
    button(current.archived ? 'Désarchiver' : 'Archiver', async () => {
      await api('/conversations/' + id, 'PATCH', { archived: !current.archived });
      await open(id);
      await conversationList();
    }),
    button('Signaler', () => report()),
    button('Bloquer', async () => {
      if (!confirm('Bloquer cet interlocuteur ? Aucun nouveau message ne pourra être envoyé.'))
        return;
      await api('/blocks', 'POST', { user_id: current.peer.id });
      await open(id);
    })
  );
  if (current.announcement_id)
    actions.append(link('Voir l’annonce', 'offres.html?ad=' + current.announcement_id));
  if (current.application)
    actions.append(
      link(
        label('application_statuses', current.application.status_code),
        'candidatures.html?id=' + current.application.id
      )
    );
  $('#share-cv-label').hidden = !!current.acting_club_id;
  $('#share-cv').checked = current.share_profile;
  $('#send-message').disabled = current.blocked;
  $('#message-text').disabled = current.blocked;
  $('#blocked-note').hidden = !current.blocked;
  history.replaceChildren(node('p', 'Chargement…'));
  await Promise.all([loadMessages(), loadProfile()]);
  await conversationList();
  history.scrollTop = history.scrollHeight;
  history.dataset.loaded = 'yes';
  const url = new URL(location.href);
  url.searchParams.set('conversation', id);
  window.history.replaceState(null, '', url);
}
async function report(messageId) {
  const form = $('#report-form');
  form.reset();
  form.dataset.message = messageId || '';
  $('#report-title').textContent = messageId ? 'Signaler ce message' : 'Signaler la conversation';
  $('#report-dialog').showModal();
}
async function notifications() {
  const data = await api('/notifications');
  $('#notification-count').textContent = data.unread || '';
  const list = $('#notification-list');
  list.replaceChildren();
  for (const n of data.items) {
    const row = node('div', null, 'm-history-line');
    const title =
      {
        MESSAGE: 'Nouveau message',
        APPLICATION: 'Nouvelle candidature',
        CONTACT: 'Nouveau contact',
        VIEWED: 'Candidature consultée',
        STATUS: 'Statut mis à jour',
        TRIAL_PROPOSED: 'Essai proposé',
        TRIAL_ACCEPTED: 'Essai accepté'
      }[n.type_code] || 'Notification';
    row.append(node('p', title + ' · ' + date(n.created_at)));
    if (n.conversation_id)
      row.append(
        button('Ouvrir', async () => {
          await api('/notifications/' + n.id, 'PATCH', {});
          $('#notification-dialog').close();
          await open(n.conversation_id);
          await notifications();
        })
      );
    else if (!n.read_at)
      row.append(
        button('Marquer lue', async () => {
          await api('/notifications/' + n.id, 'PATCH', {});
          await notifications();
        })
      );
    list.append(row);
  }
  if (!data.items.length) list.append(node('p', 'Aucune notification.'));
}
async function refresh() {
  if (loading) {
    again = true;
    return;
  }
  loading = true;
  try {
    await Promise.all([conversationList(), notifications()]);
    if (current) {
      const info = await api('/conversations/' + current.id);
      if (info.id === current.id) {
        current = info;
        const status = $('#conversation-actions a[href^="candidatures.html"]');
        if (status && info.application)
          status.textContent = label('application_statuses', info.application.status_code);
        $('#blocked-note').hidden = !info.blocked;
        $('#message-text').disabled = info.blocked;
        if (info.blocked) $('#send-message').disabled = true;
      }
      await loadMessages();
      await loadProfile();
    }
  } catch (error) {
    notice(error.message, true);
    if (error.status === 401) {
      stopLive();
      $('#live-status').textContent = 'Session expirée · reconnectez-vous.';
    }
  } finally {
    loading = false;
    if (again) {
      again = false;
      setTimeout(refresh, 150);
    }
  }
}
function stopLive() {
  source?.close();
  source = null;
}
function startLive() {
  stopLive();
  if (!live || document.hidden || !me) return;
  source = new EventSource('/messaging/events');
  source.addEventListener('ready', () => {
    failures = 0;
    $('#live-status').textContent = 'Réception en direct';
    refresh();
  });
  source.addEventListener('refresh', refresh);
  source.onerror = () => {
    failures++;
    $('#live-status').textContent = 'Reconnexion… Actualiser reste disponible.';
    if (failures >= 3) {
      stopLive();
      $('#live-status').textContent = 'Direct indisponible · cliquez sur Actualiser.';
    }
  };
}
async function contacts() {
  const data = await api('/contacts?q=' + encodeURIComponent($('#contact-search').value));
  const list = $('#contact-results');
  list.replaceChildren();
  for (const item of data.items) {
    const row = node('div', null, 'm-contact-result');
    row.append(
      node('span', item.name + ' · ' + (item.role === 'PLAYER' ? 'Joueur' : 'Club')),
      button('Contacter', async () => {
        const body =
          item.role === 'CLUB'
            ? { club_id: item.club_id }
            : { player_user_id: item.user_id, as_club_id: Number($('#contact-club').value) };
        const result = await api('/conversations', 'POST', body);
        $('#contact-dialog').close();
        await open(result.id);
      })
    );
    list.append(row);
  }
  if (!data.items.length)
    list.append(node('p', 'Aucun résultat. Recherchez un pseudo joueur ou un nom de club.'));
}
async function blocks() {
  const data = await api('/blocks');
  const list = $('#block-list');
  list.replaceChildren();
  for (const item of data.items) {
    const row = node('div', null, 'm-contact-result');
    row.append(
      node('span', item.username),
      button('Débloquer', async () => {
        await api('/blocks/' + item.blocked_user_id, 'DELETE');
        await blocks();
        if (current) await open(current.id);
      })
    );
    list.append(row);
  }
  if (!data.items.length) list.append(node('p', 'Aucun compte bloqué.'));
  $('#block-dialog').showModal();
}
async function init() {
  await options();
  me = await identity();
  if (!me) return;
  root.hidden = false;
  $('#module-status').textContent = '';
  $('#inbox-filter').addEventListener('change', () =>
    run($('#refresh-conversations'), () => conversationList())
  );
  $('#more-conversations').onclick = () =>
    run($('#more-conversations'), () => conversationList(true));
  $('#older-messages').onclick = () => run($('#older-messages'), () => loadMessages(true));
  $('#refresh-conversations').onclick = refresh;
  $('#back-inbox').onclick = () => {
    layout.classList.remove('thread-open');
    document.body.classList.remove('chat-active');
  };
  $('#show-blocks').onclick = () => run($('#show-blocks'), blocks);
  $('#show-notifications').onclick = () =>
    run($('#show-notifications'), async () => {
      await notifications();
      $('#notification-dialog').showModal();
    });
  $('#new-contact').onclick = () => $('#contact-dialog').showModal();
  const ownClub = $('#contact-club');
  me.clubs.forEach((club) => {
    const option = node('option', club.name);
    option.value = club.id;
    ownClub.append(option);
  });
  $('#contact-club-label').hidden = !me.clubs.length;
  const reason = select('reason_code', 'Motif', (await options()).report_reasons, '', false);
  $('#report-fields').append(reason);
  $('#contact-form').onsubmit = (event) => {
    event.preventDefault();
    run($('#find-contacts'), contacts);
  };
  $('#report-form').onsubmit = (event) => {
    event.preventDefault();
    run($('#submit-report'), async () => {
      await api('/reports', 'POST', {
        conversation_id: current.id,
        reason_code: new FormData(event.target).get('reason_code'),
        ...(event.target.dataset.message ? { message_id: event.target.dataset.message } : {})
      });
      $('#report-dialog').close();
      notice('Signalement transmis à l’administration.');
    });
  };
  $('#message-form').onsubmit = (event) => {
    event.preventDefault();
    run($('#send-message'), async () => {
      if (!current) return;
      const value = $('#message-text').value.trim();
      if (!value) return;
      pendingNonce ||= crypto.randomUUID();
      await api(`/conversations/${current.id}/messages`, 'POST', {
        message_body: value,
        client_nonce: pendingNonce
      });
      pendingNonce = null;
      $('#message-text').value = '';
      await refresh();
      history.scrollTop = history.scrollHeight;
    });
  };
  $('#message-text').addEventListener('input', () => {
    pendingNonce = null;
  });
  $('#share-cv').onchange = () =>
    run($('#share-cv'), async () => {
      await api('/conversations/' + current.id, 'PATCH', { share_profile: $('#share-cv').checked });
      await loadProfile();
      notice('Choix de partage enregistré.');
    });
  $('#live-toggle').onchange = () => {
    live = $('#live-toggle').checked;
    if (live) startLive();
    else {
      stopLive();
      $('#live-status').textContent = 'Mode manuel · utilisez Actualiser.';
    }
  };
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) stopLive();
    else {
      refresh();
      startLive();
    }
  });
  window.addEventListener('pagehide', stopLive);
  document
    .querySelectorAll('[data-close]')
    .forEach((el) => (el.onclick = () => el.closest('dialog').close()));
  await refresh();
  const id = new URLSearchParams(location.search).get('conversation');
  if (id) await open(id);
  startLive();
}
init().catch((error) => notice(error.message, true));
