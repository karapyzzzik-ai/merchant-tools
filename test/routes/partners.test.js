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

test('GET /api/partners requires a session', async () => {
  const res = await request(app).get('/api/partners');
  expect(res.status).toBe(401);
});

test('creating a partner requires a csrf token', async () => {
  const res = await agent.post('/api/partners').send({ name: 'Adidas KZ', type: 'api' });
  expect(res.status).toBe(403);
});

test('creates, lists, updates and deletes a partner', async () => {
  const created = await agent
    .post('/api/partners')
    .set('X-CSRF-Token', csrfToken)
    .send({ name: 'Adidas KZ', type: 'api' });
  expect(created.status).toBe(201);
  expect(created.body).toMatchObject({ name: 'Adidas KZ', type: 'api', stage: 's0', checks: {} });
  const id = created.body.id;

  const list = await agent.get('/api/partners');
  expect(list.body.some((p) => p.id === id)).toBe(true);

  const updated = await agent
    .patch('/api/partners/' + id)
    .set('X-CSRF-Token', csrfToken)
    .send({ stage: 's3', checks: { api_docs_asel: true } });
  expect(updated.status).toBe(200);
  expect(updated.body.stage).toBe('s3');
  expect(updated.body.checks).toEqual({ api_docs_asel: true });

  const deleted = await agent.delete('/api/partners/' + id).set('X-CSRF-Token', csrfToken);
  expect(deleted.status).toBe(204);

  const listAfter = await agent.get('/api/partners');
  expect(listAfter.body.some((p) => p.id === id)).toBe(false);
});

test('rejects an unknown partner type', async () => {
  const res = await agent
    .post('/api/partners')
    .set('X-CSRF-Token', csrfToken)
    .send({ name: 'Bad Type Co', type: 'invalid' });
  expect(res.status).toBe(400);
});

test('PATCH on a nonexistent partner returns 404', async () => {
  const res = await agent
    .patch('/api/partners/999999')
    .set('X-CSRF-Token', csrfToken)
    .send({ stage: 's1' });
  expect(res.status).toBe(404);
});
