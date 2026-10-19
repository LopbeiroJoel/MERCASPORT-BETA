// Serveur de recette uniquement : comptes synthétiques, PostgreSQL jetable, aucun .env.
const express = require('express'),
  { Pool } = require('pg'),
  fs = require('node:fs');
const { configureApp } = require('../backend/app');
const { createSessionService } = require('../backend/authentication/session');
if (process.env.MESSAGING_ISOLATED_TEST !== '1' || !process.env.MESSAGING_BROWSER_STATE)
  throw new Error('Serveur réservé aux tests isolés.');
const pool = new Pool(),
  secret = 'a1234567890bcdef'.repeat(4),
  origin = 'http://localhost:3001';
async function main() {
  const sessions = createSessionService(pool, { secret, origins: [origin], allowLocalHttp: true }),
    state = {};
  for (const [role, name] of [
    ['PLAYER', 'JoueurRecette'],
    ['CLUB', 'ClubRecette'],
    ['ADMIN', 'AdminRecette']
  ]) {
    const user = (
      await pool.query(
        "INSERT INTO users(name,username,email,password_hash,role,status) VALUES($1,$1,$2,'fixture',$3,'ACTIVE') RETURNING *",
        [name, name + '@example.invalid', role]
      )
    ).rows[0];
    if (role === 'CLUB')
      user.clubId = (
        await pool.query('INSERT INTO clubs(user_id,name,city) VALUES($1,$2,$3) RETURNING id', [
          user.id,
          name,
          'Colmar'
        ])
      ).rows[0].id;
    if (role === 'PLAYER')
      await pool.query(
        'INSERT INTO player_profiles(user_id,first_name,last_name) VALUES($1,$2,$3)',
        [user.id, 'Joueur', 'Recette']
      );
    if (role === 'ADMIN')
      await pool.query("INSERT INTO admin_permissions(user_id,role) VALUES($1,'ADMIN')", [user.id]);
    await sessions.issue(user, {
      cookie: (name, value) =>
        (state[role] = {
          id: user.id,
          clubId: user.clubId,
          cookie: {
            name,
            value,
            domain: 'localhost',
            path: '/',
            httpOnly: true,
            secure: false,
            sameSite: 'Strict'
          }
        })
    });
  }
  const app = configureApp(express(), pool, { authSecret: secret, appOrigin: origin });
  const server = app.listen(3001, '0.0.0.0', () => {
    fs.writeFileSync(process.env.MESSAGING_BROWSER_STATE, JSON.stringify(state));
    console.log('Recette isolée : http://localhost:3001');
  });
  function stop() {
    server.closeAllConnections();
    server.close(async () => {
      await pool.end();
      process.exit();
    });
  }
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
}
main().catch((e) => {
  console.error(e.code || e.name);
  process.exitCode = 1;
});
