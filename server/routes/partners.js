const express = require('express');
const { z } = require('zod');
const { PARTNER_TYPES, STAGES } = require('../constants');
const { asyncHandler } = require('../middleware/asyncHandler');

const router = express.Router();

const createSchema = z.object({
  name: z.string().min(1).max(200),
  type: z.enum(PARTNER_TYPES)
}).strict();

const patchSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  type: z.enum(PARTNER_TYPES).optional(),
  stage: z.enum(STAGES).optional(),
  checks: z.record(z.string(), z.boolean()).optional()
}).strict();

router.get('/', asyncHandler(async (req, res) => {
  const pool = req.app.locals.pool;
  const result = await pool.query('SELECT * FROM partners ORDER BY created_at');
  res.json(result.rows);
}));

// Registered before any potential future GET /:id route — a literal path
// like this one must come first, or an :id-style pattern would swallow
// "with-analyses" as if it were an id.
router.get('/with-analyses', asyncHandler(async (req, res) => {
  const pool = req.app.locals.pool;
  const result = await pool.query(
    `SELECT p.id, p.name, p.type, MAX(fa.created_at) AS last_checked_at
     FROM partners p
     JOIN feed_analyses fa ON fa.partner_id = p.id
     GROUP BY p.id, p.name, p.type
     ORDER BY last_checked_at DESC`
  );
  res.json(result.rows);
}));

router.post('/', asyncHandler(async (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'invalid request body' });
  }
  const { name, type } = parsed.data;
  const pool = req.app.locals.pool;
  const result = await pool.query(
    'INSERT INTO partners (name, type) VALUES ($1, $2) RETURNING *',
    [name, type]
  );
  res.status(201).json(result.rows[0]);
}));

router.patch('/:id', asyncHandler(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) {
    return res.status(400).json({ error: 'invalid id' });
  }
  const parsed = patchSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'invalid request body' });
  }
  const fields = parsed.data;
  const columns = Object.keys(fields);
  if (columns.length === 0) {
    return res.status(400).json({ error: 'no fields to update' });
  }

  const setClauses = columns.map((col, i) => col + ' = $' + (i + 2));
  const values = columns.map((col) => fields[col]);
  const sql = 'UPDATE partners SET ' + setClauses.join(', ') + ', updated_at = now() WHERE id = $1 RETURNING *';

  const pool = req.app.locals.pool;
  const result = await pool.query(sql, [id, ...values]);
  if (result.rows.length === 0) {
    return res.status(404).json({ error: 'partner not found' });
  }
  res.json(result.rows[0]);
}));

router.delete('/:id', asyncHandler(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) {
    return res.status(400).json({ error: 'invalid id' });
  }
  const pool = req.app.locals.pool;
  const result = await pool.query('DELETE FROM partners WHERE id = $1', [id]);
  if (result.rowCount === 0) {
    return res.status(404).json({ error: 'partner not found' });
  }
  res.status(204).end();
}));

module.exports = router;
