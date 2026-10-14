function validateAd(body) {
  const errors = {};
  const data = {};

  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    errors.body = 'Envoyer un objet JSON.';
  }

  // Les controles des champs seront ajoutes a ANNONCE-05.
  return { errors, data };
}

module.exports = { validateAd };
