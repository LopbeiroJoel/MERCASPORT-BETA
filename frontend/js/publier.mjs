const form = document.getElementById('publish-form');
const content = document.getElementById('publish-content');
const status = document.getElementById('publish-status');
const button = document.getElementById('publish-button');
const fields = document.getElementById('publish-fields');
let pending = false;
let published = false;
let playerAccount = false;

function showError(field, message) {
  const error = document.getElementById('error-' + field);
  if (error) error.textContent = message;
  const control = document.getElementById(field === 'positions' ? 'positions-fieldset' : field);
  if (control) control.setAttribute('aria-invalid', 'true');
}

function clearErrors() {
  for (const error of form.querySelectorAll('.publish-error')) error.textContent = '';
  for (const control of form.querySelectorAll('[aria-invalid]'))
    control.removeAttribute('aria-invalid');
}

function addOptions(id, values) {
  const select = document.getElementById(id);
  for (const item of values) select.add(new Option(item.label || item.code, item.code));
}

async function loadForm() {
  button.disabled = true;
  try {
    const account = await fetch('/auth/me', { credentials: 'same-origin', cache: 'no-store' });
    if (account.status === 401) {
      status.textContent = 'Connectez-vous pour publier une annonce.';
      document.getElementById('publish-login').hidden = false;
      return;
    }
    if (!account.ok) throw new Error('La connexion est indisponible. Réessayez plus tard.');
    const { user } = await account.json();
    playerAccount = user?.role === 'PLAYER';
    if (!playerAccount && user?.role !== 'CLUB') {
      status.textContent = 'La publication est réservée aux joueurs et aux clubs.';
      return;
    }
    const response = await fetch('/ads/options', { cache: 'no-store' });
    if (!response.ok)
      throw new Error('Impossible de charger les postes et les divisions. Réessayez plus tard.');
    const options = await response.json();
    if (!options.positions?.length || !options.divisions?.length)
      throw new Error('Le catalogue des postes ou divisions est vide.');
    const list = document.getElementById('positions-list');
    for (const position of options.positions) {
      const label = document.createElement('label');
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.name = 'positions';
      checkbox.value = position.code;
      label.append(checkbox, document.createTextNode(position.label));
      list.append(label);
    }
    addOptions('division_code', options.divisions);
    addOptions(
      'preferred_foot',
      options.preferred_feet
        .filter((foot) => foot !== 'Indifférent')
        .map((foot) => ({ code: foot, label: foot }))
    );
    addOptions('age_range', options.age_ranges);
    addOptions('experience_level', options.experience_levels);
    if (playerAccount) {
      document.querySelector('.publish-eyebrow').textContent = 'ESPACE JOUEUR · RECHERCHE DE CLUB';
      document.querySelector('.publish-intro h1').textContent = 'Votre prochain club commence ici.';
      document.querySelector('.publish-intro > p:last-child').textContent =
        'Présentez votre parcours et le club que vous recherchez.';
      document.getElementById('player-title').textContent = 'Votre place sur le terrain';
      document.querySelector('#positions-fieldset legend').textContent = 'Vos postes';
      document.getElementById('positions-help').textContent =
        'Deux postes maximum. Vous pouvez aussi ne rien sélectionner.';
      document.getElementById('project-title').textContent = 'Votre recherche de club';
      document.querySelector('label[for="description"]').textContent =
        'Votre annonce (facultative)';
      document.getElementById('description').placeholder =
        'Votre parcours, vos disponibilités, le projet qui vous intéresse…';
      document.getElementById('description-help').textContent = 'Les détails sont facultatifs.';
      for (const control of form.querySelectorAll('[required]')) control.required = false;
      for (const id of ['department', 'preferred_foot', 'salary'])
        document.getElementById(id).closest('.publish-field').hidden = true;
      form.querySelector('.publish-extra').hidden = true;
      document.querySelector('.publish-section-title p').textContent =
        'Dans quelle ville souhaitez-vous jouer ?';
      document.querySelector('#player-title + p').textContent =
        'Votre poste et le niveau que vous recherchez.';
      document.querySelector('label[for="division_code"]').textContent =
        'Niveau recherché (facultatif)';
      document.querySelector('label[for="city"]').textContent = 'Ville (facultative)';
      document.querySelector('#project-title + p').textContent =
        'Indiquez ce que vous recherchez pour votre prochaine saison.';
    }
    content.hidden = false;
    button.disabled = false;
    status.textContent = '';
  } catch (error) {
    status.textContent = error.message || 'Le formulaire est indisponible.';
  }
}

