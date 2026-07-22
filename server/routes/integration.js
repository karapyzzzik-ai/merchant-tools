const express = require('express');
const { z } = require('zod');
const { PARTNER_TYPES } = require('../constants');
const { asyncHandler } = require('../middleware/asyncHandler');

const router = express.Router();

const putSchema = z.object({
  checks: z.record(z.string(), z.boolean())
}).strict();

router.get('/:type', asyncHandler(async (req, res) => {
  const { type } = req.params;
  if (!PARTNER_TYPES.includes(type)) {
    return res.status(400).json({ error: 'invalid type' });
  }
  const pool = req.app.locals.pool;
  const result = await pool.query('SELECT checks FROM integration_checklist WHERE type = $1', [type]);
  if (result.rows.length === 0) {
    return res.json({ checks: {} });
  }
  res.json({ checks: result.rows[0].checks });
}));

router.put('/:type', asyncHandler(async (req, res) => {
  const { type } = req.params;
  if (!PARTNER_TYPES.includes(type)) {
    return res.status(400).json({ error: 'invalid type' });
  }
  const parsed = putSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'invalid request body' });
  }
  const pool = req.app.locals.pool;
  const result = await pool.query(
    'UPDATE integration_checklist SET checks = $1, updated_at = now() WHERE type = $2 RETURNING checks',
    [parsed.data.checks, type]
  );
  res.json({ checks: result.rows[0].checks });
}));

module.exports = router;
