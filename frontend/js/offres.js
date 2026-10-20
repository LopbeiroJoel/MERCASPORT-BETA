import {
  api,
  options,
  identity,
  node,
  link,
  button,
  profileView,
  label
} from './recruitment-ui.mjs';

const list = document.getElementById('offers-list');
const count = document.getElementById('offers-count');
const form = document.getElementById('filters');
const detail = document.getElementById('ads-detail');
const content = document.getElementById('ads-content');
const applyForm = document.getElementById('apply-form');
const status = document.getElementById('apply-message');
const search = new URLSearchParams(location.search);
const fields = {
  keywords: document.getElementById('filter-search'),
  location: document.getElementById('filter-location-search'),
  company: document.getElementById('filter-company')
};
let me,
  catalog,
  ads = [],
  cursor,
  current,
  pending = false;
const normalized = (value) =>
  String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
const checked = (name) =>
  [...form.querySelectorAll(`input[name="${name}"]:checked`)].map((box) => box.value);
const isClub = () => me?.user.role === 'CLUB';

function line(title, value) {
  if (!value || (Array.isArray(value) && !value.length)) return;
  const row = node('p', null, 'offer-detail-field');
  row.append(
    node('strong', title),
    document.createTextNode(Array.isArray(value) ? value.join(', ') : value)
  );
  content.append(row);
}
function prepare(ad) {
  return {
    ...ad,
    club: ad.author_name,
    location: ad.city || ad.location,
    division: ad.division_code,
    position_labels: ad.positions.map((code) => label('positions', code)),
    short_description: ad.short_description || ad.description?.slice(0, 220)
  };
}
function render() {
  const selected = {
    position: checked('position'),
    division: checked('division'),
    city: checked('location')
  };
  const words = normalized(fields.keywords.value).split(/\s+/).filter(Boolean);
  const visible = ads.filter(
    (ad) =>
      words.every((word) =>
        normalized([ad.title, ad.club, ...ad.position_labels].join(' ')).includes(word)
      ) &&
      normalized(ad.location).includes(normalized(fields.location.value)) &&
      normalized(ad.club).includes(normalized(fields.company.value)) &&
      (!selected.position.length ||
        ad.position_labels.some((p) => selected.position.includes(p))) &&
      (!selected.division.length || selected.division.includes(ad.division)) &&
      (!selected.city.length || selected.city.includes(ad.location))
  );
  list.replaceChildren();
  count.textContent = visible.length + (visible.length === 1 ? ' annonce' : ' annonces');
  if (!visible.length)
    list.append(
      node(
        'li',
        isClub()
          ? 'Aucune annonce de joueur ne correspond à votre recherche.'
          : 'Aucune annonce de club ne correspond à votre recherche.',
        'offers-empty'
      )
    );
  for (const ad of visible) {
    const card = node('li', null, 'job-card'),
      badges = node('div', null, 'job-card-badges');
    [...ad.position_labels, ad.division]
      .filter(Boolean)
      .forEach((v) => badges.append(node('span', v)));
    card.append(
      badges,
      node('p', ad.club, 'job-card-club'),
      node('h3', ad.title),
      node('p', ad.location || 'Localisation non précisée', 'job-card-location'),
      node('p', ad.short_description || '', 'job-card-summary'),
      button('Voir les détails', () => open(ad.id))
    );
    list.append(card);
  }
}
function boxes() {
  for (const [id, key, parameter, values] of [
    ['filter-position', 'position', 'position', catalog.positions.map((p) => p.label)],
    ['filter-division', 'division', 'division', catalog.divisions.map((d) => d.code)],
    [
      'filter-location',
      'location',
      'city',
      [...new Set(ads.map((a) => a.location).filter(Boolean))].sort()
    ]
  ]) {
    const target = document.getElementById(id);
    const selected = target.querySelector('input') ? checked(key) : search.getAll(parameter);
    target.querySelectorAll('label').forEach((n) => n.remove());
    for (const value of values) {
      const row = node('label'),
        check = node('input');
      check.type = 'checkbox';
      check.name = key;
      check.value = value;
      check.checked = selected.includes(value);
      row.append(check, document.createTextNode(' ' + value));
      target.append(row);
    }
  }
}
async function load(more = false) {
  const data = await api('/ads?view=offers' + (more && cursor ? '&before=' + cursor : ''));
  ads = more ? [...ads, ...data.items.map(prepare)] : data.items.map(prepare);
  cursor = data.next;
  document.getElementById('offers-more').hidden = !cursor;
  boxes();
  render();
  list.setAttribute('aria-busy', 'false');
}
async function contact() {
  const body = { announcement_id: current.id };
  if (isClub()) body.as_club_id = Number(document.getElementById('contact-as-club').value);
  const result = await api('/conversations', 'POST', body);
  location.href = 'messages.html?conversation=' + result.id;
}
async function open(id) {
  current = prepare(await api('/ads/' + id + '?view=offers'));
  content.replaceChildren();
  const title = node('h2', current.title);
  title.id = 'offer-detail-title';
  content.append(title);
  line(isClub() ? 'Joueur' : 'Club', current.club);
  line('Ville', current.location);
  line('Postes', current.position_labels);
  line('Division', current.division);
  line(
    'Disponibilité',
    current.availability_code ? label('availability', current.availability_code) : null
  );
  line('Contrat', current.contract);
  line('Rythme', current.work_time);
  line('Rémunération', current.salary);
  line('Profil recherché', current.requirements);
  line('Missions', current.missions);
  line('Informations complémentaires', current.additional_info);
  line('Description', current.description);
  line(
    'Qualités',
    current.qualities.map((q) => label('qualities', q))
  );
  applyForm.reset();
  status.textContent = '';
  const actions = document.getElementById('offer-actions');
  actions.replaceChildren();
  document.getElementById('apply-title').textContent = isClub()
    ? 'Échangez avec ce joueur.'
    : 'Rejoignez l’équipe.';
  document.getElementById('apply-intro').textContent = isClub()
    ? 'Prenez contact avec le joueur pour présenter votre club.'
    : 'Présentez-vous au club et partagez votre envie de jouer.';
  applyForm.hidden = isClub();
  if (me) {
    actions.append(
      button(isClub() ? 'Voir le CV sportif' : 'Voir le profil du club', async () => {
        const data = await api(
          isClub()
            ? '/profiles/' + current.author_id
            : '/clubs/' + current.club_id + '/public-profile'
        );
        const box = document.getElementById('offer-profile-content');
        box.replaceChildren(profileView(data));
        document.getElementById('offer-profile-dialog').showModal();
      })
    );
    if (isClub()) {
      const choice = node('label', 'Au nom de votre club'),
        select = node('select');
      select.id = 'contact-as-club';
      me.clubs.forEach((club) => {
        const option = node('option', club.name);
        option.value = club.id;
        select.append(option);
      });
      choice.append(select);
      actions.append(choice);
    }
    actions.append(button(isClub() ? 'Contacter le joueur' : 'Contacter le club', contact));
  } else actions.append(link('Se connecter pour échanger', 'login.html'));
  detail.showModal();
}
function remember() {
  const url = new URL(location.href);
  for (const [key, control] of Object.entries(fields)) {
    const value = control.value.trim();
    if (value) url.searchParams.set(key, value);
    else url.searchParams.delete(key);
  }
  for (const [field, param] of [
    ['position', 'position'],
    ['division', 'division'],
    ['location', 'city']
  ]) {
    url.searchParams.delete(param);
    checked(field).forEach((value) => url.searchParams.append(param, value));
  }
  history.replaceState(null, '', url);
}
async function submit(event) {
  event.preventDefault();
  if (pending || !current) return;
  pending = true;
  const submit = document.getElementById('apply-submit');
  submit.disabled = true;
  status.textContent = 'Envoi en cours…';
  try {
    if (me) {
      const result = await api('/ads/' + current.id + '/applications', 'POST', {
        message: document.getElementById('apply-text').value,
        share_profile: document.getElementById('apply-share-cv').checked
      });
      location.href = 'messages.html?conversation=' + result.conversation_id;
    } else {
      await api('/applications', 'POST', {
        ad_id: current.id,
        name: document.getElementById('apply-name').value.trim(),
        email: document.getElementById('apply-email').value.trim(),
        phone: document.getElementById('apply-phone').value.trim() || null,
        message: document.getElementById('apply-text').value.trim() || null
      });
      status.textContent = 'Candidature envoyée !';
      applyForm.reset();
    }
  } catch (error) {
    status.textContent = error.message;
  } finally {
    pending = false;
    submit.disabled = false;
  }
}
async function init() {
  [catalog, me] = await Promise.all([options(), identity(false)]);
  for (const [name, control] of Object.entries(fields)) control.value = search.get(name) || '';
  if (isClub()) {
    document.querySelector('.offers-intro h1').textContent = 'Trouvez vos prochains joueurs.';
    document.querySelector('.offers-intro p').textContent =
      'Découvrez les joueurs à la recherche d’un club.';
    document.querySelector('label[for="filter-company"]').textContent = 'Joueur';
    fields.company.placeholder = 'Pseudo du joueur';
    document.getElementById('results-title').textContent = 'Joueurs disponibles';
  } else document.getElementById('results-title').textContent = 'Clubs qui recrutent';
  if (me && !isClub()) {
    for (const id of ['apply-name', 'apply-email', 'apply-phone']) {
      const control = document.getElementById(id);
      control.hidden = true;
      control.required = false;
      document.querySelector(`label[for="${id}"]`).hidden = true;
    }
    document.getElementById('apply-share-label').hidden = false;
  }
  document.getElementById('x-detail').onclick = () => detail.close();
  detail.onclick = (e) => {
    if (e.target === detail) detail.close();
  };
  document.getElementById('offer-profile-close').onclick = () =>
    document.getElementById('offer-profile-dialog').close();
  form.addEventListener('input', () => {
    render();
    remember();
  });
  form.onsubmit = (e) => {
    e.preventDefault();
    render();
    remember();
  };
  form.onreset = () =>
    setTimeout(() => {
      render();
      remember();
    });
  applyForm.onsubmit = submit;
  document.getElementById('offers-more').onclick = () =>
    load(true).catch((e) => (count.textContent = e.message));
  await load();
  const id = search.get('ad');
  if (id) await open(id);
}
init().catch((error) => {
  count.textContent = error.message;
  list.setAttribute('aria-busy', 'false');
});
