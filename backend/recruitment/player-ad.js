const detailsFields = [
  'current_club',
  'past_clubs',
  'experience',
  'age',
  'height_cm',
  'sport_stats',
  'sport_season'
];
function reject(fields) {
  throw Object.assign(new Error('Vérifiez les champs indiqués.'), {
    status: 400,
    code: 'VALIDATION_ERROR',
    fields
  });
}
async function validatePlayerAd(client, input, old, status) {
  const errors = {},
    details = { ...(old?.player_details || {}) };
  if (Object.hasOwn(input, 'player_details')) {
    if (
      !input.player_details ||
      typeof input.player_details !== 'object' ||
      Array.isArray(input.player_details) ||
      Object.keys(input.player_details).some((k) => !detailsFields.includes(k))
    )
      reject({ player_details: 'Informations joueur invalides.' });
    Object.assign(details, input.player_details);
  }
  for (const [key, max] of [
    ['current_club', 150],
    ['past_clubs', 2000],
    ['experience', 2000]
  ]) {
    if (details[key] == null || details[key] === '') details[key] = null;
    else if (
      typeof details[key] !== 'string' ||
      details[key].length > max ||
      /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(details[key])
    )
      errors['player_details.' + key] = 'Texte invalide.';
    else details[key] = details[key].trim() || null;
  }
  for (const [key, min, max] of [
    ['age', 5, 100],
    ['height_cm', 80, 250]
  ])
    if (
      details[key] != null &&
      (!Number.isInteger(details[key]) || details[key] < min || details[key] > max)
    )
      errors['player_details.' + key] = `Saisir un nombre entier entre ${min} et ${max}.`;
  const stats = details.sport_stats;
  if (
    stats != null &&
    (!stats ||
      typeof stats !== 'object' ||
      Array.isArray(stats) ||
      Object.keys(stats).some((k) => !['appearances', 'goals', 'assists'].includes(k)) ||
      Object.values(stats).some((v) => !Number.isInteger(v) || v < 0 || v > 99999))
  )
    errors['player_details.sport_stats'] =
      'Les statistiques doivent être des nombres entiers positifs.';
  if (
    details.sport_season != null &&
    (typeof details.sport_season !== 'string' || !/^\d{4}\/\d{4}$/.test(details.sport_season))
  )
    errors['player_details.sport_season'] = 'Utiliser le format 2026/2027.';
  if (input.preferred_foot_code === 'ANY')
    errors.preferred_foot_code = 'Choisir le pied fort du joueur.';
  if (status === 'PUBLISHED') {
    for (const key of [
      'title',
      'description',
      'city',
      'division_code',
      'mobility_code',
      'availability_code'
    ]) {
      const value = Object.hasOwn(input, key) ? input[key] : old?.[key];
      if (typeof value !== 'string' || !value.trim()) errors[key] = 'Ce champ est obligatoire.';
    }
    for (const key of ['current_club', 'past_clubs'])
      if (!details[key])
        errors['player_details.' + key] =
          'Ce champ est obligatoire. Indiquez « Aucun » si vous n’avez pas de club.';
    const positions = Object.hasOwn(input, 'positions')
      ? input.positions
      : old
        ? (
            await client.query('SELECT position_code FROM ad_positions WHERE ad_id=$1', [
              old.id
            ])
          ).rows
        : [];
    const projects = Object.hasOwn(input, 'project_types')
      ? input.project_types
      : old
        ? (
            await client.query('SELECT project_code FROM ad_project_types WHERE ad_id=$1', [
              old.id
            ])
          ).rows
        : [];
    if (!Array.isArray(positions) || !positions.length)
      errors.positions = 'Choisir au moins un poste.';
    if (!Array.isArray(projects) || !projects.length)
      errors.project_types = 'Choisir au moins un type de projet.';
  }
  if (Object.keys(errors).length) reject(errors);
  return details;
}
module.exports = { validatePlayerAd };
