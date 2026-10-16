// REPERE ORAL - LES BOUTONS DU PANEL APPELLENT LES ROUTES /admin.
// Afficher/cacher un bouton aide l'utilisateur ; les vraies permissions restent dans le backend.
// request gere le JSON et les erreurs ; une reponse 204 n'a pas de corps a decoder.
// La confirmation demande si on veut vraiment agir avant le DELETE definitif.

const panel = document.getElementById('panel');
const message = document.getElementById('message');
let admin;
let selectedRole = 'PLAYER';
const protectedIds = new Set();
const confirmation = document.getElementById('confirmation');
let pendingAction;

const errors = {
  AUTH_REQUIRED: 'Session absente ou expirée. Connecte-toi avec le lien Connexion.',
  ADMIN_ACCESS_DENIED: 'Ce compte ne possède pas de droits ADMIN actifs.',
  ADMIN_ACCOUNT_PROTECTED: 'Un compte administrateur ne peut pas être banni ou supprimé ici.',
  USER_ALREADY_BANNED: 'Ce compte est déjà banni.',
  USER_NOT_FOUND: 'Compte introuvable.',
  INVALID_SEARCH: 'Recherche invalide : 100 caractères maximum.',
  ORIGIN_DENIED: 'Action refusée : vérifie l’adresse du site et APP_ORIGIN.',
  BAN_UNAVAILABLE: 'Bannissement échoué : aucune sanction n’a été enregistrée.',
  AD_NOT_FOUND: 'Annonce introuvable.',
  AD_ALREADY_DELETED: 'Annonce déjà supprimée.',
  DELETE_AD_UNAVAILABLE: 'Suppression échouée : aucune modification enregistrée.',
  ACCOUNT_CONFLICT: 'Ce pseudo ou cet e-mail est déjà utilisé.',
  USER_UPDATE_UNAVAILABLE: 'Modification du compte indisponible.',
  ADMIN_UNAVAILABLE: 'Modification indisponible. Réessaie plus tard.',
  INVALID_TEXT: 'Le titre doit contenir entre 1 et 150 caractères.',
  CONFIRMATION_REQUIRED: 'La confirmation du bannissement est obligatoire.'
};

// fetch ne rejette pas automatiquement une reponse 400/404 : je regarde response.ok.
async function request(url, options = {}) {
  const response = await fetch(url, { ...options, credentials: 'same-origin' });
  const data = response.status === 204 ? null : await response.json();
  if (!response.ok) {
    if (response.status === 401) panel.hidden = true;
    throw new Error(Object.values(data?.fields || {}).join(' ') || data?.message || errors[data?.code] || 'Demande refusée ou service indisponible.');
  }
  return data;
}

// textContent affiche les données sans les interpréter comme du HTML.
// Une cellule affiche du texte avec textContent. Je ne colle pas le pseudo/email dans innerHTML.
function cell(row, value) {
  const td = document.createElement('td');
  td.textContent = value == null || value === '' ? '—' : String(value);
  row.append(td);
  return td;
}

function showError(error) {
  message.textContent = error.message || 'Impossible de joindre le serveur.';
}

