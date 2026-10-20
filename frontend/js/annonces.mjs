import { mountPlayerFields, playerDetailsView } from './player-ad-fields.mjs';
import {
  $,
  api,
  node,
  link,
  button,
  notice,
  options,
  label,
  identity,
  select,
  input,
  choices,
  values,
  run,
  profileView
} from './recruitment-ui.mjs';
let me,
  own = false,
  mode = 'CLUB_SEARCH',
  cursor,
  editing,
  formType = 'PLAYER_SEARCH',
  catalog,
  playerEditor;
const list = $('#market-list'),
  form = $('#ad-form');
async function load(append = false) {
  const query = new URLSearchParams({
    view: 'market',
    ...(own ? { owned: '1' } : { type: mode })
  });
  if (append && cursor) query.set('before', cursor);
  for (const [key, value] of new FormData($('#filter-form'))) if (value) query.set(key, value);
  const data = await api('/ads?' + query);
  if (!append) list.replaceChildren();
  for (const ad of data.items) list.append(card(ad));
  if (!list.children.length)
    list.append(node('p', 'Aucune annonce ne correspond à ces critères.', 'm-empty'));
  cursor = data.next;
  $('#more-ads').hidden = !cursor;
}
function tags(ad) {
  return [
    label('announcement_types', ad.announcement_type),
    ...ad.positions.map((p) => label('positions', p)),
    ad.division_code,
    ad.city,
    ad.availability_code ? label('availability', ad.availability_code) : null
  ].filter(Boolean);
}
function card(ad) {
  const el = node('article', null, 'm-card');
  const labels = node('div');
  tags(ad).forEach((t) => labels.append(node('span', t, 'm-tag')));
  el.append(
    labels,
    node('h2', ad.title),
    node('p', ad.author_name),
    node(
      'p',
      (ad.description || 'Les détails seront précisés lors du premier échange.').slice(0, 240)
    )
  );
  if (own)
    el.append(
      node(
        'p',
        label('announcement_statuses', ad.status) +
          (ad.application_count ? ` · ${ad.application_count} candidature(s)` : '')
      )
    );
  const actions = node('div', null, 'm-actions');
  actions.append(button('Voir l’annonce', () => detail(ad.id)));
  if (own) {
    actions.append(
      button('Modifier', () => editor(ad)),
      button('Renouveler', async () => {
        if (!confirm('Publier cette annonce pour 30 jours ?')) return;
        await api('/ads/' + ad.id + '/renew', 'POST', {});
        await load();
      })
    );
    if (ad.status === 'PUBLISHED')
      actions.append(
        button('Suspendre', async () => {
          await api('/ads/' + ad.id, 'PATCH', { status: 'SUSPENDED' });
          await load();
        })
      );
    actions.append(
      button('Archiver', async () => {
        if (!confirm('Archiver cette annonce ?')) return;
        await api('/ads/' + ad.id, 'PATCH', { status: 'ARCHIVED' });
        await load();
      })
    );
    if (ad.announcement_type === 'CLUB_SEARCH')
      actions.append(link('Candidatures', 'candidatures.html?ad=' + ad.id));
  }
  el.append(actions);
  return el;
}
async function detail(id) {
  const ad = await api('/ads/' + id + '?view=market');
  const target = $('#ad-detail-content');
  target.replaceChildren(node('h2', ad.title), node('p', ad.author_name));
  tags(ad).forEach((t) => target.append(node('span', t, 'm-tag')));
  target.append(node('p', ad.description || 'Aucun détail supplémentaire.'));
  const dl = node('dl');
  for (const [name, group, field] of [
    ['Mobilité', 'mobility', 'mobility_code'],
    ['Catégorie', 'categories', 'category_code'],
    ['Recrutement', 'recruitment_types', 'recruitment_type_code'],
    ['Qualités', 'qualities', 'qualities'],
    ['Projet', 'project_types', 'project_types'],
    ['Conditions', 'conditions', 'conditions']
  ]) {
    const value = ad[field];
    if (value?.length) {
      dl.append(
        node('dt', name),
        node(
          'dd',
          Array.isArray(value)
            ? value.map((v) => label(group, v)).join(', ')
            : label(group, value)
        )
      );
    }
  }
  target.append(ad.announcement_type === 'PLAYER_SEARCH' ? playerDetailsView(ad) : dl);
  const actions = node('div', null, 'm-actions');
  actions.append(
    button('Voir le profil', async () => {
      if (!me) {
        location.href = 'login.html';
        return;
      }
      const data = await api(
        ad.announcement_type === 'PLAYER_SEARCH'
          ? '/profiles/' + ad.author_id
          : '/clubs/' + ad.club_id + '/public-profile'
      );
      $('#public-profile-content').replaceChildren(profileView(data));
      $('#public-profile-dialog').showModal();
    })
  );
  if (!me) actions.append(link('Se connecter pour échanger', 'login.html', 'm-button'));
  else if (
    ad.announcement_type === 'CLUB_SEARCH' &&
    me.user.role === 'PLAYER' &&
    ad.author_id !== me.user.id
  ) {
    actions.append(
      button('Postuler', () => {
        const apply = $('#apply-form');
        apply.dataset.id = ad.id;
        apply.reset();
        $('#apply-dialog').showModal();
      }),
      button('Contacter le club', () => contact(ad))
    );
  } else if (
    ad.announcement_type === 'PLAYER_SEARCH' &&
    me.clubs.length &&
    ad.author_id !== me.user.id
  )
    actions.append(button('Contacter le joueur', () => contact(ad)));
  target.append(actions);
  $('#ad-detail-dialog').showModal();
}
async function contact(ad) {
  let club;
  if (ad.announcement_type === 'PLAYER_SEARCH') {
    const picker = $('#acting-club');
    club = Number(picker.value || me.clubs[0]?.id);
    if (!club) throw new Error('Choisissez votre club.');
  }
  const result = await api('/conversations', 'POST', {
    announcement_id: ad.id,
    ...(club ? { as_club_id: club } : {})
  });
  location.href = 'messages.html?conversation=' + result.id;
}
async function editor(ad) {
  editing = ad || null;
  $('#ad-editor-title').textContent = ad ? 'Modifier mon annonce' : 'Créer mon annonce';
  $('#editor-fields').replaceChildren();
  formType =
    ad?.announcement_type || (me.user.role === 'PLAYER' ? 'PLAYER_SEARCH' : 'CLUB_SEARCH');
  const type = $('#ad-type');
  type.replaceChildren();
  if (me.user.role === 'PLAYER') {
    const o = node('option', 'Joueur recherche un club');
    o.value = 'PLAYER_SEARCH';
    type.append(o);
  }
  if (me.clubs.length) {
    const o = node('option', 'Club recherche un joueur');
    o.value = 'CLUB_SEARCH';
    type.append(o);
  }
  type.value = formType;
  type.disabled = !!ad;
  await fields(ad || {});
  $('#ad-editor').showModal();
}
async function fields(ad = {}) {
  formType = $('#ad-type').value;
  const box = $('#editor-fields');
  box.replaceChildren();
  form.noValidate = formType === 'PLAYER_SEARCH';
  if (formType === 'PLAYER_SEARCH') {
    playerEditor = mountPlayerFields(box, catalog, ad);
    box.append(
      select(
        'status',
        'État de l’annonce',
        catalog.announcement_statuses.filter((s) => s.code !== 'DELETED'),
        ad.status || 'DRAFT',
        false
      )
    );
    return;
  }
  if (formType === 'CLUB_SEARCH')
    box.append(
      select(
        'club_id',
        'Publier au nom de',
        me.clubs.map((c) => ({ code: c.id, label: c.name })),
        ad.club_id || me.clubs[0]?.id,
        false
      )
    );
  box.append(
    input('title', 'Titre (facultatif)', ad.title || ''),
    input('description', 'Description (facultative)', ad.description || '', 'textarea', 5000),
    input(
      'city',
      'Ville à publier (facultative)',
      ad.city ||
        (formType === 'CLUB_SEARCH'
          ? me.clubs.find((c) => c.id === ad.club_id)?.city || me.clubs[0]?.city
          : ''),
      'text',
      100
    )
  );
  const grid = node('div', null, 'm-form-grid');
  for (const [key, title, group] of [
    ['sport_code', 'Sport', 'sports'],
    ['division_code', 'Niveau recherché', 'divisions'],
    ['availability_code', 'Disponibilité', 'availability']
  ])
    grid.append(select(key, title, catalog[group], ad[key]));
  grid.append(
      select('category_code', 'Catégorie', catalog.categories, ad.category_code),
      select(
        'recruitment_type_code',
        'Type de recrutement',
        catalog.recruitment_types,
        ad.recruitment_type_code
      ),
      select(
        'preferred_foot_code',
        'Pied préféré',
        catalog.feet,
        catalog.feet.find((f) => f.label === ad.preferred_foot)?.code
      )
    );
  box.append(
    grid,
    choices('positions', 'Postes recherchés', catalog.positions, ad.positions || [], 3),
    choices('qualities', 'Qualités', catalog.qualities, ad.qualities || [], 5)
  );
  box.append(
    choices('conditions', 'Conditions sportives', catalog.conditions, ad.conditions || [], 3)
  );
  box.append(
    select(
      'status',
      'État de l’annonce',
      catalog.announcement_statuses.filter((s) => s.code !== 'DELETED'),
      ad.status || 'DRAFT',
      false
    )
  );
}
async function save(event) {
  event.preventDefault();
  await run($('#save-ad'), async () => {
    if (formType === 'PLAYER_SEARCH') {
      const status = form.elements.status.value;
      const errors = playerEditor.validate(status === 'PUBLISHED');
      playerEditor.showErrors(errors);
      if (Object.keys(errors).length) throw new Error('Vérifiez les champs indiqués.');
      try {
        await api(editing ? '/ads/' + editing.id : '/ads', editing ? 'PATCH' : 'POST', {
          announcement_type: formType,
          status,
          ...playerEditor.read()
        });
      } catch (error) {
        playerEditor.showErrors(error.fields);
        throw error;
      }
      $('#ad-editor').close();
      notice('Annonce enregistrée.');
      await load();
      return;
    }
    const body = Object.fromEntries(new FormData(form));
    delete body.announcement_type;
    body.announcement_type = formType;
    delete body.club_id;
    if (formType === 'CLUB_SEARCH') body.club_id = Number(form.elements.club_id.value);
    for (const key of [
      'positions',
      'qualities',
      formType === 'PLAYER_SEARCH' ? 'project_types' : 'conditions'
    ])
      body[key] = values(form, key);
    for (const key of Object.keys(body)) if (body[key] === '') body[key] = null;
    await api(editing ? '/ads/' + editing.id : '/ads', editing ? 'PATCH' : 'POST', body);
    $('#ad-editor').close();
    notice('Annonce enregistrée.');
    await load();
  });
}
async function init() {
  catalog = await options();
  me = await identity(false);
  own = document.body.dataset.owned === 'true';
  if (own && !me) {
    await identity();
    return;
  }
  $('#module-content').hidden = false;
  notice('');
  $('#new-ad').hidden = !me || (!me.clubs.length && me.user.role !== 'PLAYER');

  const picker = $('#acting-club');
  if (me?.clubs.length) {
    me.clubs.forEach((c) => {
      const o = node('option', c.name);
      o.value = c.id;
      picker.append(o);
    });
    $('#acting-club-label').hidden = false;
  }
  const filters = $('#filters');
  for (const [name, title, group] of [
    ['sport', 'Sport', 'sports'],
    ['position', 'Poste', 'positions'],
    ['level', 'Niveau', 'divisions'],
    ['availability', 'Disponibilité', 'availability']
  ])
    filters.append(select(name, title, catalog[group]));
  filters.append(input('city', 'Ville', '', 'text', 100));
  $('#filter-form').onsubmit = (e) => {
    e.preventDefault();
    run($('#filter-submit'), () => load());
  };
  $('#more-ads').onclick = () => run($('#more-ads'), () => load(true));
  $('#ad-type').onchange = () => fields();
  form.onsubmit = save;
  document.querySelectorAll('[data-type]').forEach((tab) => {
    tab.onclick = () =>
      run(tab, async () => {
        mode = tab.dataset.type;
        document
          .querySelectorAll('[data-type]')
          .forEach((t) => t.setAttribute('aria-selected', String(t === tab)));
        await load();
      });
    tab.hidden = own;
  });
  document
    .querySelectorAll('[data-close]')
    .forEach((b) => (b.onclick = () => b.closest('dialog').close()));
  $('#apply-form').onsubmit = (e) => {
    e.preventDefault();
    run($('#apply-submit'), async () => {
      const result = await api('/ads/' + e.target.dataset.id + '/applications', 'POST', {
        message: $('#apply-message').value,
        share_profile: $('#apply-share').checked
      });
      location.href = 'messages.html?conversation=' + result.conversation_id;
    });
  };
  await load();
  const ad = new URLSearchParams(location.search).get('ad');
  if (ad) await detail(ad);
}
init().catch((error) => notice(error.message, true));
