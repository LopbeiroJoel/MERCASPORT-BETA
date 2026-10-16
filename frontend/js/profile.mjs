const message = document.getElementById('profile-message');
const content = document.getElementById('profile-content');
const form = document.getElementById('profile-form');
const playerForm = document.getElementById('player-form');
const editButton = document.getElementById('edit-player-button');
const logoutButton = document.getElementById('logout-button');
const positionNames = new Map();
let saved;
let saving = false;

function fillAccount(user) {
  document.getElementById('profile-name').textContent = user.username;
  document.getElementById('profile-id').textContent = user.id;
  document.getElementById('profile-email').textContent = user.email;
  for (const field of ['username', 'photo_url', 'biography', 'phone', 'location']) document.getElementById(field).value = user[field] || '';
  for (const field of ['email', 'phone', 'location']) document.getElementById(field + '-visible').checked = user[field + '_visible'] === true;
  const avatar = document.getElementById('profile-avatar');
  avatar.src = 'assets/default-avatar.svg';
  if (user.photo_url) {
    try {
      const url = new URL(user.photo_url, location.href);
      if (url.protocol === 'https:' || url.origin === location.origin) avatar.src = url.href;
    } catch {}
  }
}

document.getElementById('profile-avatar').addEventListener('error', event => {
  const avatar = event.currentTarget;
  if (!avatar.src.endsWith('/assets/default-avatar.svg')) avatar.src = 'assets/default-avatar.svg';
});

function fillSheet(profile, isPlayer) {
  const labels = isPlayer
    ? { first_name: 'Prénom', last_name: 'Nom', birth_date: 'Date de naissance', positions: 'Postes', preferred_foot: 'Pied fort', height_cm: 'Taille (cm)', current_club: 'Club actuel', past_clubs: 'Anciens clubs', experience: 'Expérience', level: 'Niveau' }
    : { name: 'Nom du club', city: 'Ville', divisions: 'Divisions', description: 'Description', general_info: 'Informations générales' };
  const sheet = document.getElementById('profile-sheet');
  sheet.replaceChildren();
  if (!profile) { sheet.textContent = 'Aucune fiche enregistrée pour ce compte.'; return; }
  for (const [field, label] of Object.entries(labels)) {
    const title = document.createElement('dt');
    const value = document.createElement('dd');
    title.textContent = label;
    value.textContent = profile[field] == null || profile[field] === '' ? 'Non renseigné' : String(profile[field]);
    if (field === 'positions') value.textContent = profile.positions?.length ? profile.positions.map(code => positionNames.get(code) || code).join(', ') : 'Non renseigné';
    if (field === 'preferred_foot') value.textContent = { RIGHT: 'Droit', LEFT: 'Gauche', BOTH: 'Les deux' }[profile[field]] || 'Non renseigné';
    if (field === 'birth_date' && profile[field]) value.textContent = String(profile[field]).slice(0, 10);
    sheet.append(title, value);
  }
}

function fillPlayerForm() {
  for (const field of ['preferred_foot', 'current_club', 'past_clubs', 'experience', 'level']) document.getElementById('player-' + field).value = saved.profile?.[field] || '';
  for (const box of playerForm.querySelectorAll('[name="positions"]')) box.checked = saved.profile?.positions?.includes(box.value) || false;
}

function clearErrors() {
  for (const error of document.querySelectorAll('.profile-error')) error.textContent = '';
  for (const field of document.querySelectorAll('[aria-invalid]')) field.removeAttribute('aria-invalid');
}

function showError(data) {
  if (!data.field) return;
  const id = data.field.startsWith('profile.') ? 'player-' + data.field.slice(8) : data.field;
  const field = document.getElementById(id);
  if (field) {
    field.setAttribute('aria-invalid', 'true');
    (field.matches('fieldset') ? field.querySelector('input') : field)?.focus();
  }
  const error = document.getElementById(id + '-error');
  if (error) error.textContent = data.message || 'Vérifiez ce champ.';
}

async function loadAdminAccess() {
  const link = document.getElementById('admin-link');
  link.hidden = true;
  try {
    const response = await fetch('/admin/me', { credentials: 'same-origin', cache: 'no-store' });
    if (!response.ok) return false;
    const data = await response.json();
    const allowed = data.admin?.role === 'ADMIN';
    link.hidden = !allowed;
    return allowed;
  } catch { return false; }
}

async function loadPlayerOptions() {
  const response = await fetch('/ads/options', { cache: 'no-store' });
  if (!response.ok) throw new Error('Les choix des postes sont indisponibles. Rechargez la page pour modifier votre fiche.');
  const options = await response.json();
  if (!options.positions?.length) throw new Error('Le catalogue des postes est vide.');
  const list = document.getElementById('player-position-list');
  for (const position of options.positions) {
    positionNames.set(position.code, position.label);
    const label = document.createElement('label');
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox'; checkbox.name = 'positions'; checkbox.value = position.code;
    label.append(checkbox, document.createTextNode(position.label));
    list.append(label);
  }
  for (const division of options.divisions) document.getElementById('player-levels').append(new Option(division.code));
  editButton.disabled = false;
}

