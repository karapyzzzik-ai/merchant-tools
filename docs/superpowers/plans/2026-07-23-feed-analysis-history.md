# Feed Analysis History & Comparison Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a feed/Excel is uploaded to the Feed Analyzer, ask whether it's a new or repeat partner, save every analysis's aggregate metrics on the backend, and show a metric-by-metric comparison against a repeat partner's most recent previous check.

**Architecture:** One new table (`feed_analyses`) tied to the existing `partners` table via `partner_id`, two small REST endpoints reusing the existing `requireAuth`/`verifyCsrf`/pg-mem-test patterns already established for `/api/partners` and `/api/integration`, and a frontend pre-upload modal that gates the existing (unmodified) parse/render pipeline. No item-level data is stored — only the aggregate counts the analyzer already computes in `renderAnalytics()`.

**Tech Stack:** Same as the rest of the backend — Node.js/Express, `pg`, `zod`, `pg-mem` for tests. Frontend stays vanilla JS in `public/index.html`, no new dependencies.

## Global Constraints

- `feed_analyses.partner_id` references `partners.id` with `ON DELETE CASCADE` — deleting a partner from the kanban deletes its analysis history too.
- Comparison is always against the partner's single most recent previous analysis — there is no version picker. The table still stores full history for future use, but no endpoint in this plan exposes more than the latest row.
- `metrics` is a flat object of the aggregate counts `renderAnalytics()` already computes (e.g. `total`, `inStock`, `brandFilled`) — no raw per-item data is stored. Validated server-side as `Record<string, number>`.
- "Новый партнёр" creates a real row in the existing `partners` table (stage `s0`), identical to the kanban's own "Добавить партнёра" — it is the same entity, not a parallel one.
- "Повторный" only lists partners that already have ≥1 saved analysis (`GET /api/partners/with-analyses`), which is a different, smaller list than "all partners in the kanban".
- Before creating a partner via "Новый партнёр", warn (via `confirm()`) if a partner with the same name (case-insensitive) already exists in the kanban — prevents accidental duplicates for a partner that's in the kanban but has never had a feed check.
- "Пропустить" preserves today's behavior exactly: analyze with no partner link and no save.
- Auth/CSRF: identical pattern to `/api/partners` and `/api/integration` — `requireAuth` + `verifyCsrf` on the new router, mounted the same way in `server/app.js`.
- No automated frontend tests (no browser in this environment, same constraint as every prior frontend task in `docs/superpowers/plans/2026-07-21-backend-auth-storage.md`) — verify by code review, confirm by manual smoke test after deploy.

---

## File Structure

```
merchant-tools/
  server/
    constants.js                — add FEED_FORMATS
    db/
      schema.sql                 — add feed_analyses table + index
    routes/
      feedAnalyses.js             — new: POST /, GET /latest
      partners.js                  — add GET /with-analyses
    app.js                        — wire feedAnalyses router
  public/
    index.html                    — pre-upload partner modal, post-analysis save + comparison
  test/
    db/
      schema.test.js               — add feed_analyses table + FK checks
    routes/
      feedAnalyses.test.js          — new
      partners.test.js               — add with-analyses test
```

---

### Task 1: Schema and FEED_FORMATS constant

**Files:**
- Modify: `server/db/schema.sql`
- Modify: `server/constants.js`
- Modify: `test/db/schema.test.js`

**Interfaces:**
- Consumes: nothing new.
- Produces: `feed_analyses` table (columns: `id`, `partner_id`, `format`, `metrics`, `created_at`), `FEED_FORMATS` array from `server/constants.js` — used by Task 2's zod schema.

- [ ] **Step 1: Add the `feed_analyses` table to the schema**

Modify `server/db/schema.sql`. Find:
```sql
CREATE TABLE IF NOT EXISTS rate_limits (
  key      TEXT PRIMARY KEY,
  count    INTEGER NOT NULL DEFAULT 0,
  reset_at TIMESTAMPTZ NOT NULL
);
```
Replace with:
```sql
CREATE TABLE IF NOT EXISTS rate_limits (
  key      TEXT PRIMARY KEY,
  count    INTEGER NOT NULL DEFAULT 0,
  reset_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS feed_analyses (
  id         SERIAL PRIMARY KEY,
  partner_id INTEGER NOT NULL REFERENCES partners(id) ON DELETE CASCADE,
  format     TEXT NOT NULL CHECK (format IN ('xml', 'xlsx')),
  metrics    JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_feed_analyses_partner_created ON feed_analyses (partner_id, created_at DESC);
```

- [ ] **Step 2: Add `FEED_FORMATS` to constants**

Modify `server/constants.js`. Find:
```js
const PARTNER_TYPES = ['api', 'mall'];
const STAGES = ['s0', 's1', 's2', 's3', 's4', 's5', 's6', 's6b', 's7', 's8'];

module.exports = { PARTNER_TYPES, STAGES };
```
Replace with:
```js
const PARTNER_TYPES = ['api', 'mall'];
const STAGES = ['s0', 's1', 's2', 's3', 's4', 's5', 's6', 's6b', 's7', 's8'];
const FEED_FORMATS = ['xml', 'xlsx'];

module.exports = { PARTNER_TYPES, STAGES, FEED_FORMATS };
```

