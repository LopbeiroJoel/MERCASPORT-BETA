const express = require('express');
const { requireAdmin } = require('../admin/permissions');
const { auth, wrap, body, id, fail, transaction, audit, errors } = require('../messaging/core');

function createRecruitmentAdminRouter(pool, sessions) {
  const router = express.Router();
  router.use(
    ['/reports', '/club-memberships'],
    auth(sessions),
    requireAdmin(pool, sessions),
    express.json({ limit: '4kb' })
  );
  router.get(
    '/reports',
    wrap(async (req, res) => {
      const status = req.query.status || 'OPEN';
      if (!['OPEN', 'RESOLVED', 'DISMISSED'].includes(status)) fail(400, 'INVALID_STATUS');
      const before = req.query.before ? id(req.query.before) : 2147483647;
      const rows = (
        await pool.query(
          `SELECT r.*,u.username AS reporter_name,t.username AS reported_name,m.message_body
    FROM reports r LEFT JOIN users u ON u.id=r.reporter_user_id LEFT JOIN users t ON t.id=r.reported_user_id LEFT JOIN messages m ON m.id=r.message_id
    WHERE r.status_code=$1 AND r.id<$2 ORDER BY r.id DESC LIMIT 31`,
          [status, before]
        )
      ).rows;
      res.json({ items: rows.slice(0, 30), next: rows.length > 30 ? rows[29].id : null });
    })
  );
  router.patch(
    '/reports/:id',
    wrap(async (req, res) => {
      body(req.body, ['status_code']);
      if (!['RESOLVED', 'DISMISSED'].includes(req.body.status_code)) fail(400, 'INVALID_STATUS');
      await transaction(pool, req.identity.userId, async (c) => {
        const found = await c.query(
          'UPDATE reports SET status_code=$2,resolved_at=now() WHERE id=$1 RETURNING id',
          [id(req.params.id), req.body.status_code]
        );
        if (!found.rows.length) fail(404, 'REPORT_NOT_FOUND');
        await audit(c, req.identity.userId, 'RESOLVE_REPORT', 'report', req.params.id);
      });
      res.status(204).end();
    })
  );
  router.get(
    '/club-memberships',
    wrap(async (req, res) => {
      res.json({
        items: (
          await pool.query(
            `SELECT m.user_id,m.club_id,m.is_active,u.username,c.name FROM club_memberships m JOIN users u ON u.id=m.user_id JOIN clubs c ON c.id=m.club_id ORDER BY c.name,u.username LIMIT 100`
          )
        ).rows
      });
    })
  );
  router.post(
    '/club-memberships',
    wrap(async (req, res) => {
      body(req.body, ['user_id', 'club_id', 'is_active']);
      const userId = id(req.body.user_id),
        clubId = id(req.body.club_id);
      if (typeof req.body.is_active !== 'boolean') fail(400, 'INVALID_FIELD');
      await transaction(pool, req.identity.userId, async (c) => {
        if (!(await c.query('SELECT id FROM clubs WHERE id=$1 FOR UPDATE', [clubId])).rows.length)
          fail(404, 'CLUB_NOT_FOUND');
        if (
          !(await c.query("SELECT id FROM users WHERE id=$1 AND status='ACTIVE'", [userId])).rows
            .length
        )
          fail(404, 'USER_NOT_FOUND');
        if (
          req.body.is_active &&
          (
            await c.query(
              'SELECT count(*)::int AS n FROM club_memberships WHERE club_id=$1 AND is_active AND user_id<>$2',
              [clubId, userId]
            )
          ).rows[0].n >= 20
        )
          fail(400, 'MEMBERSHIP_LIMIT');
        await c.query(
          'INSERT INTO club_memberships(user_id,club_id,is_active) VALUES($1,$2,$3) ON CONFLICT(user_id,club_id) DO UPDATE SET is_active=EXCLUDED.is_active',
          [userId, clubId, req.body.is_active]
        );
        await audit(c, req.identity.userId, 'CLUB_MEMBERSHIP', 'club', clubId);
      });
      res.status(201).json({ user_id: userId, club_id: clubId, is_active: req.body.is_active });
    })
  );
  router.use(errors);
  return router;
}
module.exports = { createRecruitmentAdminRouter };
