const express = require('express');
const core = require('../messaging/core');
const ads = require('./ads');
const applications = require('./applications');
const { wrap, auth, limiter, transaction, body, id, fail } = core;

function createRecruitmentRouter(pool, sessions) {
  const router = express.Router(),
    A = auth(sessions),
    R = express.json({ limit: '16kb' });
  const tx = (req, fn) => transaction(pool, req.identity.userId, fn);
  router.get(
    '/recruitment/options',
    wrap(async (req, res) =>
      res.set('Cache-Control', 'public, max-age=300').json(await ads.options(pool))
    )
  );
  router.get(
    '/ads',
    wrap(async (req, res, next) => {
      if (req.query.view !== 'market') return next();
      const identity = sessions ? await sessions.authenticate(req) : null;
      res.set('Cache-Control', 'no-store').json(await ads.list(pool, req.query, identity));
    })
  );
  router.get(
    '/ads/:id',
    wrap(async (req, res, next) => {
      if (req.query.view !== 'market') return next();
      const identity = sessions ? await sessions.authenticate(req) : null;
      res.set('Cache-Control', 'no-store').json(await ads.detail(pool, req.params.id, identity));
    })
  );
  // L'ancien formulaire de publication reste compatible : seuls les nouveaux contrats sont pris ici.
  router.post(
    '/ads',
    R,
    (req, res, next) => {
      if (!req.body?.announcement_type) return next('route');
      next();
    },
    A,
    limiter(pool, sessions, 'publish-market', 15, 3600000),
    wrap(async (req, res) =>
      res.status(201).json(await tx(req, (c) => ads.save(c, req.identity, req.body)))
    )
  );
  router.patch(
    '/ads/:id',
    A,
    R,
    limiter(pool, sessions, 'edit-market', 60, 3600000),
    wrap(async (req, res) =>
      res.json(await tx(req, (c) => ads.save(c, req.identity, req.body, req.params.id)))
    )
  );
  router.post(
    '/ads/:id/renew',
    A,
    R,
    wrap(async (req, res) => {
      body(req.body, []);
      res.json(await tx(req, (c) => ads.renew(c, req.identity, req.params.id)));
    })
  );
  router.post(
    '/ads/:id/applications',
    A,
    R,
    limiter(pool, sessions, 'apply', 20, 3600000),
    wrap(async (req, res) => {
      const result = await tx(req, (c) =>
        applications.apply(c, req.identity, req.params.id, req.body)
      );
      res.status(result.created ? 201 : 200).json(result);
    })
  );
  router.get(
    '/applications',
    A,
    wrap(async (req, res) =>
      res.json(await applications.listApplications(pool, req.identity.userId, req.query))
    )
  );
  router.get(
    '/applications/:id',
    A,
    wrap(async (req, res) => {
      const application = await applications.applicationAccess(
        pool,
        req.identity.userId,
        req.params.id
      );
      const history = (
        await pool.query(
          'SELECT previous_status_code,new_status_code,created_at FROM application_status_history WHERE application_id=$1 ORDER BY id',
          [application.id]
        )
      ).rows;
      res.json({ application, history });
    })
  );
  router.patch(
    '/applications/:id',
    A,
    R,
    wrap(async (req, res) =>
      res.json(
        await tx(req, (c) => applications.changeStatus(c, req.identity, req.params.id, req.body))
      )
    )
  );
  router.use(core.errors);
  return router;
}
module.exports = { createRecruitmentRouter };
