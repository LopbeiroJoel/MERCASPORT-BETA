// Manuel et gratuit : aperçu par défaut. --apply supprime réellement les éléments éligibles.
// Ne lance aucun ordonnanceur et n'affiche jamais le contenu des messages.
const pool = require('../backend/db');
async function main() {
  const apply = process.argv.includes('--apply'),
    client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SET LOCAL lock_timeout='3s'");
    await client.query('SELECT pg_advisory_xact_lock(621020)');
    const targets = {
      messages:
        "created_at<now()-interval '365 days' AND NOT EXISTS(SELECT 1 FROM reports r WHERE r.message_id=messages.id AND r.status_code='OPEN')",
      notifications: "(read_at<now()-interval '90 days' OR created_at<now()-interval '365 days')",
      reports: "status_code<>'OPEN' AND resolved_at<now()-interval '365 days'",
      recruitment_audit: "created_at<now()-interval '365 days'"
    };
    for (const [table, where] of Object.entries(targets)) {
      const count = (await client.query(`SELECT count(*)::int AS n FROM ${table} WHERE ${where}`))
        .rows[0].n;
      console.log(
        table +
          ': ' +
          count +
          ' élément(s) ' +
          (apply ? 'éligibles, suppression par lot de 1000' : 'éligibles (aperçu)')
      );
      if (apply)
        await client.query(
          `DELETE FROM ${table} WHERE id IN (SELECT id FROM ${table} WHERE ${where} ORDER BY id LIMIT 1000)`
        );
    }
    if (apply)
      await client.query(
        "UPDATE conversations c SET last_message_at=(SELECT max(m.created_at) FROM messages m WHERE m.conversation_id=c.id) WHERE last_message_at<now()-interval '365 days'"
      );
    await client.query(apply ? 'COMMIT' : 'ROLLBACK');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}
main().catch((error) => {
  console.error('Nettoyage interrompu :', error.code || error.name);
  process.exitCode = 1;
});
