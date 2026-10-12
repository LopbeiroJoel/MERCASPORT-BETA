const express = require('express');

function createProfileRouter(pool, sessions) {
  const router = express.Router();

  // Lire les informations du compte connecté.
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

      const allowedFields = [
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

      const assignments = fields.map(
        (field, index) => `${field} = $${index + 1}`
      );

      // L'identifiant vient de la session, jamais du formulaire.
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
    } catch {
      return res.status(503).json({ code: 'PROFILE_UNAVAILABLE' });
    }
  });

  return router;
}

module.exports = { createProfileRouter };
