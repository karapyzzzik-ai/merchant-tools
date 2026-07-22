require('dotenv').config();
const { createPool } = require('../db/pool');

async function main() {
  const password = process.argv[2];
  if (!password) {
    console.error('Usage: node server/scripts/create-restricted-role.js <password>');
    process.exit(1);
  }

  // CREATE ROLE ... PASSWORD doesn't accept a bind parameter, so the value
  // is interpolated directly into the SQL text below. That's only safe
  // because we require it to be a hex string (e.g. from
  // crypto.randomBytes(24).toString('hex')) with no quote/SQL
  // metacharacters possible — enforce that here rather than trusting callers.
  if (!/^[0-9a-f]+$/i.test(password)) {
    console.error('Password must be a hex string (e.g. from crypto.randomBytes(24).toString(\'hex\')) — refusing to interpolate an arbitrary value into SQL.');
    process.exit(1);
  }

  const connectionString = process.env.MIGRATION_DATABASE_URL || process.env.DATABASE_URL;
  const pool = createPool(connectionString);
  const dbName = new URL(connectionString).pathname.replace(/^\//, '');

  try {
    await pool.query(
      "DO $do$ BEGIN IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'merchant_tools_app') THEN " +
      "CREATE ROLE merchant_tools_app WITH LOGIN PASSWORD '" + password + "'; END IF; END $do$;"
    );
    await pool.query('GRANT CONNECT ON DATABASE "' + dbName + '" TO merchant_tools_app');
    await pool.query('GRANT USAGE ON SCHEMA public TO merchant_tools_app');
    await pool.query('GRANT SELECT, INSERT, UPDATE, DELETE ON users, partners, integration_checklist, session, rate_limits TO merchant_tools_app');
    await pool.query('GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO merchant_tools_app');
    console.log('Role merchant_tools_app created/verified with restricted grants on database ' + dbName);
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error('Failed:', err.message);
  process.exit(1);
});
