// REPERE ORAL - REGLES D'UNE ANNONCE DE RECRUTEMENT.
// Ce validateur est utilise par les routes admin presentes sur main.
// Le routeur complet des clubs existe sur la branche locale annonces, pas dans ce dossier sur main.
// partial=true signifie PATCH : verifier seulement les champs fournis, pas exiger tout le formulaire.

const allowedPositions = [
  'GOALKEEPER', 'CENTRE_BACK', 'RIGHT_BACK', 'LEFT_BACK',
  'RIGHT_WING_BACK', 'LEFT_WING_BACK', 'DEFENSIVE_MIDFIELDER',
  'CENTRAL_MIDFIELDER', 'ATTACKING_MIDFIELDER', 'RIGHT_MIDFIELDER',
  'LEFT_MIDFIELDER', 'RIGHT_WINGER', 'LEFT_WINGER', 'STRIKER'
];
const allowedDivisions = [
  'D8', 'D7', 'D6', 'D5', 'D4', 'D3', 'D2', 'D1',
  'R3', 'R2', 'R1', 'N3', 'N2', 'N1'
];
const departments = ['Bas-Rhin', 'Haut-Rhin', 'Moselle', 'Meurthe-et-Moselle', 'Meuse', 'Vosges'];
const preferredFeet = ['Droit', 'Gauche', 'Deux pieds', 'Indifférent'];
const ageRanges = [
  { code: 'UNDER_18', label: 'Moins de 18 ans' },
  { code: '18_25', label: '18 à 25 ans' },
  { code: '26_35', label: '26 à 35 ans' },
  { code: '36_PLUS', label: '36 ans et plus' },
  { code: 'ANY', label: 'Indifférent' }
];
const experienceLevels = [
  { code: 'BEGINNER', label: 'Débutant' },
  { code: 'DEPARTMENTAL', label: 'Départemental' },
  { code: 'REGIONAL', label: 'Régional' },
  { code: 'NATIONAL', label: 'National' },
  { code: 'ANY', label: 'Indifférent' }
];

// partial=true : un PATCH ne vérifie que les champs envoyés.
function validateAd(body, { partial = false } = {}) {
  const errors = {};
  const data = {};
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { errors: { body: 'Envoyer un objet JSON.' }, data };
  }

  const requiredChoices = { department: departments, division_code: allowedDivisions };
  const optionalChoices = {
    preferred_foot: preferredFeet,
    age_range: ageRanges.map(item => item.code),
    experience_level: experienceLevels.map(item => item.code)
  };
  const textFields = { city: 100, description: 5000, salary: 100, additional_info: 2000 };
  const allowedFields = ['positions', 'trial_possible', ...Object.keys(requiredChoices),
    ...Object.keys(optionalChoices), ...Object.keys(textFields)];

  for (const field of Object.keys(body)) {
    if (!allowedFields.includes(field)) {
      errors.body = 'Le formulaire contient un champ non autorisé.';
      if (field !== '__proto__') errors[field] = 'Champ non autorisé.';
    }
  }
  if (partial && Object.keys(body).length === 0) errors.body = 'Envoyer au moins un champ.';

  if (!partial || Object.hasOwn(body, 'positions')) {
    if (!Array.isArray(body.positions) || body.positions.length < 1 || body.positions.length > 14) {
      errors.positions = 'Choisir entre 1 et 14 postes.';
    } else if (body.positions.some(value => !allowedPositions.includes(value))) {
      errors.positions = 'Un des postes sélectionnés est invalide.';
    } else if (new Set(body.positions).size !== body.positions.length) {
      errors.positions = 'Les postes ne doivent pas être en double.';
    } else {
      data.positions = [...body.positions];
    }
  }

  for (const [field, choices] of Object.entries(requiredChoices)) {
    if (partial && !Object.hasOwn(body, field)) continue;
    if (!choices.includes(body[field])) errors[field] = 'Choisir une valeur valide.';
    else data[field] = body[field];
  }
  for (const [field, choices] of Object.entries(optionalChoices)) {
    if (partial && !Object.hasOwn(body, field)) continue;
    if (body[field] == null) data[field] = null;
    else if (!choices.includes(body[field])) errors[field] = 'Choisir une valeur valide.';
    else data[field] = body[field];
  }

  for (const [field, maxLength] of Object.entries(textFields)) {
    if (partial && !Object.hasOwn(body, field)) continue;
    const required = ['city', 'description'].includes(field);
    const value = body[field];
    if (!required && value == null) {
      data[field] = null;
    } else if (typeof value !== 'string' || value.length > maxLength || value.includes('\u0000') ||
        (required && !value.trim())) {
      errors[field] = `Saisir un texte ${required ? 'non vide, ' : ''}de ${maxLength} caractères maximum.`;
    } else {
      data[field] = value.trim() || null;
    }
  }

  if (!partial || Object.hasOwn(body, 'trial_possible')) {
    if (body.trial_possible == null) data.trial_possible = null;
    else if (typeof body.trial_possible !== 'boolean') {
      errors.trial_possible = 'Envoyer true, false ou null.';
    } else data.trial_possible = body.trial_possible;
  }
  return { errors, data };
}

module.exports = { validateAd, departments, preferredFeet, ageRanges, experienceLevels };
