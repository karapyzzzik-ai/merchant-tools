const request = require('supertest');
const { createTestPool } = require('../helpers/testDb');
const { createTestApp } = require('../helpers/testApp');
const { createUser } = require('../../server/db/users');

let pool;
let app;
let agent;
let csrfToken;
let partnerId;

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

  const partner = await agent
    .post('/api/partners')
    .set('X-CSRF-Token', csrfToken)
    .send({ name: 'Xiaomi KZ', type: 'api' });
  partnerId = partner.body.id;
});

afterAll(async () => {
  await pool.end();
});

test('GET /api/feed-analyses/latest requires a session', async () => {
  const res = await request(app).get('/api/feed-analyses/latest?partner_id=' + partnerId);
  expect(res.status).toBe(401);
});

test('latest returns null when the partner has no analyses yet', async () => {
  const res = await agent.get('/api/feed-analyses/latest?partner_id=' + partnerId);
  expect(res.status).toBe(200);
  expect(res.body).toEqual({ analysis: null });
});

test('creating an analysis requires a csrf token', async () => {
  const res = await agent
    .post('/api/feed-analyses')
    .send({ partner_id: partnerId, format: 'xml', metrics: { total: 10 } });
  expect(res.status).toBe(403);
});

test('creates an analysis and it becomes the latest', async () => {
  const created = await agent
    .post('/api/feed-analyses')
    .set('X-CSRF-Token', csrfToken)
    .send({ partner_id: partnerId, format: 'xml', metrics: { total: 10, inStock: 8 } });
  expect(created.status).toBe(201);
  expect(created.body).toMatchObject({ partner_id: partnerId, format: 'xml', metrics: { total: 10, inStock: 8 } });

  const latest = await agent.get('/api/feed-analyses/latest?partner_id=' + partnerId);
  expect(latest.status).toBe(200);
  expect(latest.body.analysis).toMatchObject({ format: 'xml', metrics: { total: 10, inStock: 8 } });
});

test('a second analysis becomes the new latest', async () => {
  await agent
    .post('/api/feed-analyses')
    .set('X-CSRF-Token', csrfToken)
    .send({ partner_id: partnerId, format: 'xlsx', metrics: { total: 12 } });

  const latest = await agent.get('/api/feed-analyses/latest?partner_id=' + partnerId);
  expect(latest.body.analysis).toMatchObject({ format: 'xlsx', metrics: { total: 12 } });
});

test('rejects an unknown format', async () => {
  const res = await agent
    .post('/api/feed-analyses')
    .set('X-CSRF-Token', csrfToken)
    .send({ partner_id: partnerId, format: 'csv', metrics: { total: 1 } });
  expect(res.status).toBe(400);
});

test('rejects an analysis for a nonexistent partner', async () => {
  const res = await agent
    .post('/api/feed-analyses')
    .set('X-CSRF-Token', csrfToken)
    .send({ partner_id: 999999, format: 'xml', metrics: { total: 1 } });
  expect(res.status).toBe(400);
});
