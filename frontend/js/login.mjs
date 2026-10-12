const form = document.getElementById('login-form');
const button = document.getElementById('login-button');
const message = document.getElementById('login-message');

form.addEventListener('submit', async event => {
  event.preventDefault();
  button.disabled = true;
  message.textContent = 'Connexion en cours…';
  const password = document.getElementById('password');

  try {
    const response = await fetch('/auth/login', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier: document.getElementById('identifier').value.trim(), password: password.value })
    });
    if (response.ok) {
      window.location.replace('profile.html');
      return;
    }
    if (response.status === 401) message.textContent = 'E-mail, pseudo ou mot de passe incorrect.';
    else if (response.status === 429) message.textContent = 'Trop de tentatives. Réessayez dans 15 minutes.';
    else message.textContent = 'Connexion indisponible. Réessayez plus tard.';
  } catch { message.textContent = 'Impossible de joindre le serveur. Vérifiez votre connexion.'; }
  finally {
    password.value = '';
    button.disabled = false;
  }
});
