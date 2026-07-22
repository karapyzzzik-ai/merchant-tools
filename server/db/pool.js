const { Pool } = require('pg');

function createPool(connectionString) {
  return new Pool({
    connectionString,
    // Vercel serverless functions can spin up many concurrent instances,
    // each with its own pool — keep per-instance size small so they don't
    // collectively exhaust the database's connection limit. Use the DB
    // provider's pooled connection string (Neon/Supabase both offer one)
    // for the runtime DATABASE_URL so this compounds safely.
    max: 5
  });
}

module.exports = { createPool };
