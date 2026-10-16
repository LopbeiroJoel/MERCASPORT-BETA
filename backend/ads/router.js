const express = require('express');
const { requireActiveClub } = require('./permissions');
const { validateAd, preferredFeet, ageRanges, experienceLevels } = require('./validation');

function createAdsRouter(pool, sessions) {
  const router = express.Router();
  router.use((req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });

  router.get('/options', async (req, res) => {
    try {
      const positions = await pool.query('SELECT code, label FROM public.positions ORDER BY sort_order');
      const divisions = await pool.query('SELECT code FROM public.divisions ORDER BY sort_order');
      res.json({ positions: positions.rows, divisions: divisions.rows,
        departments: ['Bas-Rhin', 'Haut-Rhin'], preferred_feet: preferredFeet,
        age_ranges: ageRanges, experience_levels: experienceLevels });
    } catch {
      res.status(503).json({ code: 'AD_OPTIONS_UNAVAILABLE', message: 'Les choix du formulaire sont indisponibles.' });
    }
  });

  router.post('/', requireActiveClub(pool, sessions), (req, res, next) => {
    if (!req.is('application/json')) return res.status(415).json({ code: 'JSON_REQUIRED' });
    next();
  }, express.json({ limit: '16kb' }), async (req, res) => {
    const { data, errors } = validateAd(req.body);
    if (Object.keys(errors).length) {
      return res.status(400).json({ code: 'VALIDATION_ERROR', fields: errors });
    }
    let client;
    try {
      client = await pool.connect();
      await client.query('BEGIN');
      const owner = await client.query(`SELECT c.name FROM public.users u
        JOIN public.clubs c ON c.user_id = u.id
        WHERE u.id = $1 AND c.id = $2 AND upper(u.role) = 'CLUB' AND u.status = 'ACTIVE'
        FOR SHARE OF u, c`, [req.club.userId, req.club.clubId]);
      if (!owner.rows.length) {
        await client.query('ROLLBACK');
        return res.status(403).json({ code: 'CLUB_ACCESS_DENIED' });
      }
      const positions = await client.query(`SELECT code, label FROM public.positions
        WHERE code = ANY($1::text[]) FOR SHARE`, [data.positions]);
      const division = await client.query('SELECT code FROM public.divisions WHERE code = $1 FOR SHARE', [data.division_code]);
      if (positions.rows.length !== data.positions.length || !division.rows.length) {
        await client.query('ROLLBACK');
        return res.status(400).json({ code: 'VALIDATION_ERROR', fields: {
          ...(positions.rows.length !== data.positions.length ? { positions: 'Un poste est absent du catalogue.' } : {}),
          ...(!division.rows.length ? { division_code: 'Cette division est absente du catalogue.' } : {})
        } });
      }
      const title = `${owner.rows[0].name} recrute`.slice(0, 150);
      const position = positions.rows.find(row => row.code === data.positions[0]).label;
      const result = await client.query(`INSERT INTO public.ads
        (author_id, club_id, title, position, city, location, department, division_code,
         description, short_description, preferred_foot, salary, age_range,
         experience_level, trial_possible, additional_info)
        VALUES ($1,$2,$3,$4,$5,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
        RETURNING id, title, created_at`, [req.club.userId, req.club.clubId, title, position,
        data.city, data.department, data.division_code, data.description, data.description.slice(0, 200),
        data.preferred_foot, data.salary, data.age_range, data.experience_level, data.trial_possible, data.additional_info]);
      const ad = result.rows[0];
      await client.query(`INSERT INTO public.ad_positions(ad_id, position_code)
        SELECT $1, unnest($2::text[])`, [ad.id, data.positions]);
      await client.query('COMMIT');
      res.location('/ads/' + ad.id).status(201).json(ad);
    } catch (error) {
      if (client) await client.query('ROLLBACK').catch(() => {});
      const invalid = ['23503', '23514', '22001'].includes(error.code);
      res.status(invalid ? 400 : 503).json({ code: invalid ? 'INVALID_AD_DATA' : 'AD_SAVE_UNAVAILABLE',
        message: invalid ? 'Vérifiez les informations de l’offre.' : 'Publication indisponible. Réessayez plus tard.' });
    } finally {
      if (client) client.release();
    }
  });

  router.use((error, req, res, next) => {
    if (error.type === 'entity.parse.failed') return res.status(400).json({ code: 'INVALID_JSON' });
    if (error.type === 'entity.too.large') return res.status(413).json({ code: 'BODY_TOO_LARGE' });
    next(error);
  });
  return router;
}

module.exports = { createAdsRouter };
