// REPERE ORAL - LE FORMULAIRE DU PROFIL PARLE A /profile/me.
// Je remplis les champs avec le GET puis j'envoie les changements avec PATCH.
// Le serveur choisit le compte a partir de la session, pas a partir d'un champ cache du formulaire.
// Ce script branche les infos ; l'habillage de la page est un travail du front de l'equipe.

const message = document.getElementById('profile-message');
const content = document.getElementById('profile-content');
const form = document.getElementById('profile-form');
const saveButton = document.getElementById('save-button');
const logoutButton = document.getElementById('logout-button');

// Les champs du formulaire recoivent les valeurs du compte renvoye par le serveur.
function fillAccount(user) {
  document.getElementById('profile-name').textContent = user.username;
  document.getElementById('username').value = user.username;
  document.getElementById('profile-id').textContent = user.id;
  document.getElementById('profile-email').textContent = user.email;
  for (const field of ['biography', 'phone', 'location']) {
    document.getElementById(field).value = user[field] || '';
  }
  for (const field of ['email', 'phone', 'location']) {
    document.getElementById(field + '-visible').checked = user[field + '_visible'] === true;
  }
}

// Je change les libelles selon PLAYER/CLUB et je construis la fiche en texte, sans injecter du HTML envoye par l'utilisateur.
function fillSheet(profile, isPlayer) {
  const labels = isPlayer
    ? { first_name: 'Prénom', last_name: 'Nom', birth_date: 'Date de naissance',
        positions: 'Postes', preferred_foot: 'Pied fort', height_cm: 'Taille (cm)',
        current_club: 'Club actuel', past_clubs: 'Anciens clubs', experience: 'Expérience', level: 'Niveau' }
    : { name: 'Nom du club', city: 'Ville', divisions: 'Divisions',
        description: 'Description', general_info: 'Informations générales' };
  const sheet = document.getElementById('profile-sheet');
  sheet.replaceChildren();
  if (!profile) {
    sheet.textContent = 'Aucune fiche enregistrée pour ce compte.';
    return;
  }
  // Afficher le texte sans l'interpreter comme du HTML.
  for (const [field, label] of Object.entries(labels)) {
    const title = document.createElement('dt');
    const value = document.createElement('dd');
    title.textContent = label;
    value.textContent = profile[field] == null || profile[field] === '' ? 'Non renseigné' : String(profile[field]);
    if (field === 'positions') value.textContent = profile.positions?.length ? profile.positions.join(', ') : 'Non renseigné';
    if (field === 'preferred_foot') value.textContent = { RIGHT: 'Droit', LEFT: 'Gauche', BOTH: 'Les deux' }[profile[field]] || 'Non renseigné';
    if (field === 'birth_date' && profile[field]) value.textContent = String(profile[field]).slice(0, 10);
    sheet.append(title, value);
  }
}

// Afficher le lien uniquement après vérification des droits par le serveur.
// Le lien est visible seulement si /admin/me confirme les permissions ; le backend verifie encore au clic.
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
  } catch {
    return false;
  }
}

// GET charge le profil. 401 renvoie vers login ; une panne affiche une erreur lisible.
async function loadProfile() {
  const isAdmin = await loadAdminAccess();
  try {
    const response = await fetch('/profile/me', { credentials: 'same-origin', cache: 'no-store' });
    if (response.status === 401) {
      window.location.replace('login.html');
      return;
    }
    if (response.status === 403 && isAdmin) {
      document.getElementById('profile-title').textContent = 'Mon compte administrateur';
      logoutButton.hidden = false;
      message.textContent = 'Utilise le lien Panel admin pour accéder à l’administration.';
      return;
    }
    if (!response.ok) throw new Error('Profil indisponible. Vérifie la configuration du backend et de la base.');
    const { user, profile } = await response.json();
    if (!user || !['PLAYER', 'CLUB'].includes(user.role)) throw new Error('Type de compte non autorisé.');
    const isPlayer = user.role === 'PLAYER';
    document.getElementById('profile-title').textContent = isPlayer ? 'Mon profil joueur' : 'Mon profil club';
    document.getElementById('profile-role').textContent = isPlayer ? 'Joueur' : 'Club';
    document.getElementById('sheet-title').textContent = isPlayer ? 'Ma fiche joueur' : 'Ma fiche club';
    fillAccount(user);
    fillSheet(profile, isPlayer);
    content.hidden = false;
    logoutButton.hidden = false;
    message.textContent = '';
  } catch (error) {
    message.textContent = error.message;
  }
}

// Je garde la page ouverte avec preventDefault, puis je fais PATCH en JSON.
form.addEventListener('submit', async event => {
  event.preventDefault();
  saveButton.disabled = true;
  message.textContent = 'Enregistrement…';
  // Ce JSON contient les nouvelles valeurs, pas l'ID de la personne a modifier.
  const body = { username: document.getElementById('username').value };
  for (const field of ['biography', 'phone', 'location']) body[field] = document.getElementById(field).value;
  for (const field of ['email', 'phone', 'location']) body[field + '_visible'] = document.getElementById(field + '-visible').checked;
  try {
    const response = await fetch('/profile/me', {
      method: 'PATCH', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
    });
    if (response.status === 401) {
      window.location.replace('login.html');
      return;
    }
    const data = await response.json();
    if (!response.ok) throw new Error(data.message || (data.field ? 'Champ invalide : ' + data.field : 'Enregistrement refusé ou indisponible.'));
    fillAccount(data.user);
    message.textContent = 'Profil enregistré dans la base. Recharge la page pour vérifier.';
  } catch (error) {
    message.textContent = error.message || 'Impossible de joindre le serveur.';
  } finally {
    saveButton.disabled = false;
  }
});

// Le logout appelle aussi le serveur : juste changer de page ne revoquerait pas la session SQL.
logoutButton.addEventListener('click', async () => {
  logoutButton.disabled = true;
  try {
    const response = await fetch('/auth/logout', { method: 'POST', credentials: 'same-origin' });
    if (!response.ok) throw new Error('Déconnexion impossible. Réessayez.');
    window.location.replace('login.html');
  } catch (error) {
    message.textContent = error.message;
    logoutButton.disabled = false;
  }
});

loadProfile();
