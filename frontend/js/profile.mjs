const message = document.getElementById('profile-message');
const content = document.getElementById('profile-content');
const logoutButton = document.getElementById('logout-button');

async function loadProfile() {
  try {
    const response = await fetch('/profile/me', { credentials: 'same-origin', cache: 'no-store' });
    if (response.status === 401) {
      window.location.replace('login.html');
      return;
    }
    if (!response.ok) throw new Error('Profil indisponible. Réessayez plus tard.');
    const { user } = await response.json();
    if (!user || !['PLAYER', 'CLUB'].includes(user.role)) throw new Error('Ce compte ne peut pas accéder à ce profil.');

    // Une seule page : le serveur fournit le role du compte connecte.
    const isPlayer = user.role === 'PLAYER';
    document.getElementById('profile-title').textContent = isPlayer ? 'Mon profil joueur' : 'Mon profil club';
    document.getElementById('profile-name').textContent = user.username;
    document.getElementById('profile-role').textContent = isPlayer ? 'Joueur' : 'Club';
    document.getElementById('profile-id').textContent = user.id;
    document.getElementById('profile-email').textContent = user.email;
    content.hidden = false;
    logoutButton.hidden = false;
    message.textContent = '';
  } catch (error) { message.textContent = error.message || 'Impossible de charger le profil.'; }
}

logoutButton.addEventListener('click', async () => {
  logoutButton.disabled = true;
  try {
    const response = await fetch('/auth/logout', { method: 'POST', credentials: 'same-origin' });
    if (!response.ok) throw new Error('Déconnexion impossible. Réessayez.');
    window.location.replace('login.html');
  } catch (error) {
    message.textContent = error.message || 'Déconnexion impossible.';
    logoutButton.disabled = false;
  }
});

loadProfile();
