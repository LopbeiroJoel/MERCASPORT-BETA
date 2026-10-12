const form = document.getElementById('register-form');
const message = document.getElementById('register-message');
const button = form.querySelector('button[type="submit"]');
const playerFields = document.getElementById('player-fields');
const clubFields = document.getElementById('club-fields');

function selectedRole() {
  return form.querySelector('input[name="role"]:checked')?.value;
}

function showFields() {
  const role = selectedRole();
  playerFields.hidden = role !== 'PLAYER';
  playerFields.disabled = role !== 'PLAYER';
  clubFields.hidden = role !== 'CLUB';
  clubFields.disabled = role !== 'CLUB';
}

for (const radio of form.querySelectorAll('input[name="role"]')) {
  radio.addEventListener('change', showFields);
}
showFields();

form.addEventListener('submit', async event => {
  event.preventDefault();
  const password = document.getElementById('password').value;
  if (password !== document.getElementById('confirm-password').value) {
    message.textContent = 'Les deux mots de passe doivent être identiques.';
    return;
  }

  const role = selectedRole();
  let profile;
  if (role === 'PLAYER') {
    profile = { first_name: document.getElementById('first_name').value.trim(),
      last_name: document.getElementById('last_name').value.trim() };
    const positions = Array.from(form.querySelectorAll('input[name="positions"]:checked'), input => input.value);
    if (positions.length) profile.positions = positions;
    for (const field of ['birth_date', 'preferred_foot', 'current_club']) {
      const value = document.getElementById(field).value.trim();
      if (value) profile[field] = value;
    }
    const height = document.getElementById('height_cm').value;
    if (height !== '') profile.height_cm = Number(height);
  } else if (role === 'CLUB') {
    profile = { name: document.getElementById('name').value.trim(),
      city: document.getElementById('city').value.trim() };
    const divisions = document.getElementById('divisions').value.trim();
    if (divisions) profile.divisions = divisions;
  } else {
    message.textContent = 'Choisis joueur ou club.';
    return;
  }

  button.disabled = true;
  message.textContent = 'Création du compte…';
  try {
    const response = await fetch('/auth/register', {
      method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: document.getElementById('email').value.trim(),
        username: document.getElementById('username').value.trim(), password, role, profile })
    });
    const data = await response.json();
    if (!response.ok) {
      message.textContent = data.fields
        ? Object.entries(data.fields).map(([field, detail]) => field + ' : ' + detail).join(' ; ')
        : data.error || 'Inscription indisponible. Réessayez plus tard.';
      return;
    }
    document.getElementById('password').value = '';
    document.getElementById('confirm-password').value = '';
    message.textContent = 'Compte créé. Tu peux te connecter avec le lien Se connecter.';
  } catch {
    message.textContent = 'Impossible de joindre le serveur. Réessayez plus tard.';
  } finally {
    button.disabled = false;
  }
});
