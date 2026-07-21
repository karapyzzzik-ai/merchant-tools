require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { createPool } = require('./pool');

async function migrate() {
  // Prefers MIGRATION_DATABASE_URL: in production (Task 14) the app's own
  // DATABASE_URL is switched to a restricted role that lacks CREATE
  // privilege, so schema changes must run under the privileged connection.
  const connectionString = process.env.MIGRATION_DATABASE_URL || process.env.DATABASE_URL;
  const pool = createPool(connectionString);
  const sql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  await pool.query(sql);
  await pool.end();
  console.log('Schema applied successfully.');
}

migrate().catch((err) => {
  console.error('Migration failed:', err.message);
  process.exit(1);
});