- [ ] **Step 3: Write the failing tests**

Modify `test/db/schema.test.js`. Find:
```js
const { createTestPool } = require('../helpers/testDb');

test('schema creates the expected tables and seeds integration_checklist', async () => {
  const pool = await createTestPool();

  const tables = await pool.query(
    "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name"
  );
  expect(tables.rows.map((r) => r.table_name)).toEqual(['integration_checklist', 'partners', 'rate_limits', 'session', 'users']);

  const seeded = await pool.query('SELECT type FROM integration_checklist ORDER BY type');
  expect(seeded.rows.map((r) => r.type)).toEqual(['api', 'mall']);

  await pool.end();
});
```
Replace with:
```js
const { createTestPool } = require('../helpers/testDb');

test('schema creates the expected tables and seeds integration_checklist', async () => {
  const pool = await createTestPool();

  const tables = await pool.query(
    "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name"
  );
  expect(tables.rows.map((r) => r.table_name)).toEqual(['feed_analyses', 'integration_checklist', 'partners', 'rate_limits', 'session', 'users']);

  const seeded = await pool.query('SELECT type FROM integration_checklist ORDER BY type');
  expect(seeded.rows.map((r) => r.type)).toEqual(['api', 'mall']);

  await pool.end();
});

test('rejects a feed_analyses row referencing a nonexistent partner', async () => {
  const pool = await createTestPool();
  await expect(
    pool.query(
      "INSERT INTO feed_analyses (partner_id, format, metrics) VALUES (999999, 'xml', '{}')"
    )
  ).rejects.toThrow();
  await pool.end();
});
```
This second test also empirically confirms whether `pg-mem` enforces foreign key constraints, which Task 2's error handling relies on — if it unexpectedly passes without the schema even having a working FK (i.e. the insert doesn't throw), stop and report this as a BLOCKED finding rather than proceeding to Task 2 assuming FK errors will surface there.

- [ ] **Step 4: Run the tests to verify they fail**

```powershell
"C:\Program Files\nodejs\node.exe" node_modules/jest/bin/jest.js test/db/schema.test.js
```
Expected: FAIL — the table list won't include `feed_analyses` yet, and the FK-rejection test's `INSERT` will fail differently (or not fail at all) before the table exists.

- [ ] **Step 5: Run the tests to verify they pass**

```powershell
"C:\Program Files\nodejs\node.exe" node_modules/jest/bin/jest.js test/db/schema.test.js
```
Expected: PASS (3 tests total in this file — the original two plus the new one).

- [ ] **Step 6: Run the full suite**

```powershell
"C:\Program Files\nodejs\node.exe" node_modules/jest/bin/jest.js
```
Expected: PASS, all suites.

- [ ] **Step 7: Commit**

```powershell
git add server/db/schema.sql server/constants.js test/db/schema.test.js
git commit -m "Add feed_analyses table and FEED_FORMATS constant"
```

---

### Task 2: Feed analyses API (create + latest)

**Files:**
- Create: `server/routes/feedAnalyses.js`
- Modify: `server/app.js`
- Test: `test/routes/feedAnalyses.test.js`

