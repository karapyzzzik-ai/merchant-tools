const { newDb } = require('pg-mem');
const fs = require('fs');
const path = require('path');

async function createTestPool() {
  const db = newDb();
  const { Pool } = db.adapters.createPg();
  const pool = new Pool();
  const sql = fs.readFileSync(path.join(__dirname, '../../server/db/schema.sql'), 'utf8');
  await pool.query(sql);
  return pool;
}

module.exports = { createTestPool };
