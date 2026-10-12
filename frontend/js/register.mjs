const form = document.getElementById('register-form');
const role = document.getElementById('role');
const message = document.getElementById('register-message');
const button = document.getElementById('register-button');

function showFields() {
  const isPlayer = role.value === 'PLAYER';
  const playerFields = document.getElementById('player-fields');
  const clubFields = document.getElementById('club-fields');
  playerFields.hidden = !isPlayer;
  playerFields.disabled = !isPlayer;
  clubFields.hidden = isPlayer;
  clubFields.disabled = isPlayer;
}

role.addEventListener('change', showFields);
showFields();

form.addEventListener('submit', async event => {
  event.preventDefault();
  const password = document.getElementById('password').value;
  if (password !== document.getElementById('confirmation').value) {
    message.textContent = 'Les deux mots de passe doivent être identiques.';
    return;
  }
  const profile = role.value === 'PLAYER'
    ? { first_name: document.getElementById('first-name').value.trim(),
        last_name: document.getElementById('last-name').value.trim() }
    : { name: document.getElementById('club-name').value.trim(),
        city: document.getElementById('club-city').value.trim(),
        divisions: document.getElementById('divisions').value.trim() || null };

  button.disabled = true;
  message.textContent = 'Création du compte…';
  document.getElementById('register-success').hidden = true;
  try {
    const response = await fetch('/auth/register', {
      method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: document.getElementById('email').value.trim(),
        username: document.getElementById('username').value.trim(),
        password, role: role.value, profile })
    });
    const data = await response.json();
    if (!response.ok) {
      message.textContent = data.fields
        ? Object.entries(data.fields).map(([field, detail]) => field + ' : ' + detail).join(' ; ')
        : data.error || 'Inscription indisponible. Réessayez plus tard.';
      return;
    }
    message.textContent = 'Compte créé. Tu peux maintenant te connecter.';
    document.getElementById('register-success').hidden = false;
    document.getElementById('password').value = '';
    document.getElementById('confirmation').value = '';
  } catch {
    message.textContent = 'Impossible de joindre le serveur. En local, utilise http://localhost:3000.';
  } finally {
    button.disabled = false;
  }
});
