const request = require('supertest');
const { createTestPool } = require('./helpers/testDb');
const { createTestApp } = require('./helpers/testApp');

test('serves the frontend from public/index.html', async () => {
  const pool = await createTestPool();
  const app = createTestApp(pool);

  const res = await request(app).get('/');

  expect(res.status).toBe(200);
  expect(res.text).toContain('Merchant Tools');

  await pool.end();
});

test('does not send a Content-Security-Policy header (frontend relies on inline scripts)', async () => {
  const pool = await createTestPool();
  const app = createTestApp(pool);

  const res = await request(app).get('/');

  expect(res.headers['content-security-policy']).toBeUndefined();

  await pool.end();
});
