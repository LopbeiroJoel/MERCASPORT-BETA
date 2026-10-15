const panel = document.getElementById('panel');
const message = document.getElementById('message');
let admin;
const protectedIds = new Set();
const confirmation = document.getElementById('confirmation');
let pendingAction;

const errors = {
  AUTH_REQUIRED: 'Session absente ou expirée. Connecte-toi avec le lien Connexion.',
  ADMIN_ACCESS_DENIED: 'Ce compte ne possède pas de droits ADMIN actifs.',
  ADMIN_ACCOUNT_PROTECTED: 'Un compte administrateur ne peut pas être banni ici.',
  USER_ALREADY_BANNED: 'Ce compte est déjà banni.',
  USER_NOT_FOUND: 'Compte introuvable.',
  INVALID_SEARCH: 'Recherche invalide : 100 caractères maximum.',
  ORIGIN_DENIED: 'Action refusée : vérifie l’adresse du site et APP_ORIGIN.',
  BAN_UNAVAILABLE: 'Bannissement échoué : aucune sanction n’a été enregistrée.',
  AD_NOT_FOUND: 'Annonce introuvable.',
  AD_ALREADY_DELETED: 'Annonce déjà supprimée.',
  DELETE_AD_UNAVAILABLE: 'Suppression échouée : aucune modification enregistrée.',
  CONFIRMATION_REQUIRED: 'La confirmation du bannissement est obligatoire.'
};

async function request(url, options = {}) {
  const response = await fetch(url, { ...options, credentials: 'same-origin' });
  const data = response.status === 204 ? null : await response.json();
  if (!response.ok) {
    if (response.status === 401) panel.hidden = true;
    throw new Error(errors[data?.code] || 'Demande refusée ou service indisponible.');
  }
  return data;
}

// textContent affiche les données sans les interpréter comme du HTML.
function cell(row, value) {
  const td = document.createElement('td');
  td.textContent = value == null || value === '' ? '—' : String(value);
  row.append(td);
  return td;
}

function showError(error) {
  message.textContent = error.message || 'Impossible de joindre le serveur.';
}

async function loadUsers() {
  const search = document.getElementById('users-search').value.trim();
  const data = await request('/admin/users?search=' + encodeURIComponent(search));
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
    action.replaceChildren(button);
    results.append(row);
  }
}

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
    button.disabled = ad.status === 'DELETED';
    button.addEventListener('click', () => deleteAd(ad, button));
    action.replaceChildren(button);
    results.append(row);
  }
}

function deleteAd(ad, button) {
  askConfirmation('Supprimer l’annonce ' + ad.id + ' : ' + ad.title + ' ?', () => runDelete(ad, button));
}

async function runDelete(ad, button) {
  button.disabled = true;
  try {
    await request('/admin/ads/' + ad.id + '/delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ confirm: true })
    });
    message.textContent = 'Annonce ' + ad.id + ' supprimée du site.';
    await loadAds();
  } catch (error) {
    button.disabled = false;
    showError(error);
  }
}

async function loadAdmins() {
  const data = await request('/admin/administrators');
  for (const account of data.administrators) protectedIds.add(account.id);
}

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