// Le role de l'onglet part au serveur comme filtre, avant la limite de resultats.
async function loadUsers() {
  const search = document.getElementById('users-search').value.trim();
  const role = selectedRole;
  const data = await request('/admin/users?search=' + encodeURIComponent(search) + '&role=' + role);
  if (role !== selectedRole || search !== document.getElementById('users-search').value.trim()) return;
  const results = document.getElementById('users-results');
  results.replaceChildren();
  document.getElementById('users-count').textContent = data.users.length + ' résultat(s).';

  for (const user of data.users) {
    const row = document.createElement('tr');
    for (const value of [user.id, user.username, user.email, user.role, user.status, user.club_name]) {
      cell(row, value);
    }
    const action = cell(row, '');
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = 'Bannir';
    button.disabled = user.status === 'BANNED' || protectedIds.has(user.id) || user.id === admin.userId;
    button.addEventListener('click', () => banUser(user, button));
    const editButton = document.createElement('button');
    editButton.type = 'button';
    editButton.textContent = 'Modifier le compte';
    editButton.addEventListener('click', () => editUser(user));
    const removeButton = document.createElement('button');
    removeButton.type = 'button';
    removeButton.textContent = 'Supprimer définitivement';
    removeButton.disabled = protectedIds.has(user.id) || user.id === admin.userId;
    removeButton.addEventListener('click', () => {
      askConfirmation('Supprimer définitivement ' + user.username + ', ses profils, annonces et candidatures liées ?', async () => {
        removeButton.disabled = true;
        try {
          await request('/admin/users/' + user.id, { method: 'DELETE' });
          document.getElementById('user-editor').hidden = true;
          document.getElementById('ad-editor').hidden = true;
          message.textContent = 'Compte ' + user.id + ' supprimé définitivement.';
          await loadUsers();
          await loadAds();
        } catch (error) {
          removeButton.disabled = false;
          showError(error);
        }
      });
    });
    action.replaceChildren(editButton, button, removeButton);
    results.append(row);
  }
}

// Je memorise l'action, mais je ne l'execute qu'apres le bouton de confirmation.
function askConfirmation(text, action) {
  document.getElementById('confirmation-message').textContent = text;
  pendingAction = action;
  confirmation.hidden = false;
}

document.getElementById('cancel-action').addEventListener('click', () => {
  pendingAction = null;
  confirmation.hidden = true;
  message.textContent = 'Action annulée : aucune modification.';
});

document.getElementById('confirm-action').addEventListener('click', async () => {
  if (!pendingAction) return;
  const action = pendingAction;
  pendingAction = null;
  confirmation.hidden = true;
  await action();
});

function banUser(user, button) {
  askConfirmation('Bannir ' + user.username + ' (compte ' + user.id + ') ?', () => runBan(user, button));
}

async function runBan(user, button) {
  button.disabled = true;
  try {
    await request('/admin/users/' + user.id + '/ban', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ confirm: true })
    });
    message.textContent = 'Compte ' + user.id + ' banni. Ses sessions ont été révoquées.';
    await loadUsers();
  } catch (error) {
    button.disabled = false;
    showError(error);
  }
}

// Je charge la liste admin et je branche les boutons Modifier/Supprimer de chaque annonce.
async function loadAds() {
  const search = document.getElementById('ads-search').value.trim();
  const data = await request('/admin/ads?search=' + encodeURIComponent(search));
  const results = document.getElementById('ads-results');
  results.replaceChildren();
  document.getElementById('ads-count').textContent = data.ads.length + ' résultat(s).';
  for (const ad of data.ads) {
    const row = document.createElement('tr');
    const date = new Date(ad.created_at).toLocaleString('fr-FR');
    for (const value of [ad.id, ad.title, ad.author_name, ad.author_role, ad.club_name, ad.status, date]) {
      cell(row, value);
    }
    const action = cell(row, '');
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = 'Supprimer';
    button.addEventListener('click', () => deleteAd(ad, button));
    const editButton = document.createElement('button');
    editButton.type = 'button';
    editButton.textContent = 'Modifier l’annonce';
    editButton.addEventListener('click', () => editAd(ad));
    action.replaceChildren(editButton, button);
    results.append(row);
  }
}

function deleteAd(ad, button) {
  askConfirmation('Supprimer définitivement l’annonce et ses candidatures : ' + ad.id + ' : ' + ad.title + ' ?', () => runDelete(ad, button));
}

// Le bouton envoie DELETE /admin/ads/:id ; le SQL retire vraiment la ligne.
async function runDelete(ad, button) {
  button.disabled = true;
  try {
    await request('/admin/ads/' + ad.id, { method: 'DELETE' });
    document.getElementById('ad-editor').hidden = true;
    message.textContent = 'Annonce ' + ad.id + ' supprimée définitivement.';
    await loadAds();
  } catch (error) {
    button.disabled = false;
    showError(error);
  }
}

