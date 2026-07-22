const express = require('express');
const session = require('express-session');
const request = require('supertest');
const { requireAuth } = require('../../server/middleware/requireAuth');

function buildTestApp() {
  const app = express();
  app.use(session({ secret: 'test', resave: false, saveUninitialized: false, store: new session.MemoryStore() }));
  app.get('/whoami', requireAuth, (req, res) => res.json({ userId: req.session.userId }));
  app.post('/login-as/:id', (req, res) => {
    req.session.userId = parseInt(req.params.id, 10);
    res.json({ ok: true });
  });
  return app;
}

test('rejects requests with no session user', async () => {
  const app = buildTestApp();
  const res = await request(app).get('/whoami');
  expect(res.status).toBe(401);
});

test('allows requests once session.userId is set', async () => {
  const app = buildTestApp();
  const agent = request.agent(app);
  await agent.post('/login-as/42').send({});
  const res = await agent.get('/whoami');
  expect(res.status).toBe(200);
  expect(res.body).toEqual({ userId: 42 });
});