async function loadProfile() {
  const isAdmin = await loadAdminAccess();
  try {
    const response = await fetch('/profile/me', { credentials: 'same-origin', cache: 'no-store' });
    if (response.status === 401) { window.location.replace('login.html'); return; }
    if (response.status === 403 && isAdmin) {
      document.getElementById('profile-title').textContent = 'Mon compte administrateur';
      logoutButton.hidden = false;
      message.textContent = 'Utilise le lien Panel admin pour accéder à l’administration.';
      return;
    }
    if (!response.ok) throw new Error('Profil indisponible. Réessayez plus tard.');
    saved = await response.json();
    const { user, profile } = saved;
    if (!user || !['PLAYER', 'CLUB'].includes(user.role)) throw new Error('Type de compte non autorisé.');
    const isPlayer = user.role === 'PLAYER';
    document.getElementById('profile-title').textContent = isPlayer ? 'Mon profil joueur' : 'Mon profil club';
    document.getElementById('profile-role').textContent = isPlayer ? 'Joueur' : 'Club';
    document.getElementById('sheet-title').textContent = isPlayer ? 'Ma fiche joueur' : 'Ma fiche club';
    document.getElementById('sheet-note').textContent = isPlayer ? 'Votre parcours et vos préférences sur le terrain.' : 'Les informations de votre club.';
    document.getElementById('profile-publish-link').hidden = isPlayer;
    editButton.hidden = !isPlayer || !profile;
    fillAccount(user);
    fillSheet(profile, isPlayer);
    content.hidden = false;
    logoutButton.hidden = false;
    message.textContent = '';
    if (isPlayer && profile) {
      try { await loadPlayerOptions(); fillSheet(profile, true); fillPlayerForm(); }
      catch (error) { message.textContent = error.message; }
    }
  } catch (error) { message.textContent = error.message || 'Impossible de charger le profil.'; }
}

async function save(body, football = false) {
  if (saving) return;
  saving = true;
  clearErrors();
  const buttons = [document.getElementById('save-button'), document.getElementById('save-player-button'), editButton, document.getElementById('cancel-player-button'), document.getElementById('cancel-account-button')];
  const buttonStates = buttons.map(button => ({ button, disabled: button.disabled }));
  for (const button of buttons) button.disabled = true;
  message.textContent = 'Enregistrement…';
  try {
    const response = await fetch('/profile/me', { method: 'PATCH', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (response.status === 401) { window.location.replace('login.html'); return; }
    const data = await response.json();
    if (!response.ok) {
      showError(data);
      throw new Error(data.message || 'Enregistrement refusé ou indisponible.');
    }
    saved = data;
    if (!football) fillAccount(data.user);
    fillSheet(data.profile, data.user.role === 'PLAYER');
    if (data.user.role === 'PLAYER' && (football || playerForm.hidden)) fillPlayerForm();
    if (football) { playerForm.hidden = true; editButton.setAttribute('aria-expanded', 'false'); }
    message.textContent = 'Modifications enregistrées. Votre fiche est à jour.';
  } catch (error) { message.textContent = error instanceof TypeError ? 'Impossible de joindre le serveur. Vos saisies sont conservées.' : error.message; }
  finally {
    saving = false;
    for (const state of buttonStates) state.button.disabled = state.disabled;
    if (football && playerForm.hidden) editButton.focus();
  }
}

form.addEventListener('submit', event => {
  event.preventDefault();
  const body = {};
  for (const field of ['username', 'photo_url', 'biography', 'phone', 'location']) body[field] = document.getElementById(field).value;
  for (const field of ['email', 'phone', 'location']) body[field + '_visible'] = document.getElementById(field + '-visible').checked;
  save(body);
});
document.getElementById('cancel-account-button').addEventListener('click', () => { fillAccount(saved.user); clearErrors(); message.textContent = 'Modifications annulées.'; });
editButton.addEventListener('click', () => {
  if (!playerForm.hidden) { playerForm.querySelector('input')?.focus(); return; }
  clearErrors(); fillPlayerForm(); playerForm.hidden = false;
  editButton.setAttribute('aria-expanded', 'true');
  playerForm.querySelector('input')?.focus();
});
document.getElementById('cancel-player-button').addEventListener('click', () => {
  fillPlayerForm(); clearErrors(); playerForm.hidden = true;
  editButton.setAttribute('aria-expanded', 'false'); editButton.focus(); message.textContent = 'Modifications annulées.';
});
playerForm.addEventListener('submit', event => {
  event.preventDefault();
  const profile = { positions: [...playerForm.querySelectorAll('[name="positions"]:checked')].map(box => box.value) };
  for (const field of ['preferred_foot', 'current_club', 'past_clubs', 'experience', 'level']) profile[field] = document.getElementById('player-' + field).value.trim() || null;
  save({ profile }, true);
});
logoutButton.addEventListener('click', async () => {
  logoutButton.disabled = true;
  try {
    const response = await fetch('/auth/logout', { method: 'POST', credentials: 'same-origin' });
    if (!response.ok) throw new Error('Déconnexion impossible. Réessayez.');
    window.location.replace('login.html');
  } catch (error) { message.textContent = error.message; logoutButton.disabled = false; }
});
loadProfile();
