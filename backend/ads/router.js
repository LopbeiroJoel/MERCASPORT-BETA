const express = require('express');

const departments = [
  'Bas-Rhin',
  'Haut-Rhin',
  'Moselle',
  'Meurthe-et-Moselle',
  'Meuse',
  'Vosges'
];

const preferredFeet = [
  'Droit',
  'Gauche',
  'Deux pieds',
  'Indifférent'
];

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

function createAdsRouter(pool, sessions) {
  const router = express.Router();



  router.get('/options', async (req, res) => {
    res.set('Cache-Control', 'no-store');

    try {
      const positions = await pool.query(
        `SELECT code, label FROM public.positions ORDER BY sort_order`
      );
      const divisions = await pool.query(
        `SELECT code FROM public.divisions ORDER BY sort_order`
      );

      res.json({
        positions: positions.rows,
        divisions: divisions.rows,
        departments,
        preferred_feet: preferredFeet,
        age_ranges: ageRanges,
        experience_levels: experienceLevels
      });
    } catch {
      res.status(503).json({
        code: 'AD_OPTIONS_UNAVAILABLE',
        message: 'Les choix des annonces sont temporairement indisponibles.'
      });
    }
  });

  return router;
}

module.exports = { createAdsRouter };