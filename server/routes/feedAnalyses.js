const express = require('express');
const { z } = require('zod');
const { FEED_FORMATS } = require('../constants');
const { asyncHandler } = require('../middleware/asyncHandler');

const router = express.Router();

const createSchema = z.object({
  partner_id: z.number().int().positive(),
  format: z.enum(FEED_FORMATS),
  metrics: z.record(z.string(), z.number())
}).strict();

router.post('/', asyncHandler(async (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'invalid request body' });
  }
  const { partner_id, format, metrics } = parsed.data;
  const pool = req.app.locals.pool;
  try {
    const result = await pool.query(
      'INSERT INTO feed_analyses (partner_id, format, metrics) VALUES ($1, $2, $3) RETURNING *',
      [partner_id, format, metrics]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    // Real Postgres sets err.code === '23503' (foreign_key_violation) with a
    // message containing "violates foreign key constraint". pg-mem (used in
    // tests) doesn't set .code on this error, but does include the same
    // message text, so match on that as a fallback.
    const isFkViolation = err.code === '23503' || /violates foreign key constraint/i.test(err.message || '');
    if (isFkViolation) {
      return res.status(400).json({ error: 'partner not found' });
    }
    throw err;
  }
}));

router.get('/latest', asyncHandler(async (req, res) => {
  const partnerId = parseInt(req.query.partner_id, 10);
  if (Number.isNaN(partnerId)) {
    return res.status(400).json({ error: 'invalid partner_id' });
  }
  const pool = req.app.locals.pool;
  const result = await pool.query(
    'SELECT * FROM feed_analyses WHERE partner_id = $1 ORDER BY created_at DESC LIMIT 1',
    [partnerId]
  );
  res.json({ analysis: result.rows[0] || null });
}));

module.exports = router;
