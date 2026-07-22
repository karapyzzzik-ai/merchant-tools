const request = require('supertest');
const { createTestPool } = require('../helpers/testDb');
const { createTestApp } = require('../helpers/testApp');
const { createUser } = require('../../server/db/users');

let pool;
let app;
let agent;
let csrfToken;

function getCsrfToken(res) {
  const cookies = res.headers['set-cookie'] || [];
  const csrfCookie = cookies.find((c) => c.startsWith('csrfToken='));
  return csrfCookie ? csrfCookie.split(';')[0].split('=')[1] : null;
}

beforeAll(async () => {
  pool = await createTestPool();
  await createUser(pool, 'operator1', 'CorrectHorseBatteryStaple1');
  app = createTestApp(pool);
  agent = request.agent(app);
  const login = await agent.post('/api/login').send({ username: 'operator1', password: 'CorrectHorseBatteryStaple1' });
  csrfToken = getCsrfToken(login);
});

afterAll(async () => {
  await pool.end();
});

test('GET /api/integration/:type requires a session', async () => {
  const res = await request(app).get('/api/integration/api');
  expect(res.status).toBe(401);
});

test('returns an empty checklist for a freshly seeded type', async () => {
  const res = await agent.get('/api/integration/api');
  expect(res.status).toBe(200);
  expect(res.body).toEqual({ checks: {} });
});

test('rejects an unknown type', async () => {
  const res = await agent.get('/api/integration/bogus');
  expect(res.status).toBe(400);
});

test('saves and reloads checklist state for a type', async () => {
  const put = await agent
    .put('/api/integration/mall')
    .set('X-CSRF-Token', csrfToken)
    .send({ checks: { mall_docs_asel: true, mall_b2b_merchants: false } });
  expect(put.status).toBe(200);
  expect(put.body).toEqual({ checks: { mall_docs_asel: true, mall_b2b_merchants: false } });

  const get = await agent.get('/api/integration/mall');
  expect(get.body).toEqual({ checks: { mall_docs_asel: true, mall_b2b_merchants: false } });
});

test('PUT without a csrf token is rejected', async () => {
  const res = await agent.put('/api/integration/api').send({ checks: {} });
  expect(res.status).toBe(403);
});
