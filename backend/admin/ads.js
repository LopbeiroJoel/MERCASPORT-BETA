const express = require('express');
const { validateAd } = require('../ads/validation');
const { fail, id, body, text, transaction, insert, update } = require('./helpers');

function createAdminAdsRouter(pool) {
  const router = express.Router();
  router.get('/ads/:id', async (req, res) => {
    const result = await pool.query(`SELECT d.*, a.status, a.deleted_at
      FROM public.ads_details d JOIN public.ads a ON a.id = d.id WHERE d.id = $1`, [id(req.params.id)]);
    if (!result.rows.length) fail(404, 'AD_NOT_FOUND');
    res.json({ ad: result.rows[0] });
  });

  async function saveAd(req, res) {
    const editing = req.method === 'PATCH';
    // L'admin peut choisir l'auteur à la création, pas transférer une annonce existante.
    const input = { ...req.body };
    if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) fail(400, 'INVALID_BODY');
    let authorId;
    if (!editing) { authorId = id(input.author_id); delete input.author_id; }
    const title = Object.hasOwn(input, 'title') ? text(input.title, 150, true) : undefined;
    delete input.title;
    const validation = validateAd(input, { partial: editing });
    if (Object.keys(validation.errors).length && !(editing && title && Object.keys(input).length === 0)) {
      fail(400, 'VALIDATION_ERROR', validation.errors);
    }
    const data = validation.data;
    const positions = data.positions;
    delete data.positions;
    const ad = await transaction(pool, req.admin.userId, async client => {
      let adId;
      if (editing) {
        adId = id(req.params.id);
        const exists = await client.query('SELECT id FROM public.ads WHERE id = $1 FOR UPDATE', [adId]);
        if (!exists.rows.length) fail(404, 'AD_NOT_FOUND');
      } else {
        const author = await client.query(`SELECT u.role, c.id AS club_id, c.name
          FROM public.users u LEFT JOIN public.clubs c ON c.user_id = u.id
          WHERE u.id = $1 FOR SHARE OF u`, [authorId]);
        if (!author.rows.length || !['PLAYER', 'CLUB'].includes(author.rows[0].role.toUpperCase())) fail(400, 'INVALID_AUTHOR');
        const owner = author.rows[0];
        if (owner.role.toUpperCase() === 'CLUB' && !owner.club_id) fail(400, 'CLUB_NOT_FOUND');
        data.author_id = authorId;
        data.club_id = owner.role.toUpperCase() === 'CLUB' ? owner.club_id : null;
        data.title = title || (owner.name ? `${owner.name} recrute` : 'Joueur disponible').slice(0, 150);
      }
      if (title) data.title = title;
      if (Object.hasOwn(data, 'city')) data.location = data.city;
      if (Object.hasOwn(data, 'description')) data.short_description = data.description.slice(0, 200);
      if (positions) {
        const reference = await client.query('SELECT code, label FROM public.positions WHERE code = ANY($1::text[]) FOR SHARE', [positions]);
        if (reference.rows.length !== positions.length) fail(400, 'INVALID_POSITIONS');
        data.position = reference.rows.find(row => row.code === positions[0]).label;
      }
      if (editing) await update(client, 'ads', 'id', adId, data, 'id');
      else adId = (await insert(client, 'ads', data, 'id')).id;
      if (positions) {
        await client.query('DELETE FROM public.ad_positions WHERE ad_id = $1', [adId]);
        await client.query('INSERT INTO public.ad_positions(ad_id, position_code) SELECT $1, unnest($2::text[])', [adId, positions]);
      }
      return (await client.query(`SELECT d.*, a.status FROM public.ads_details d
        JOIN public.ads a ON a.id = d.id WHERE d.id = $1`, [adId])).rows[0];
    });
    res.status(editing ? 200 : 201).json({ ad });
  }
  router.post('/ads', saveAd);
  router.patch('/ads/:id', saveAd);
  router.delete('/ads/:id', async (req, res) => {
    await transaction(pool, req.admin.userId, async client => {
      const adId = id(req.params.id);
      const result = await client.query(`UPDATE public.ads SET status = 'DELETED', deleted_at = CURRENT_TIMESTAMP,
        deletion_reason = NULL WHERE id = $1 AND status = 'PUBLISHED' RETURNING id`, [adId]);
      if (!result.rows.length) fail(404, 'AD_NOT_FOUND');
      await client.query(`INSERT INTO public.admin_actions(admin_user_id, action, target_ad_id)
        VALUES ($1, 'DELETE_AD', $2)`, [req.admin.userId, adId]);
    });
    res.status(204).end();
  });
  return router;
}

module.exports = { createAdminAdsRouter };
