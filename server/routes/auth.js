const express = require('express');
const { z } = require('zod');
const { findUserByUsername, verifyPassword } = require('../db/users');
const { createLoginLimiter } = require('../middleware/rateLimit');
const { asyncHandler } = require('../middleware/asyncHandler');
const { verifyCsrf } = require('../middleware/csrf');
const { requireAuth } = require('../middleware/requireAuth');

const loginSchema = z.object({
  username: z.string().min(1).max(100),
  password: z.string().min(1).max(200)
}).strict();

function createAuthRouter(pool) {
  const router = express.Router();
  const loginLimiter = createLoginLimiter(pool);

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

  // POST /api/login is the one documented exception to "every mutating
  // request requires CSRF" (there's no session yet to protect). Every
  // other mutating auth route — just /logout here — still needs it.
  router.post('/logout', verifyCsrf, (req, res) => {
    req.session.destroy(() => {
      res.clearCookie('connect.sid');
      res.json({ ok: true });
    });
  });

  // Reuses requireAuth (Task 5) rather than re-implementing the same
  // session check inline, so the two never drift out of sync.
  router.get('/me', requireAuth, (req, res) => {
    res.json({ username: req.session.username });
  });

  return router;
}

module.exports = { createAuthRouter };
