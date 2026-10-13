// PostgreSQL embarque jetable : aucun acces a Neon ni besoin de serveur local.
function createTestPool({ migrations = [] } = {}) {
  const { PGlite } = require('@electric-sql/pglite');
  const fs = require('node:fs/promises');
  const path = require('node:path');
  const db = new PGlite();
  const ready = (async () => {
    for (const name of ['schema.sql', 'seed.sql', 'registration.sql', 'registration.sql', 'player-positions.sql', 'admin.sql', ...migrations]) {
      await db.exec(await fs.readFile(path.join(__dirname, '../../../database', name), 'utf8'));
    }
  })();
  let queue = Promise.resolve();
  function acquire() {
    const previous = queue;
    let release;
    queue = new Promise(resolve => { release = resolve; });
    return previous.then(() => release);
  }
  return {
    exec: async sql => {
      await ready;
      const release = await acquire();
      try { return await db.exec(sql); } finally { release(); }
    },
    query: async (sql, values) => {
      await ready;
      const release = await acquire();
      try { return await db.query(sql, values); } finally { release(); }
    },
    connect: async () => {
      await ready;
      const release = await acquire();
      return { query: (sql, values) => db.query(sql, values), release };
    },
    end: async () => { await ready; await db.close(); },
  };
}
module.exports = { createTestPool };
