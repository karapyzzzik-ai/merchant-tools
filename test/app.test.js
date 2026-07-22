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

test('malformed JSON body returns 400, not 500', async () => {
  const pool = await createTestPool();
  const app = createTestApp(pool);

  const res = await request(app)
    .post('/api/login')
    .set('Content-Type', 'application/json')
    .send('{not valid json');

  expect(res.status).toBe(400);
  expect(res.body).toEqual({ error: 'invalid request body' });

  await pool.end();
});

test('sends helmet security headers but no Content-Security-Policy', async () => {
  const pool = await createTestPool();
  const app = createTestApp(pool);

  const res = await request(app).get('/');

  expect(res.headers['x-content-type-options']).toBe('nosniff');
  expect(res.headers['content-security-policy']).toBeUndefined();

  await pool.end();
});
