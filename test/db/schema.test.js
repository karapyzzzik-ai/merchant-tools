const { createTestPool } = require('../helpers/testDb');

test('schema creates the expected tables and seeds integration_checklist', async () => {
  const pool = await createTestPool();

  const tables = await pool.query(
    "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name"
  );
  expect(tables.rows.map((r) => r.table_name)).toEqual(['integration_checklist', 'partners', 'session', 'users']);

  const seeded = await pool.query('SELECT type FROM integration_checklist ORDER BY type');
  expect(seeded.rows.map((r) => r.type)).toEqual(['api', 'mall']);

  await pool.end();
});