// Formulaires simples : chaque rubrique possède son bouton Enregistrer.
let editingUser = null;
let editingAd = null;
let choices = null;
const commonTexts = ['photo_url', 'phone', 'location', 'biography'];
const visibilityFields = ['email_visible', 'phone_visible', 'location_visible'];
const playerTexts = ['first_name', 'last_name', 'birth_date', 'preferred_foot',
  'height_cm', 'current_club', 'past_clubs', 'experience', 'level'];
const clubTexts = ['name', 'city', 'divisions', 'description', 'general_info'];
const adFields = ['title', 'city', 'department', 'division_code', 'description',
  'preferred_foot', 'salary', 'age_range', 'experience_level', 'trial_possible', 'additional_info'];

function value(id) {
  return document.getElementById(id).value;
}

async function loadChoices() {
  if (!choices) {
    const [positions, divisions] = await Promise.all([
      request('/admin/positions?limit=100'), request('/admin/divisions?limit=100')
    ]);
    choices = { positions: positions.positions, divisions: divisions.divisions };
  }
  return choices;
}

function fillPositions(containerId, selected) {
  const container = document.getElementById(containerId);
  container.replaceChildren();
  for (const position of choices.positions) {
    const label = document.createElement('label');
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.value = position.code;
    input.checked = selected.includes(position.code);
    label.append(input, document.createTextNode(' ' + position.label));
    container.append(label, document.createElement('br'));
  }
}

function selectedPositions(containerId) {
  return Array.from(document.getElementById(containerId).querySelectorAll('input:checked'), input => input.value);
}

async function editUser(user) {
  editingUser = { id: user.id };
  document.getElementById('user-editor').hidden = true;
  try {
    const [account, details] = await Promise.all([
      request('/admin/users/' + user.id), request('/admin/users/' + user.id + '/profile'), loadChoices()
    ]);
    if (editingUser?.id !== user.id) return;
    const profile = details.profile || {};
    editingUser = { ...account.user, role: account.user.role.toUpperCase(), profileExists: !!details.profile };
    document.getElementById('user-editor-title').textContent = 'Modifier le compte ' + user.id + ' — ' + account.user.username;
    document.getElementById('edit-username').value = account.user.username;
    document.getElementById('edit-email').value = account.user.email;
    document.getElementById('edit-status').value = account.user.status;
    document.getElementById('edit-is_verified').checked = account.user.is_verified === true;
    document.getElementById('edit-password').value = '';
    for (const field of commonTexts) document.getElementById('edit-' + field).value = details.user[field] ?? '';
    for (const field of visibilityFields) document.getElementById('edit-' + field).checked = details.user[field] === true;
    for (const field of [...playerTexts, ...clubTexts]) {
      document.getElementById('edit-' + field).value = field === 'birth_date'
        ? String(profile[field] || '').slice(0, 10) : profile[field] ?? '';
    }
    fillPositions('edit-player-positions', profile.positions || []);
    const isPlayer = editingUser.role === 'PLAYER';
    document.getElementById('player-fields').hidden = !isPlayer;
    document.getElementById('player-fields').disabled = !isPlayer;
    document.getElementById('club-fields').hidden = isPlayer;
    document.getElementById('club-fields').disabled = isPlayer;
    document.getElementById('status-fields').disabled = protectedIds.has(user.id) || user.id === admin.userId;
    document.getElementById('user-editor').hidden = false;
    document.getElementById('user-editor').scrollIntoView({ block: 'start' });
  } catch (error) { if (editingUser?.id === user.id) showError(error); }
}

document.getElementById('close-user-editor').addEventListener('click', () => {
  editingUser = null;
  document.getElementById('edit-password').value = '';
  document.getElementById('user-editor').hidden = true;
});

