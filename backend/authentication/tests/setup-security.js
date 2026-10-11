const fs = require('node:fs/promises');
const path = require('node:path');
async function applyTestSecuritySchema(pool) {
  const sql = await fs.readFile(path.join(__dirname, '../security.sql'), 'utf8');
  for (const statement of sql.split(';')) if (statement.trim()) await pool.query(statement);
}
module.exports = { applyTestSecuritySchema };
