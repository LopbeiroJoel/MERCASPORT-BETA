// REPERE ORAL - MON PROFIL : GET ET PATCH /profile/me (doc, section 11).
// GET lit mon compte puis ma fiche joueur ou club. PATCH modifie seulement les champs autorises.
// L'ID vient de la session : envoyer l'ID de quelqu'un d'autre ne permet pas de modifier son compte.
// Les choix de visibilite concernent l'affichage public ; ici le proprietaire voit ses propres infos.

const express = require('express');
const { validateRegistration } = require('./registration/validation');

function createProfileRouter(pool, sessions) {
  const router = express.Router();

  // Lire les informations du compte connecté.
  // GET /profile/me : je lis users puis la bonne fiche, avec l'ID de la session.
  router.get('/me', async (req, res) => {
    res.set('Cache-Control', 'no-store');

    if (!sessions) {
      return res.status(503).json({ code: 'AUTH_NOT_CONFIGURED' });
    }

    try {
      const identity = await sessions.authenticate(req);

      if (!identity) {
        return res.status(401).json({ code: 'AUTH_REQUIRED' });
      }

      if (!['PLAYER', 'CLUB'].includes(identity.role)) {
        return res.status(403).json({ code: 'ROLE_DENIED' });
      }

      const { rows } = await pool.query(
        `SELECT id, username, email, photo_url, biography,
                phone, location, email_visible,
                phone_visible, location_visible
         FROM public.users
         WHERE id = $1`,
        [identity.userId]
      );

      if (!rows.length) {
        return res.status(401).json({ code: 'AUTH_REQUIRED' });
      }

      let profile;

      if (identity.role === 'PLAYER') {
        const result = await pool.query(
          `SELECT first_name, last_name, birth_date, positions,
                  preferred_foot, height_cm, current_club,
                  past_clubs, experience, level
           FROM public.player_profiles
           WHERE user_id = $1`,
          [identity.userId]
        );

        profile = result.rows[0] || null;
      } else {
        const result = await pool.query(
          `SELECT name, city, divisions, description, general_info
           FROM public.club_profiles
           WHERE user_id = $1`,
          [identity.userId]
        );

        profile = result.rows[0] || null;
      }

      return res.json({
        user: { ...rows[0], role: identity.role },
        profile
      });
    } catch {
      return res.status(503).json({ code: 'PROFILE_UNAVAILABLE' });
    }
  });

  // Modifier les informations communes du compte connecté.
  // PATCH /profile/me : les champs non envoyes restent comme avant.
  router.patch('/me', express.json({ limit: '8kb' }), async (req, res) => {
    res.set('Cache-Control', 'no-store');

    if (!sessions) {
      return res.status(503).json({ code: 'AUTH_NOT_CONFIGURED' });
    }

    if (!sessions.allowsOrigin(req)) {
      return res.status(403).json({ code: 'ORIGIN_DENIED' });
    }

    try {
      const identity = await sessions.authenticate(req);

      if (!identity) {
        return res.status(401).json({ code: 'AUTH_REQUIRED' });
      }

      if (!['PLAYER', 'CLUB'].includes(identity.role)) {
        return res.status(403).json({ code: 'ROLE_DENIED' });
      }

      if (!req.is('application/json')) {
        return res.status(415).json({ code: 'JSON_REQUIRED' });
      }

      const body = req.body;

      if (!body || typeof body !== 'object' || Array.isArray(body)) {
        return res.status(400).json({ code: 'INVALID_BODY' });
      }

      // LISTE FERMEE : pas de role, pas d'ID d'une autre personne, pas de password_hash.
      const allowedFields = [
        'username',
        'biography',
        'phone',
        'location',
        'email_visible',
        'phone_visible',
        'location_visible'
      ];

      const unknownFields = Object.keys(body).filter(
        field => !allowedFields.includes(field)
      );

      if (unknownFields.length > 0) {
        return res.status(400).json({
          code: 'UNKNOWN_FIELDS',
          fields: unknownFields
        });
      }

      if (Object.keys(body).length === 0) {
        return res.status(400).json({ code: 'EMPTY_UPDATE' });
      }

      // Réutiliser les mêmes règles de pseudo qu'à l'inscription.
      // Le meme validateur que l'inscription controle le nouveau pseudo. Je recupere seulement sa regle username.
      if (Object.hasOwn(body, 'username')) {
        const { data, errors } = validateRegistration({ username: body.username });
        if (errors.username) {
          return res.status(400).json({ code: 'INVALID_FIELD', field: 'username', message: errors.username });
        }
        body.username = data.username;
      }

      // Vérifier les textes et leurs longueurs.
      const textLimits = {
        biography: 2000,
        phone: 30,
        location: 100
      };

      for (const [field, maxLength] of Object.entries(textLimits)) {
        if (Object.hasOwn(body, field)) {
          const value = body[field];

          if (
            typeof value !== 'string' ||
            value.length > maxLength ||
            value.includes('\u0000')
          ) {
            return res.status(400).json({
              code: 'INVALID_FIELD',
              field
            });
          }
        }
      }

      // Les choix de visibilité doivent être true ou false.
      const visibilityFields = [
        'email_visible',
        'phone_visible',
        'location_visible'
      ];

      for (const field of visibilityFields) {
        if (
          Object.hasOwn(body, field) &&
          typeof body[field] !== 'boolean'
        ) {
          return res.status(400).json({
            code: 'INVALID_FIELD',
            field
          });
        }
      }

      // Modifier uniquement les champs autorisés et envoyés.
      const fields = allowedFields.filter(
        field => Object.hasOwn(body, field)
      );

      const values = fields.map(field => body[field]);

      // Je fabrique SET avec des colonnes deja autorisees. Les valeurs restent dans le tableau values.
      const assignments = fields.map(
        (field, index) => `${field} = $${index + 1}`
      );

      // L'identifiant vient de la session, jamais du formulaire.
      // C'est LA ligne a montrer pour la securite du compte cible : l'ID vient de la session.
      values.push(identity.userId);

      const result = await pool.query(
        `UPDATE public.users
         SET ${assignments.join(', ')}
         WHERE id = $${values.length}
         RETURNING id, username, email, photo_url, biography,
                   phone, location, email_visible,
                   phone_visible, location_visible`,
        values
      );

      if (!result.rows.length) {
        return res.status(401).json({ code: 'AUTH_REQUIRED' });
      }

      return res.json({
        message: 'Profil enregistré.',
        user: {
          ...result.rows[0],
          role: identity.role
        }
      });
    } catch (error) {
      // L'index UNIQUE a refuse un doublon de pseudo : 409, pas une sauvegarde partielle.
      if (error.code === '23505') {
        return res.status(409).json({ code: 'USERNAME_TAKEN', message: 'Ce pseudo est déjà utilisé.' });
      }
      return res.status(503).json({ code: 'PROFILE_UNAVAILABLE' });
    }
  });

  return router;
}

module.exports = { createProfileRouter };