**Interfaces:**
- Consumes: `FEED_FORMATS` (Task 1), `requireAuth`/`verifyCsrf` (existing, from `docs/superpowers/plans/2026-07-21-backend-auth-storage.md`'s Tasks 4–5), `asyncHandler` (existing).
- Produces: `POST /api/feed-analyses` and `GET /api/feed-analyses/latest?partner_id=N` — consumed by Task 5's frontend code.

- [ ] **Step 1: Write the failing test**

Create `test/routes/feedAnalyses.test.js`:
```js
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
```

- [ ] **Step 2: Run the test to verify it fails**

```powershell
"C:\Program Files\nodejs\node.exe" node_modules/jest/bin/jest.js test/routes/feedAnalyses.test.js
```
Expected: FAIL — `/api/feed-analyses*` routes don't exist yet (404s).

- [ ] **Step 3: Write `server/routes/feedAnalyses.js`**

```js
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
    if (err.code === '23503') {
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
```
Note: `23503` is Postgres's standard `foreign_key_violation` error code. If this test fails with a different error shape (e.g. `err.code` is `undefined`, or `pg-mem` throws before your query even runs), that means `pg-mem`'s FK enforcement doesn't set `.code` the way real Postgres does — read the actual thrown error's properties and adjust the `catch` block's condition to match, rather than guessing further.

- [ ] **Step 4: Wire the router into the app**

Modify `server/app.js`. Find:
```js
const { createAuthRouter } = require('./routes/auth');
const partnersRoutes = require('./routes/partners');
const integrationRoutes = require('./routes/integration');
```
Replace with:
```js
const { createAuthRouter } = require('./routes/auth');
const partnersRoutes = require('./routes/partners');
const integrationRoutes = require('./routes/integration');
const feedAnalysesRoutes = require('./routes/feedAnalyses');
```

Find:
```js
  app.use('/api/partners', requireAuth, verifyCsrf, partnersRoutes);
  app.use('/api/integration', requireAuth, verifyCsrf, integrationRoutes);
```
Replace with:
```js
  app.use('/api/partners', requireAuth, verifyCsrf, partnersRoutes);
  app.use('/api/integration', requireAuth, verifyCsrf, integrationRoutes);
  app.use('/api/feed-analyses', requireAuth, verifyCsrf, feedAnalysesRoutes);
```

- [ ] **Step 5: Run the test to verify it passes**

```powershell
"C:\Program Files\nodejs\node.exe" node_modules/jest/bin/jest.js test/routes/feedAnalyses.test.js
```
Expected: PASS (7 tests).

- [ ] **Step 6: Run the full suite**

```powershell
"C:\Program Files\nodejs\node.exe" node_modules/jest/bin/jest.js
```
Expected: PASS, all suites.

- [ ] **Step 7: Commit**

```powershell
git add server/routes/feedAnalyses.js server/app.js test/routes/feedAnalyses.test.js
git commit -m "Add feed analyses create/latest API"
```

---

### Task 3: Partners-with-analyses endpoint

**Files:**
- Modify: `server/routes/partners.js`
- Modify: `test/routes/partners.test.js`

**Interfaces:**
- Consumes: `feed_analyses` table (Task 1), `POST /api/feed-analyses` (Task 2, used only by this task's test to create fixture data).
- Produces: `GET /api/partners/with-analyses` — consumed by Task 4's frontend "Повторный" list.

- [ ] **Step 1: Write the failing test**

Modify `test/routes/partners.test.js`. Find:
```js
test('PATCH on a nonexistent partner returns 404', async () => {
  const res = await agent
    .patch('/api/partners/999999')
    .set('X-CSRF-Token', csrfToken)
    .send({ stage: 's1' });
  expect(res.status).toBe(404);
});
```
Replace with:
```js
test('PATCH on a nonexistent partner returns 404', async () => {
  const res = await agent
    .patch('/api/partners/999999')
    .set('X-CSRF-Token', csrfToken)
    .send({ stage: 's1' });
  expect(res.status).toBe(404);
});

test('GET /api/partners/with-analyses lists only partners with saved analyses', async () => {
  const created = await agent
    .post('/api/partners')
    .set('X-CSRF-Token', csrfToken)
    .send({ name: 'Xiaomi KZ', type: 'api' });
  const id = created.body.id;

  const beforeAnalysis = await agent.get('/api/partners/with-analyses');
  expect(beforeAnalysis.status).toBe(200);
  expect(beforeAnalysis.body.some((p) => p.id === id)).toBe(false);

  await agent
    .post('/api/feed-analyses')
    .set('X-CSRF-Token', csrfToken)
    .send({ partner_id: id, format: 'xml', metrics: { total: 5 } });

  const afterAnalysis = await agent.get('/api/partners/with-analyses');
  const match = afterAnalysis.body.find((p) => p.id === id);
  expect(match).toBeDefined();
  expect(match.name).toBe('Xiaomi KZ');
  expect(match.last_checked_at).toBeTruthy();
});
```

- [ ] **Step 2: Run the test to verify it fails**

```powershell
"C:\Program Files\nodejs\node.exe" node_modules/jest/bin/jest.js test/routes/partners.test.js
```
Expected: FAIL — `GET /api/partners/with-analyses` 404s (no such route yet).

- [ ] **Step 3: Add the route**

Modify `server/routes/partners.js`. Find:
```js
router.get('/', asyncHandler(async (req, res) => {
  const pool = req.app.locals.pool;
  const result = await pool.query('SELECT * FROM partners ORDER BY created_at');
  res.json(result.rows);
}));
```
Replace with:
```js
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
```

- [ ] **Step 4: Run the test to verify it passes**

```powershell
"C:\Program Files\nodejs\node.exe" node_modules/jest/bin/jest.js test/routes/partners.test.js
```
Expected: PASS (6 tests).

- [ ] **Step 5: Run the full suite**

```powershell
"C:\Program Files\nodejs\node.exe" node_modules/jest/bin/jest.js
```
Expected: PASS, all suites.

- [ ] **Step 6: Commit**

```powershell
git add server/routes/partners.js test/routes/partners.test.js
git commit -m "Add GET /api/partners/with-analyses"
```

---

### Task 4: Frontend — pre-upload partner selection modal

**Files:**
- Modify: `public/index.html`

**Interfaces:**
- Consumes: `apiFetch` (existing), `partners` array (existing module-level state), `GET /api/partners/with-analyses` (Task 3), `POST /api/partners` (existing).
- Produces: module-level `pendingFeedFile`, `pendingFeedFormat`, `feedPartnerId`, `feedPartnerIsRepeat` variables and `runFeedAnalysis()` function — consumed by Task 5.

**No live-browser test is possible in this environment** — verify by re-reading the diff against the "Find" blocks below and confirming they match the file exactly, per the same constraint every prior frontend task in the auth/storage plan operated under.

- [ ] **Step 1: Add the partner-selection modal markup**

Find (the end of the existing "Добавить партнёра" modal, right before the card-detail modal):
```html
      <button class="btn" onclick="closeAddPartner()">Отмена</button>
      <button class="btn btn-primary" onclick="savePartner()">Добавить</button>
    </div>
  </div>
</div>

<!-- модалка карточки партнёра -->
<div id="modal-card" style="display:none; position:fixed; inset:0; background:rgba(0,0,0,.45); z-index:1000; align-items:center; justify-content:center;">
```
Replace with:
```html
      <button class="btn" onclick="closeAddPartner()">Отмена</button>
      <button class="btn btn-primary" onclick="savePartner()">Добавить</button>
    </div>
  </div>
</div>

<!-- модалка выбора партнёра перед анализом фида -->
<div id="modal-feed-partner" style="display:none; position:fixed; inset:0; background:rgba(0,0,0,.45); z-index:1000; align-items:center; justify-content:center;">
  <div style="background:var(--bg); border-radius:var(--r-lg); padding:2rem; width:400px; max-width:calc(100vw - 2rem); max-height:80vh; overflow-y:auto; box-shadow:0 8px 32px rgba(0,0,0,.18);">
    <div id="feed-partner-step-choose">
      <h3 style="margin:0 0 1.25rem; font-size:16px;">Для кого этот фид?</h3>
      <div style="display:flex;flex-direction:column;gap:8px;">
        <button class="btn btn-primary" onclick="showFeedPartnerStep('new')">Новый партнёр</button>
        <button class="btn" onclick="showFeedPartnerStep('repeat')">Повторный</button>
        <button class="btn" onclick="skipFeedPartnerSelection()">Пропустить</button>
      </div>
    </div>
    <div id="feed-partner-step-new" style="display:none;">
      <h3 style="margin:0 0 1.25rem; font-size:16px;">Новый партнёр</h3>
      <label style="font-size:13px;color:var(--text2);display:block;margin-bottom:4px;">Название партнёра</label>
      <input id="feed-partner-name-input" type="text" class="search-box" placeholder="Например: ТОО Romashka" style="margin-bottom:1rem;">
      <label style="font-size:13px;color:var(--text2);display:block;margin-bottom:4px;">Тип интеграции</label>
      <select id="feed-partner-type-input" class="search-box" style="margin-bottom:1.5rem;">
        <option value="api">API</option>
        <option value="mall">Mall</option>
      </select>
      <div style="display:flex;gap:8px;justify-content:flex-end;">
        <button class="btn" onclick="showFeedPartnerStep('choose')">Назад</button>
        <button class="btn btn-primary" onclick="createFeedPartnerAndAnalyze()">Создать и анализировать</button>
      </div>
    </div>
    <div id="feed-partner-step-repeat" style="display:none;">
      <h3 style="margin:0 0 1.25rem; font-size:16px;">Повторный партнёр</h3>
      <input id="feed-partner-search-input" type="text" class="search-box" placeholder="Поиск по названию…" style="margin-bottom:1rem;" oninput="renderFeedPartnerRepeatList()">
      <div id="feed-partner-repeat-list" style="max-height:280px;overflow-y:auto;"></div>
      <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:1rem;">
        <button class="btn" onclick="showFeedPartnerStep('choose')">Назад</button>
      </div>
    </div>
  </div>
</div>

<!-- модалка карточки партнёра -->
<div id="modal-card" style="display:none; position:fixed; inset:0; background:rgba(0,0,0,.45); z-index:1000; align-items:center; justify-content:center;">
```

- [ ] **Step 2: Add a date-formatting helper**

Find:
```js
function appReset() {
```
Replace with:
```js
function fmtDate(iso) {
  if (!iso) return '—';
  var d = new Date(iso);
  return d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function appReset() {
```

- [ ] **Step 3: Replace `processFile` with a pending-state trigger, and add `runFeedAnalysis`**

Find:
```js
function processFile(file, fmt) {
  log('processFile:', file.name, fmt);
  document.getElementById('fname').textContent = file.name + ' · ' + (file.size / 1024).toFixed(1) + ' КБ';
  document.getElementById('upload-zone').style.display = 'none';
  document.getElementById('feed-loader').style.display = 'block';
  var reader = new FileReader();
  reader.onerror = function() { logErr('FileReader error'); };
  if (fmt === 'xlsx') {
    reader.onload = function(e) {
      setTimeout(function() {
        try { showResult(parseXLSX(e.target.result)); }
        catch(ex) { logErr('parseXLSX: ' + ex.message); document.getElementById('feed-loader').style.display='none'; document.getElementById('upload-zone').style.display=''; }
      }, 50);
    };
    reader.readAsArrayBuffer(file);
  } else {
    reader.onload = function(e) {
      setTimeout(function() {
        try { showResult(parseXML(e.target.result)); }
        catch(ex) { logErr('parseXML: ' + ex.message); document.getElementById('feed-loader').style.display='none'; document.getElementById('upload-zone').style.display=''; }
      }, 50);
    };
    reader.readAsText(file, 'UTF-8');
  }
}
```
Replace with:
```js
var pendingFeedFile = null;
var pendingFeedFormat = null;
var feedPartnerId = null;
var feedPartnerIsRepeat = false;
var feedPartnerRepeatOptions = [];

function processFile(file, fmt) {
  pendingFeedFile = file;
  pendingFeedFormat = fmt;
  openFeedPartnerModal();
}

function openFeedPartnerModal() {
  document.getElementById('modal-feed-partner').style.display = 'flex';
  showFeedPartnerStep('choose');
}

function closeFeedPartnerModal() {
  document.getElementById('modal-feed-partner').style.display = 'none';
}

function showFeedPartnerStep(step) {
  ['choose', 'new', 'repeat'].forEach(function(s) {
    document.getElementById('feed-partner-step-' + s).style.display = s === step ? 'block' : 'none';
  });
  if (step === 'new') {
    document.getElementById('feed-partner-name-input').value = '';
  }
  if (step === 'repeat') {
    document.getElementById('feed-partner-search-input').value = '';
    loadFeedPartnerRepeatList();
  }
}

function skipFeedPartnerSelection() {
  feedPartnerId = null;
  feedPartnerIsRepeat = false;
  closeFeedPartnerModal();
  runFeedAnalysis();
}

function createFeedPartnerAndAnalyze() {
  var name = document.getElementById('feed-partner-name-input').value.trim();
  if (!name) { document.getElementById('feed-partner-name-input').focus(); return; }
  var isDuplicate = partners.some(function(p) { return p.name.trim().toLowerCase() === name.toLowerCase(); });
  if (isDuplicate && !confirm('Партнёр с таким именем уже есть в канбане — точно новый?')) {
    return;
  }
  var type = document.getElementById('feed-partner-type-input').value;
  apiFetch('/api/partners', { method: 'POST', body: JSON.stringify({ name: name, type: type }) })
    .then(function(res) { return res.json().then(function(body) { return { ok: res.ok, body: body }; }); })
    .then(function(result) {
      if (!result.ok) { logErr('Failed to create partner: ' + JSON.stringify(result.body)); return; }
      partners.push(result.body);
      feedPartnerId = result.body.id;
      feedPartnerIsRepeat = false;
      closeFeedPartnerModal();
      runFeedAnalysis();
    })
    .catch(function(e) { logErr('createFeedPartnerAndAnalyze error: ' + e.message); });
}

function loadFeedPartnerRepeatList() {
  document.getElementById('feed-partner-repeat-list').innerHTML = '<p style="font-size:13px;color:var(--text2);">Загрузка…</p>';
  apiFetch('/api/partners/with-analyses')
    .then(function(res) {
      if (!res.ok) { logErr('Failed to load partners with analyses'); return []; }
      return res.json();
    })
    .then(function(list) {
      feedPartnerRepeatOptions = list || [];
      renderFeedPartnerRepeatList();
    })
    .catch(function(e) {
      logErr('loadFeedPartnerRepeatList error: ' + e.message);
      feedPartnerRepeatOptions = [];
      renderFeedPartnerRepeatList();
    });
}

function renderFeedPartnerRepeatList() {
  var q = document.getElementById('feed-partner-search-input').value.trim().toLowerCase();
  var container = document.getElementById('feed-partner-repeat-list');
  if (!feedPartnerRepeatOptions.length) {
    container.innerHTML = '<p style="font-size:13px;color:var(--text2);">Пока нет проверенных партнёров</p>';
    return;
  }
  var filtered = feedPartnerRepeatOptions.filter(function(p) {
    return !q || p.name.toLowerCase().indexOf(q) !== -1;
  });
  if (!filtered.length) {
    container.innerHTML = '<p style="font-size:13px;color:var(--text2);">Ничего не найдено</p>';
    return;
  }
  container.innerHTML = filtered.map(function(p) {
    return '<div class="kanban-card" style="cursor:pointer;margin-bottom:6px;" onclick="selectFeedPartnerRepeat(' + p.id + ')">'
      + '<div class="kanban-card-name">' + p.name + '</div>'
      + '<div style="font-size:11px;color:var(--text3);">последняя проверка: ' + fmtDate(p.last_checked_at) + '</div>'
      + '</div>';
  }).join('');
}

function selectFeedPartnerRepeat(id) {
  feedPartnerId = id;
  feedPartnerIsRepeat = true;
  closeFeedPartnerModal();
  runFeedAnalysis();
}

function runFeedAnalysis() {
  var file = pendingFeedFile, fmt = pendingFeedFormat;
  log('processFile:', file.name, fmt);
  document.getElementById('fname').textContent = file.name + ' · ' + (file.size / 1024).toFixed(1) + ' КБ';
  document.getElementById('upload-zone').style.display = 'none';
  document.getElementById('feed-loader').style.display = 'block';
  var reader = new FileReader();
  reader.onerror = function() { logErr('FileReader error'); };
  if (fmt === 'xlsx') {
    reader.onload = function(e) {
      setTimeout(function() {
        try { showResult(parseXLSX(e.target.result)); }
        catch(ex) { logErr('parseXLSX: ' + ex.message); document.getElementById('feed-loader').style.display='none'; document.getElementById('upload-zone').style.display=''; }
      }, 50);
    };
    reader.readAsArrayBuffer(file);
  } else {
    reader.onload = function(e) {
      setTimeout(function() {
        try { showResult(parseXML(e.target.result)); }
        catch(ex) { logErr('parseXML: ' + ex.message); document.getElementById('feed-loader').style.display='none'; document.getElementById('upload-zone').style.display=''; }
      }, 50);
    };
    reader.readAsText(file, 'UTF-8');
  }
}
```
Note: `runFeedAnalysis`'s body is a verbatim copy of the old `processFile` body — this is intentional, not duplication to clean up, since `processFile` is now a distinct, smaller function (the four existing call sites — `fi-xml`/`fi-xlsx` change listeners, `dz-xml`/`dz-xlsx` drop listeners — are untouched, they still call `processFile(file, fmt)`, which now opens the modal instead of parsing immediately).

- [ ] **Step 4: Reset the new state in `appReset`**

Find:
```js
function appReset() {
  document.getElementById('upload-zone').style.display = '';
  document.getElementById('result').style.display = 'none';
  document.getElementById('feed-loader').style.display = 'none';
  document.getElementById('fi-xml').value = '';
  document.getElementById('fi-xlsx').value = '';
  allItems = [];
}
```
Replace with:
```js
function appReset() {
  document.getElementById('upload-zone').style.display = '';
  document.getElementById('result').style.display = 'none';
  document.getElementById('feed-loader').style.display = 'none';
  document.getElementById('fi-xml').value = '';
  document.getElementById('fi-xlsx').value = '';
  allItems = [];
  pendingFeedFile = null;
  pendingFeedFormat = null;
  feedPartnerId = null;
  feedPartnerIsRepeat = false;
}
```

- [ ] **Step 5: Verify by code review**

Confirm each "Find" block above matches `public/index.html` exactly (character-for-character) before applying its "Replace". Confirm the four existing `processFile(...)` call sites (`fi-xml`/`fi-xlsx` `change` listeners, `dz-xml`/`dz-xlsx` `drop` listeners, near the end of the file) are untouched — they should still read `processFile(e.target.files[0], 'xml')` etc. Confirm `runFeedAnalysis`'s body matches the old `processFile` body exactly except for reading `file`/`fmt` from `pendingFeedFile`/`pendingFeedFormat` instead of function parameters.

- [ ] **Step 6: Commit**

```powershell
git add public/index.html
git commit -m "Add pre-upload partner selection modal to the feed analyzer"
```

---

### Task 5: Frontend — save analysis and render comparison

**Files:**
- Modify: `public/index.html`

**Interfaces:**
- Consumes: `apiFetch`, `showResult` (existing), `pendingFeedFormat`/`feedPartnerId`/`feedPartnerIsRepeat` (Task 4), `POST /api/feed-analyses` / `GET /api/feed-analyses/latest` (Task 2), `fmtDate` (Task 4).

**No live-browser test is possible in this environment** — same constraint as Task 4, verify by code review.

- [ ] **Step 1: Expose the computed metrics from `renderAnalytics`**

Find:
```js
  document.getElementById('feed-analytics').innerHTML = html;
  log('renderAnalytics OK');
}
```
Replace with:
```js
  window._lastMetrics = {
    total: total,
    inStock: inStock,
    outStock: outStock,
    titleFilled: titleFilled,
    titlesWithSize: titlesWithSize.length,
    withMain: withMain,
    with2plus: with2plus,
    noExtra: noExtra.length,
    brandFilled: brandFilled,
    noBrand: noBrand.length,
    colorFilled: colorFilled,
    colorInvalid: colorInvalid.length,
    sizeFilled: sizeFilled,
    sizeIssues: sizeIssues.length,
    descFilled: descFilled,
    descOk: descOk,
    descShort: descShort.length,
    catFilled: catFilled,
    catShallow: catShallow.length,
    noCat: noCat.length,
    genderFilled: genderFilled,
    genderInvalid: genderInvalid.length,
    ageFilled: ageFilled,
    ageInvalid: ageInvalid.length,
    groupFilled: groupFilled,
    noGroup: noGroup.length
  };

  document.getElementById('feed-analytics').innerHTML = html;
  log('renderAnalytics OK');
}
```
This mirrors the existing `window._recsList = recs;` pattern a few lines above in the same function — every field here is copied from a local variable already computed earlier in `renderAnalytics` (verify each name exists in the function before this point; they are defined across the function's numbered sections 1–10).

- [ ] **Step 2: Trigger save + comparison after results render**

Find:
```js
function showResult(items) {
  if (!items.length) {
    document.getElementById('feed-loader').style.display = 'none';
    document.getElementById('upload-zone').style.display = '';
    return;
  }
  allItems = items;
  document.getElementById('feed-loader').style.display = 'none';
  document.getElementById('result').style.display = 'block';
  try { renderAnalytics(allItems); } catch(ex) { logErr('renderAnalytics: ' + ex.message); }
  try { renderFields(allItems);  } catch(ex) { logErr('renderFields: '  + ex.message); }
  try { renderItems(allItems);   } catch(ex) { logErr('renderItems: '   + ex.message); }
  log('Всё готово ✓');
}
```
Replace with:
```js
function showResult(items) {
  if (!items.length) {
    document.getElementById('feed-loader').style.display = 'none';
    document.getElementById('upload-zone').style.display = '';
    return;
  }
  allItems = items;
  document.getElementById('feed-loader').style.display = 'none';
  document.getElementById('result').style.display = 'block';
  try { renderAnalytics(allItems); } catch(ex) { logErr('renderAnalytics: ' + ex.message); }
  try { renderFields(allItems);  } catch(ex) { logErr('renderFields: '  + ex.message); }
  try { renderItems(allItems);   } catch(ex) { logErr('renderItems: '   + ex.message); }
  log('Всё готово ✓');
  saveFeedAnalysisAndCompare();
}
```

- [ ] **Step 3: Write the save + comparison functions**

Find (this is the same anchor point used in Task 4 Step 2 — the function should now exist right before `appReset`):
```js
function appReset() {
  document.getElementById('upload-zone').style.display = '';
  document.getElementById('result').style.display = 'none';
  document.getElementById('feed-loader').style.display = 'none';
  document.getElementById('fi-xml').value = '';
  document.getElementById('fi-xlsx').value = '';
  allItems = [];
  pendingFeedFile = null;
  pendingFeedFormat = null;
  feedPartnerId = null;
  feedPartnerIsRepeat = false;
}
```
Replace with:
```js
var METRIC_LABELS = {
  total: 'Товаров в фиде',
  inStock: 'В наличии',
  outStock: 'Отсутствуют',
  titleFilled: 'Названия заполнены',
  titlesWithSize: 'Размер в названии (ошибка)',
  withMain: 'С основным фото',
  with2plus: 'С 2+ доп. фото',
  noExtra: 'Без доп. фото',
  brandFilled: 'Бренд заполнен',
  noBrand: 'Без бренда',
  colorFilled: 'Цвет заполнен',
  colorInvalid: 'Нестандартный цвет',
  sizeFilled: 'Размер заполнен',
  sizeIssues: 'Несоответствие сетке',
  descFilled: 'Описание заполнено',
  descOk: 'Описание ≥50 симв.',
  descShort: 'Короткое описание',
  catFilled: 'Категория заполнена',
  catShallow: 'Неглубокая категория',
  noCat: 'Без категории',
  genderFilled: 'Пол заполнен',
  genderInvalid: 'Нестандартный пол',
  ageFilled: 'Возраст заполнен',
  ageInvalid: 'Нестандартный возраст',
  groupFilled: 'Группировка заполнена',
  noGroup: 'Без группировки'
};

var METRIC_HIGHER_IS_WORSE = {
  outStock: true, titlesWithSize: true, noExtra: true, noBrand: true, colorInvalid: true,
  sizeIssues: true, descShort: true, catShallow: true, noCat: true, genderInvalid: true,
  ageInvalid: true, noGroup: true
};

function renderFeedComparison(prevMetrics, currMetrics, prevDate) {
  var existing = document.getElementById('feed-comparison');
  if (existing) existing.remove();

  var keys = Object.keys(METRIC_LABELS).filter(function(k) {
    return prevMetrics[k] !== undefined || currMetrics[k] !== undefined;
  });
  var rows = keys.map(function(k) {
    var prev = prevMetrics[k] || 0;
    var curr = currMetrics[k] || 0;
    var diff = curr - prev;
    var worseIfUp = !!METRIC_HIGHER_IS_WORSE[k];
    var cls = diff === 0 ? '' : ((diff > 0) === worseIfUp ? 'err' : 'ok');
    var arrow = diff === 0 ? '=' : (diff > 0 ? '▲' : '▼');
    return '<div class="an-row"><span class="an-label">' + METRIC_LABELS[k] + '</span>'
      + '<span class="an-value ' + cls + '">' + prev + ' → ' + curr + ' ' + arrow + '</span></div>';
  }).join('');

  var html = '<div class="an-card" id="feed-comparison" style="margin-bottom:1.5rem;">'
    + '<p class="an-card-title">Сравнение с последней проверкой (' + fmtDate(prevDate) + ')</p>'
    + rows
    + '</div>';

  document.getElementById('feed-analytics').insertAdjacentHTML('beforebegin', html);
}

function saveFeedAnalysisAndCompare() {
  var existing = document.getElementById('feed-comparison');
  if (existing) existing.remove();

  if (!feedPartnerId) return;

  var metrics = window._lastMetrics || {};
  var previous = null;

  var fetchPrevious = feedPartnerIsRepeat
    ? apiFetch('/api/feed-analyses/latest?partner_id=' + feedPartnerId)
        .then(function(res) { return res.ok ? res.json() : { analysis: null }; })
        .then(function(data) { previous = data.analysis; })
        .catch(function(e) { logErr('Failed to load previous analysis: ' + e.message); })
    : Promise.resolve();

  fetchPrevious
    .then(function() {
      return apiFetch('/api/feed-analyses', {
        method: 'POST',
        body: JSON.stringify({ partner_id: feedPartnerId, format: pendingFeedFormat, metrics: metrics })
      });
    })
    .then(function(res) {
      if (!res.ok) logErr('Failed to save feed analysis');
    })
    .then(function() {
      if (previous) renderFeedComparison(previous.metrics, metrics, previous.created_at);
    })
    .catch(function(e) { logErr('saveFeedAnalysisAndCompare error: ' + e.message); });
}

function appReset() {
  document.getElementById('upload-zone').style.display = '';
  document.getElementById('result').style.display = 'none';
  document.getElementById('feed-loader').style.display = 'none';
  document.getElementById('fi-xml').value = '';
  document.getElementById('fi-xlsx').value = '';
  allItems = [];
  pendingFeedFile = null;
  pendingFeedFormat = null;
  feedPartnerId = null;
  feedPartnerIsRepeat = false;
}
```
Note the ordering inside `saveFeedAnalysisAndCompare`: it fetches the previous analysis (if repeat) **before** POSTing the new one, and only renders the comparison **after** the POST resolves — this guarantees the just-saved analysis never gets compared against itself, and the comparison only appears once the save attempt has actually completed (success or failure both fall through to the same `.then`, so a failed save still shows the comparison using the fresh in-memory `metrics`).

- [ ] **Step 4: Verify by code review**

Confirm the "Find" blocks match the file exactly. Confirm `window._lastMetrics`'s field list matches every local variable name available at that point in `renderAnalytics` (cross-check against the variable declarations in that function's sections 1–10). Confirm `saveFeedAnalysisAndCompare` is defined before `appReset` and after `runFeedAnalysis`/the Task 4 functions (order doesn't matter for `function` declarations due to hoisting, but keep the file readable top-to-bottom in the order shown).

- [ ] **Step 5: Commit**

```powershell
git add public/index.html
git commit -m "Save feed analysis metrics and show comparison for repeat partners"
```

---

### Task 6: Deploy and end-to-end verification

**Files:** none (deployment task).

**Interfaces:**
- Consumes: everything from Tasks 1–5.

This requires the human operator for the same reason Task 16 of the auth/storage plan did: `vercel --prod` needs a valid `VERCEL_TOKEN`/CLI session, which cannot be produced without interactive login or a token pasted in by the user.

- [ ] **Step 1: Run the full test suite one more time**

```powershell
"C:\Program Files\nodejs\node.exe" node_modules/jest/bin/jest.js
```
Expected: PASS, all suites (backend tests only — this feature adds no new suites beyond Tasks 1–3's, since Tasks 4–5 are frontend-only).

- [ ] **Step 2: Run the schema migration against production**

The `feed_analyses` table needs to exist before the new code paths are exercised. Using the privileged (unpooled) connection string:
```powershell
$env:MIGRATION_DATABASE_URL = "<the unpooled Neon connection string>"
node server/db/migrate.js
```
Expected: prints `Schema applied successfully.`

- [ ] **Step 3: Re-grant the restricted app role on the new table**

The app connects to production as the least-privilege `merchant_tools_app` role (set up in the prior auth/backend feature), which only has grants on the tables that existed when that role was created — `feed_analyses` is not among them and there is no automatic default-privilege rule covering new tables. Re-run the same script used to create the role; it's idempotent (safe to run again with the same or a newly-rotated password) and now grants on `feed_analyses` too:
```powershell
node server/scripts/create-restricted-role.js "<the same hex password used when this role was originally created — check your password manager/notes, don't generate a new one unless you're deliberately rotating it and will also update the deployed DATABASE_URL to match>"
```
Expected: prints `Role merchant_tools_app created/verified with restricted grants on database ...`. Skipping this step means every `/api/feed-analyses*` and `/api/partners/with-analyses` request will fail with a Postgres permission-denied error in production, despite every automated test passing (pg-mem has no privilege system, so this class of bug is invisible to the test suite).

- [ ] **Step 4: Deploy**

```powershell
vercel --prod --yes
```
(Requires `VERCEL_TOKEN` set and the local checkout linked to the `merchant-tools-backend-auth` project — confirm `.vercel/project.json` shows `"projectName":"merchant-tools-backend-auth"` before deploying, since a missing/stale link creates a new, wrong project instead of updating the live one.)

- [ ] **Step 5: Manual smoke test in a browser**

1. Upload a feed. The "Для кого этот фид?" modal should appear before parsing starts.
2. Choose "Новый партнёр", fill in a name that doesn't already exist in the kanban, submit — analysis should run normally and the partner should appear in "Партнёры в работе" at stage "Новый партнёр".
3. Try "Новый партнёр" again with the *same* name — a confirm() dialog should appear warning about the duplicate.
4. Upload the same (or a slightly modified) feed again, choose "Повторный", find and select the partner just created — a "Сравнение с последней проверкой" block should appear above the usual analytics, with metrics shown as `prev → curr` with arrows.
5. Choose "Пропустить" on a fresh upload — behavior should be identical to before this feature (no modal steps beyond the initial choice, no partner created, no save).
