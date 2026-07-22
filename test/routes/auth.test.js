const request = require('supertest');
const { createTestPool } = require('../helpers/testDb');
const { createTestApp } = require('../helpers/testApp');
const { createUser } = require('../../server/db/users');

let pool;
let app;

beforeAll(async () => {
  pool = await createTestPool();
  await createUser(pool, 'operator1', 'CorrectHorseBatteryStaple1');
});

beforeEach(() => {
  app = createTestApp(pool);
});

afterAll(async () => {
  await pool.end();
});

test('rejects login with wrong password', async () => {
  const res = await request(app).post('/api/login').send({ username: 'operator1', password: 'wrong' });
  expect(res.status).toBe(401);
});

test('GET /api/me is 401 before login', async () => {
  const res = await request(app).get('/api/me');
  expect(res.status).toBe(401);
});

test('logs in with correct credentials and reaches /api/me', async () => {
  const agent = request.agent(app);
  const login = await agent.post('/api/login').send({ username: 'operator1', password: 'CorrectHorseBatteryStaple1' });
  expect(login.status).toBe(200);
  expect(login.body).toEqual({ username: 'operator1' });

  const me = await agent.get('/api/me');
  expect(me.status).toBe(200);
  expect(me.body).toEqual({ username: 'operator1' });
});

test('logout ends the session', async () => {
  const agent = request.agent(app);
  await agent.post('/api/login').send({ username: 'operator1', password: 'CorrectHorseBatteryStaple1' });
  await agent.post('/api/logout').send({});

  const me = await agent.get('/api/me');
  expect(me.status).toBe(401);
});

test('locks out after 5 failed attempts', async () => {
  const agent = request.agent(app);
  for (let i = 0; i < 5; i++) {
    await agent.post('/api/login').send({ username: 'operator1', password: 'wrong' });
  }
  const res = await agent.post('/api/login').send({ username: 'operator1', password: 'wrong' });
  expect(res.status).toBe(429);
});
