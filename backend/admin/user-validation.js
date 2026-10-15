// Mêmes règles de pseudo et d'e-mail que l'inscription.
function validateUserUpdate(body) {
  const data = {};
  const errors = {};
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { data, errors: { body: 'Envoyer un objet JSON.' } };
  }
  const fields = Object.keys(body);
  if (!fields.length) errors.body = 'Envoyer au moins un champ.';
  if (fields.some(field => !['username', 'email'].includes(field))) {
    errors.body = 'Seuls username et email sont autorisés.';
  }

  if (Object.hasOwn(body, 'username')) {
    const username = typeof body.username === 'string' ? body.username.trim().normalize('NFC') : '';
    if ([...username].length < 3 || [...username].length > 50 ||
        !/^[\p{L}\p{N} ._'’-]+$/u.test(username)) {
      errors.username = 'Pseudo de 3 à 50 caractères : lettres, chiffres, espaces, point, tiret, apostrophe ou underscore.';
    } else data.username = username;
  }

  if (Object.hasOwn(body, 'email')) {
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    const [local = '', domain = '', extra] = email.split('@');
    const labels = domain.split('.');
    if (!email || email.length > 254 || local.length > 64 || extra !== undefined
      || !/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+$/i.test(local)
      || local.startsWith('.') || local.endsWith('.') || local.includes('..')
      || labels.length < 2 || labels.some(label => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label))
      || !/^[a-z]{2,63}$/i.test(labels.at(-1))) {
      errors.email = 'Saisir une adresse e-mail valide.';
    } else data.email = email;
  }
  return { data, errors };
}

module.exports = { validateUserUpdate };
