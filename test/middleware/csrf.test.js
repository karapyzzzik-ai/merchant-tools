const express = require('express');
const cookieParser = require('cookie-parser');
const request = require('supertest');
const { issueCsrfCookie, verifyCsrf } = require('../../server/middleware/csrf');

function buildTestApp() {
  const app = express();
  app.use(cookieParser());
  app.use(issueCsrfCookie);
  app.post('/protected', verifyCsrf, (req, res) => res.json({ ok: true }));
  return app;
}

test('issueCsrfCookie sets a csrfToken cookie on every response', async () => {
  const app = buildTestApp();
  const res = await request(app).get('/');
  expect(res.headers['set-cookie'].some((c) => c.startsWith('csrfToken='))).toBe(true);
});

test('verifyCsrf rejects a mutating request with no csrf header', async () => {
  const app = buildTestApp();
  const agent = request.agent(app);
  await agent.get('/');
  const res = await agent.post('/protected').send({});
  expect(res.status).toBe(403);
});

test('verifyCsrf accepts a mutating request with matching cookie and header', async () => {
  const app = buildTestApp();
  const agent = request.agent(app);
  const first = await agent.get('/');
  const cookieHeader = first.headers['set-cookie'].find((c) => c.startsWith('csrfToken='));
  const token = cookieHeader.split(';')[0].split('=')[1];

  const res = await agent.post('/protected').set('X-CSRF-Token', token).send({});
  expect(res.status).toBe(200);
  expect(res.body).toEqual({ ok: true });
});
