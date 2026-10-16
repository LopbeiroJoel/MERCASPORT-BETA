// REPERE ORAL - LE PSEUDO DANS LE BANDEAU ACCUEIL/OFFRES.
// Je demande GET /auth/me ; si la session est valide je remplace Se connecter par le pseudo.
// Ce code ne lit pas le cookie HttpOnly : le navigateur l'envoie au serveur.
// Ce n'est pas un refresh token : verifier la session ne prolonge pas sa duree.

// Afficher le pseudo dans le bandeau si le serveur confirme la connexion.
// Je remets d'abord le mode visiteur, puis je laisse le serveur confirmer la connexion.
async function loadAccount() {
  const link = document.getElementById('account-link');
  const register = document.getElementById('register-link');
  link.textContent = 'Se connecter';
  link.href = 'login.html';
  link.classList.remove('account-connected');
  link.removeAttribute('title');
  register.hidden = false;
  try {
    // credentials envoie les cookies au meme site ; cache no-store evite une ancienne identite en cache.
    const response = await fetch('/auth/me', { credentials: 'same-origin', cache: 'no-store' });
    if (!response.ok) return;
    const { user } = await response.json();
    if (!user || typeof user.username !== 'string') return;
    // textContent affiche le pseudo comme du texte, jamais comme une balise HTML.
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
// Le bouton Retour peut restaurer une page gardee en memoire : je reverifie la session a ce moment-la.
window.addEventListener('pageshow', event => {
  if (event.persisted) loadAccount();
});
