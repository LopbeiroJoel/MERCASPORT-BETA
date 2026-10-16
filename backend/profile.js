const express = require('express');
const { createProfileUpdate } = require('./profile-update');

function createProfileRouter(pool, sessions) {
  const router = express.Router();

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

  router.patch('/me', express.json({ limit: '8kb' }), createProfileUpdate(pool, sessions));

  return router;
}

module.exports = { createProfileRouter };