document.getElementById('description').addEventListener('input', (event) => {
  document.getElementById('description-count').textContent =
    event.target.value.length.toLocaleString('fr-FR') + ' / 5 000';
});

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (pending || published) return;
  clearErrors();
  status.textContent = '';
  const input = new FormData(form);
  const body = {};
  for (const field of ['city', 'department', 'division_code', 'description'])
    body[field] = input.get(field)?.trim() || '';
  body.positions = input.getAll('positions');
  for (const field of [
    'preferred_foot',
    'salary',
    'age_range',
    'experience_level',
    'additional_info'
  ])
    body[field] = input.get(field)?.trim() || null;
  const trial = input.get('trial_possible');
  body.trial_possible = trial === '' ? null : trial === 'true';

  let invalid = false;
  for (const field of ['city', 'department', 'division_code', 'description']) {
    if (!body[field]) {
      showError(field, 'Ce champ est obligatoire.');
      invalid = true;
    }
  }
  if (!body.positions.length) {
    showError('positions', 'Choisissez au moins un poste.');
    invalid = true;
  }
  if (!form.checkValidity()) {
    form.reportValidity();
    invalid = true;
  }
  if (playerAccount) {
    invalid = false;
    clearErrors();
    if (body.positions.length > 2) {
      showError('positions', 'Choisissez au maximum deux postes.');
      invalid = true;
    }
    if (!form.checkValidity()) {
      form.reportValidity();
      invalid = true;
    }
    const selected = body.positions;
    const playerBody = {
      announcement_type: 'PLAYER_SEARCH',
      status: 'PUBLISHED',
      positions: selected,
      city: body.city || null,
      division_code: body.division_code || null,
      description: body.description || null
    };
    for (const key of Object.keys(body)) delete body[key];
    Object.assign(body, playerBody);
  }
  if (invalid) {
    status.textContent = 'Vérifiez les champs indiqués avant de publier.';
    form.querySelector('[aria-invalid] input, [aria-invalid]:not(fieldset)')?.focus();
    return;
  }

  pending = true;
  fields.disabled = true;
  button.textContent = 'Publication en cours…';
  status.textContent = 'Publication en cours…';
  try {
    const response = await fetch('/ads', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const result = await response.json();
    if (!response.ok) {
      for (const [field, message] of Object.entries(result.fields || {})) showError(field, message);
      const messages = {
        AUTH_REQUIRED: 'Votre session a expiré. Reconnectez-vous pour publier.',
        ACTIVE_ACCOUNT_REQUIRED: 'Votre compte doit être activé avant de publier.',
        CLUB_REQUIRED: 'Seul un compte club peut publier une offre.',
        CLUB_ACCESS_DENIED: 'Votre compte n’est pas associé à un club actif.',
        ORIGIN_DENIED: 'Ouvrez cette page depuis l’adresse habituelle du site.',
        VALIDATION_ERROR: 'Vérifiez les champs indiqués.',
        BODY_TOO_LARGE: 'Votre offre est trop longue. Réduisez le texte.'
      };
      if (response.status === 401) document.getElementById('publish-login').hidden = false;
      throw new Error(messages[result.code] || result.message || 'La publication a été refusée.');
    }
    published = true;
    document.getElementById('success-title').textContent = 'Votre annonce est publiée.';
    content.hidden = true;
    const success = document.getElementById('publish-success');
    document.getElementById('publish-success-text').textContent =
      `« ${result.title} » est publiée et visible par les ${playerAccount ? 'clubs' : 'joueurs'}.`;
    success.hidden = false;
    success.focus();
    status.textContent = '';
  } catch (error) {
    status.textContent =
      error instanceof TypeError
        ? 'Connexion interrompue. Consultez les offres avant de réessayer pour éviter un doublon.'
        : error.message || 'Publication indisponible.';
  } finally {
    pending = false;
    fields.disabled = published;
    button.textContent = 'Publier mon annonce ↗';
  }
});

document.getElementById('publish-another').addEventListener('click', () => {
  published = false;
  fields.disabled = false;
  form.reset();
  clearErrors();
  document.getElementById('description-count').textContent = '0 / 5 000';
  document.getElementById('publish-success').hidden = true;
  content.hidden = false;
  document.getElementById('city').focus();
});

loadForm();