function onSave(formId, action) {
  document.getElementById(formId).addEventListener('submit', async event => {
    event.preventDefault();
    const button = event.submitter || event.currentTarget.querySelector('button[type="submit"]');
    button.disabled = true;
    try { await action(); }
    catch (error) { showError(error); }
    finally { button.disabled = false; }
  });
}

function send(url, method, body) {
  return request(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
}

onSave('account-form', async () => {
  if (!editingUser) return;
  const userId = editingUser.id;
  const previousEmail = editingUser.email;
  const data = await send('/admin/users/' + userId, 'PATCH', {
    username: value('edit-username'), email: value('edit-email')
  });
  if (userId === admin.userId && data.user.email !== previousEmail) {
    window.location.replace('login.html');
    return;
  }
  if (editingUser?.id === userId) {
    editingUser.email = data.user.email;
    editingUser.username = data.user.username;
    document.getElementById('edit-username').value = data.user.username;
    document.getElementById('edit-email').value = data.user.email;
    document.getElementById('user-editor-title').textContent = 'Modifier le compte ' + userId + ' — ' + data.user.username;
    document.getElementById('edit-is_verified').checked = data.user.is_verified === true;
  }
  await loadUsers();
  message.textContent = 'Pseudo et e-mail enregistrés.';
});

onSave('user-profile-form', async () => {
  if (!editingUser) return;
  const userId = editingUser.id;
  const body = {};
  for (const field of commonTexts) body[field] = value('edit-' + field).trim() || null;
  for (const field of visibilityFields) body[field] = document.getElementById('edit-' + field).checked;
  const fields = editingUser.role === 'PLAYER' ? playerTexts : clubTexts;
  for (const field of fields) body[field] = value('edit-' + field).trim() || null;
  if (editingUser.role === 'PLAYER') {
    body.positions = selectedPositions('edit-player-positions');
    body.height_cm = value('edit-height_cm') === '' ? null : Number(value('edit-height_cm'));
  }
  await send('/admin/users/' + userId + '/profile', editingUser.profileExists ? 'PATCH' : 'POST', body);
  if (editingUser?.id === userId) editingUser.profileExists = true;
  await loadUsers();
  message.textContent = 'Coordonnées et fiche enregistrées.';
});

onSave('status-form', async () => {
  if (!editingUser) return;
  const userId = editingUser.id;
  await send('/admin/users/' + userId + '/status', 'PATCH', { status: value('edit-status') });
  await loadUsers();
  message.textContent = 'Statut enregistré.';
});

onSave('verification-form', async () => {
  if (!editingUser) return;
  await send('/admin/users/' + editingUser.id + '/verification', 'PATCH', {
    is_verified: document.getElementById('edit-is_verified').checked
  });
  message.textContent = 'Vérification de l’adresse enregistrée.';
});

onSave('password-form', async () => {
  if (!editingUser) return;
  const userId = editingUser.id;
  await send('/admin/users/' + userId + '/password', 'PUT', { password: value('edit-password') });
  document.getElementById('edit-password').value = '';
  message.textContent = 'Mot de passe remplacé. Le compte doit se reconnecter.';
  if (userId === admin.userId) window.location.replace('login.html');
});

async function editAd(ad) {
  editingAd = { id: ad.id };
  document.getElementById('ad-editor').hidden = true;
  try {
    const [detail] = await Promise.all([request('/admin/ads/' + ad.id), loadChoices()]);
    if (editingAd?.id !== ad.id) return;
    editingAd = detail.ad;
    const divisions = document.getElementById('ad-division_code');
    divisions.replaceChildren();
    for (const code of ['', ...choices.divisions.map(item => item.code)]) {
      const option = document.createElement('option');
      option.value = code;
      option.textContent = code || 'Non renseignée';
      divisions.append(option);
    }
    for (const field of adFields) {
      const data = field === 'division_code' ? detail.ad.division : detail.ad[field];
      document.getElementById('ad-' + field).value = data == null ? '' : String(data);
    }
    fillPositions('edit-ad-positions', detail.ad.positions || []);
    document.getElementById('ad-editor-title').textContent = 'Modifier l’annonce ' + ad.id;
    document.getElementById('ad-editor').hidden = false;
    document.getElementById('ad-editor').scrollIntoView({ block: 'start' });
  } catch (error) { if (editingAd?.id === ad.id) showError(error); }
}

document.getElementById('close-ad-editor').addEventListener('click', () => {
  editingAd = null;
  document.getElementById('ad-editor').hidden = true;
});

onSave('ad-form', async () => {
  if (!editingAd) return;
  const adId = editingAd.id;
  const body = {};
  for (const field of adFields) body[field] = value('ad-' + field).trim() || null;
  // Les anciennes annonces peuvent ne pas avoir ces trois informations.
  for (const field of ['city', 'department', 'division_code']) if (body[field] == null) delete body[field];
  body.positions = selectedPositions('edit-ad-positions');
  if (!body.positions.length) throw new Error('Choisis au moins un poste.');
  body.trial_possible = value('ad-trial_possible') === '' ? null : value('ad-trial_possible') === 'true';
  await send('/admin/ads/' + adId, 'PATCH', body);
  await loadAds();
  message.textContent = 'Annonce enregistrée.';
});


async function loadAdmins() {
  const data = await request('/admin/administrators');
  for (const account of data.administrators) protectedIds.add(account.id);
}

async function selectUserTab(role) {
  selectedRole = role;
  editingUser = null;
  document.getElementById('user-editor').hidden = true;
  document.getElementById('edit-password').value = '';
  document.getElementById('users-results').replaceChildren();
  document.getElementById('users-count').textContent = 'Chargement…';
  document.getElementById('users-title').textContent = role === 'PLAYER' ? 'Comptes joueurs' : 'Comptes clubs';
  for (const [id, type] of [['players-tab', 'PLAYER'], ['clubs-tab', 'CLUB']]) {
    const button = document.getElementById(id);
    button.setAttribute('aria-selected', String(role === type));
    button.tabIndex = role === type ? 0 : -1;
  }
  document.getElementById('users-tab-panel').setAttribute('aria-labelledby', role === 'PLAYER' ? 'players-tab' : 'clubs-tab');
  try { await loadUsers(); }
  catch (error) { showError(error); }
}
for (const [id, role] of [['players-tab', 'PLAYER'], ['clubs-tab', 'CLUB']]) {
  document.getElementById(id).addEventListener('click', () => selectUserTab(role));
  document.getElementById(id).addEventListener('keydown', event => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const target = event.key === 'Home' ? 'players-tab' : event.key === 'End' ? 'clubs-tab'
      : role === 'PLAYER' ? 'clubs-tab' : 'players-tab';
    document.getElementById(target).focus();
    document.getElementById(target).click();
  });
}
document.getElementById('clubs-tab').tabIndex = -1;

document.getElementById('users-search-form').addEventListener('submit', async event => {
  event.preventDefault();
  try { await loadUsers(); message.textContent = 'Recherche utilisateurs terminée.'; }
  catch (error) { showError(error); }
});

document.getElementById('ads-search-form').addEventListener('submit', async event => {
  event.preventDefault();
  try { await loadAds(); message.textContent = 'Recherche annonces terminée.'; }
  catch (error) { showError(error); }
});

document.getElementById('logout').addEventListener('click', async () => {
  try {
    await request('/auth/logout', { method: 'POST' });
    window.location.replace('login.html');
  } catch (error) { showError(error); }
});

async function start() {
  try {
    const identity = await request('/admin/me');
    admin = identity.admin;
    document.getElementById('identity').textContent = 'Connecté : compte ' + admin.userId + ' — ' + admin.role;
    await loadAdmins();
    await loadUsers();
    await loadAds();
    panel.hidden = false;
    message.textContent = 'Accès ADMIN confirmé.';
  } catch (error) { showError(error); }
}

start();
