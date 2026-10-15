// Afficher le pseudo dans le bandeau si le serveur confirme la connexion.
async function loadAccount() {
  const link = document.getElementById('account-link');
  const register = document.getElementById('register-link');
  link.textContent = 'Se connecter';
  link.href = 'login.html';
  link.classList.remove('account-connected');
  link.removeAttribute('title');
  register.hidden = false;
  try {
    const response = await fetch('/auth/me', { credentials: 'same-origin', cache: 'no-store' });
    if (!response.ok) return;
    const { user } = await response.json();
    if (!user || typeof user.username !== 'string') return;
    link.textContent = user.username;
    link.href = 'profile.html';
    link.title = 'Voir le profil de ' + user.username;
    link.classList.add('account-connected');
    register.hidden = true;
  } catch {
    // En cas de panne, garder les liens de connexion et d'inscription.
  }
}

loadAccount();
window.addEventListener('pageshow', event => {
  if (event.persisted) loadAccount();
});
