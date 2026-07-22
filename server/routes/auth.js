const express = require('express');
const { z } = require('zod');
const { findUserByUsername, verifyPassword } = require('../db/users');
const { createLoginLimiter } = require('../middleware/rateLimit');
const { asyncHandler } = require('../middleware/asyncHandler');

const loginSchema = z.object({
  username: z.string().min(1).max(100),
  password: z.string().min(1).max(200)
}).strict();

function createAuthRouter() {
  const router = express.Router();
  const loginLimiter = createLoginLimiter();

  router.post('/login', loginLimiter, asyncHandler(async (req, res) => {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'invalid request body' });
    }

    const { username, password } = parsed.data;
    const pool = req.app.locals.pool;
    const user = await findUserByUsername(pool, username);
    const valid = await verifyPassword(user, password);

    if (!valid) {
      return res.status(401).json({ error: 'invalid credentials' });
    }

    req.session.regenerate((err) => {
      if (err) return res.status(500).json({ error: 'login failed' });
      req.session.userId = user.id;
      req.session.username = user.username;
      res.json({ username: user.username });
    });
  }));

  router.post('/logout', (req, res) => {
    req.session.destroy(() => {
      res.clearCookie('connect.sid');
      res.json({ ok: true });
    });
  });

  router.get('/me', (req, res) => {
    if (!req.session || !req.session.userId) {
      return res.status(401).json({ error: 'unauthorized' });
    }
    res.json({ username: req.session.username });
  });

  return router;
}

module.exports = { createAuthRouter };
