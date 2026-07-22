# Merchant Tools: Backend, DB Storage & Authorization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Node.js/Express + Postgres backend to Merchant Tools that stores the "Partners in Work" kanban and "Integration" checklist in a database instead of `localStorage`, and puts the entire application behind session-based login.

**Architecture:** A single Express server serves the existing frontend as a static file from `public/index.html` and exposes a small JSON REST API under `/api`. Auth uses server-side sessions (cookie + Postgres-backed session store), not JWT. All mutating API requests are protected by a double-submit CSRF cookie; the login route is additionally rate-limited. Local development and automated tests run against an in-memory Postgres emulator (`pg-mem`) so no real database install is required on the dev machine — the deploy target (Railway) has the real managed Postgres.

**Tech Stack:** Node.js, Express, `express-session` + `connect-pg-simple`, `pg`, `bcrypt`, `helmet`, `express-rate-limit`, `zod`, `cookie-parser`, `dotenv`. Tests: `jest`, `supertest`, `pg-mem`.

## Global Constraints

- Backend: Node.js + Express. DB access only through parameterized queries via `pg` — never string-concatenated SQL.
- Auth: server-side sessions (`connect-pg-simple`), not JWT. Session cookie: `httpOnly`, `secure` (prod only), `sameSite=lax`, 8-hour idle timeout.
- Passwords: `bcrypt`, cost factor 12. No self-registration — users are created only via `server/scripts/create-user.js`.
- No roles: every authenticated user has identical permissions.
- CSRF: double-submit cookie, required on every mutating request (`POST`/`PATCH`/`PUT`/`DELETE`) except `POST /api/login`.
- Rate limiting: max 5 login attempts / 15 minutes per IP on `POST /api/login`.
- Security headers via `helmet`, with `contentSecurityPolicy: false` — the existing frontend's inline scripts/handlers and CDN script are incompatible with a real CSP; Helmet's other headers (HSTS, X-Frame-Options, X-Content-Type-Options, Referrer-Policy) remain active. HTTPS enforced in production (`NODE_ENV=production`).
- The running app must connect to Postgres as a restricted role with no `CREATE` privilege (DML only on the 4 existing tables); schema migrations run separately under a privileged connection (`MIGRATION_DATABASE_URL`). See Task 14.
- Partner `type` enum: exactly `api`, `mall`.
- Partner `stage` enum: exactly `s0, s1, s2, s3, s4, s5, s6, s6b, s7, s8` (matches the existing frontend `STAGES` array — order and ids must not change).
- Integration checklist storage is one shared row per `type` (`api`/`mall`) — not per-user, not per-partner.
- The entire application requires login, including "Анализатор фида" and "Создание логотипа" (which have no backend data of their own).
- Local dev and all automated tests run against `pg-mem` — no real Postgres install needed on this machine. Manual browser verification of the full login+data flow is only possible once Task 14 provides a real deployed Postgres, and is explicitly called out as deferred in the tasks before that.
- Deploy target: Railway (managed Postgres add-on).

---

## File Structure

```
merchant-tools/
  server/
    app.js                     — builds the Express app (injected pool/session store, no listen())
    index.js                   — real entrypoint: wires real Postgres pool + connect-pg-simple, calls listen()
    constants.js                — PARTNER_TYPES, STAGES enums shared by validation
    db/
      pool.js                   — createPool(connectionString)
      schema.sql                — CREATE TABLE statements + seed rows for integration_checklist
      migrate.js                 — CLI: applies schema.sql to DATABASE_URL
      users.js                   — createUser/findUserByUsername/verifyPassword
    middleware/
      csrf.js                    — issueCsrfCookie, verifyCsrf
      requireAuth.js              — 401s requests with no session user
      rateLimit.js                — createLoginLimiter()
      asyncHandler.js             — wraps async route handlers so rejections reach the error middleware
    routes/
      auth.js                     — createAuthRouter(): /login, /logout, /me
      partners.js                  — GET/POST /, PATCH/DELETE /:id
      integration.js                — GET/PUT /:type
    scripts/
      create-user.js               — CLI: node server/scripts/create-user.js <username> <password>
  public/
    index.html                    — moved from repo root; frontend gets login gate + API wiring
  test/
    helpers/
      testDb.js                    — pg-mem pool with schema applied
      testApp.js                    — createApp() wired with MemoryStore for sessions
    db/
      schema.test.js
      users.test.js
    middleware/
      csrf.test.js
      requireAuth.test.js
    routes/
      auth.test.js
      partners.test.js
      integration.test.js
    app.test.js
  package.json
  .env.example
  .gitignore
```

---

### Task 1: Environment setup, Postgres pool, and schema

**Files:**
- Create: `package.json`, `.gitignore`
- Create: `server/db/pool.js`
- Create: `server/db/schema.sql`
- Create: `server/db/migrate.js`
- Create: `test/helpers/testDb.js`
- Test: `test/db/schema.test.js`

**Interfaces:**
- Produces: `createPool(connectionString) -> pg.Pool` (from `server/db/pool.js`), used by every later task that touches the DB.
- Produces: `createTestPool() -> Promise<pg.Pool>` (from `test/helpers/testDb.js`), the in-memory pool every test file uses.

- [ ] **Step 1: Install Node.js**

Run in PowerShell:
```powershell
winget install --id OpenJS.NodeJS.LTS -e --source winget
```
Close and reopen the terminal, then verify:
```powershell
node --version
npm --version
```
Expected: a `v20.x` or later LTS version and a matching npm version print without error.

- [ ] **Step 2: Scaffold the npm project**

```powershell
cd C:\Users\karap\merchant-tools
npm init -y
npm install express express-session connect-pg-simple pg bcrypt cookie-parser helmet express-rate-limit zod dotenv
npm install --save-dev jest supertest pg-mem
```

- [ ] **Step 3: Add npm scripts**

Edit `package.json`, replace the `"scripts"` block with:
```json
"scripts": {
  "start": "node server/index.js",
  "test": "jest",
  "migrate": "node server/db/migrate.js",
  "create-user": "node server/scripts/create-user.js"
}
```

- [ ] **Step 4: Add `.gitignore`**

Create `.gitignore`:
```
node_modules/
.env
```

- [ ] **Step 5: Write `server/db/pool.js`**

```js
const { Pool } = require('pg');

function createPool(connectionString) {
  return new Pool({ connectionString });
}

module.exports = { createPool };
```

- [ ] **Step 6: Write `server/db/schema.sql`**

```sql
CREATE TABLE IF NOT EXISTS users (
  id            SERIAL PRIMARY KEY,
  username      TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS partners (
  id         SERIAL PRIMARY KEY,
  name       TEXT NOT NULL,
  type       TEXT NOT NULL CHECK (type IN ('api', 'mall')),
  stage      TEXT NOT NULL DEFAULT 's0',
  checks     JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS integration_checklist (
  type       TEXT PRIMARY KEY CHECK (type IN ('api', 'mall')),
  checks     JSONB NOT NULL DEFAULT '{}',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO integration_checklist (type, checks) VALUES ('api', '{}'), ('mall', '{}')
ON CONFLICT (type) DO NOTHING;

-- Pre-created here (rather than left to connect-pg-simple's createTableIfMissing)
-- so the app's runtime DB role never needs CREATE privilege — see Task 14.
CREATE TABLE IF NOT EXISTS session (
  sid    VARCHAR NOT NULL COLLATE "default",
  sess   JSON NOT NULL,
  expire TIMESTAMP(6) NOT NULL,
  CONSTRAINT session_pkey PRIMARY KEY (sid)
);

CREATE INDEX IF NOT EXISTS idx_session_expire ON session (expire);
```

- [ ] **Step 7: Write `server/db/migrate.js`**

```js
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { createPool } = require('./pool');

async function migrate() {
  // Prefers MIGRATION_DATABASE_URL: in production (Task 14) the app's own
  // DATABASE_URL is switched to a restricted role that lacks CREATE
  // privilege, so schema changes must run under the privileged connection.
  const connectionString = process.env.MIGRATION_DATABASE_URL || process.env.DATABASE_URL;
  const pool = createPool(connectionString);
  const sql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  await pool.query(sql);
  await pool.end();
  console.log('Schema applied successfully.');
}

migrate().catch((err) => {
  console.error('Migration failed:', err.message);
  process.exit(1);
});
```

- [ ] **Step 8: Write `test/helpers/testDb.js`**

```js
const { newDb } = require('pg-mem');
const fs = require('fs');
const path = require('path');

async function createTestPool() {
  const db = newDb();
  const { Pool } = db.adapters.createPg();
  const pool = new Pool();
  const sql = fs.readFileSync(path.join(__dirname, '../../server/db/schema.sql'), 'utf8');
  await pool.query(sql);
  return pool;
}

module.exports = { createTestPool };
```

- [ ] **Step 9: Write the failing test `test/db/schema.test.js`**

```js
const { createTestPool } = require('../helpers/testDb');

test('schema creates the expected tables and seeds integration_checklist', async () => {
  const pool = await createTestPool();

  const tables = await pool.query(
    "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name"
  );
  expect(tables.rows.map((r) => r.table_name)).toEqual(['integration_checklist', 'partners', 'session', 'users']);

  const seeded = await pool.query('SELECT type FROM integration_checklist ORDER BY type');
  expect(seeded.rows.map((r) => r.type)).toEqual(['api', 'mall']);

  await pool.end();
});
```

- [ ] **Step 10: Run the test**

```powershell
npx jest test/db/schema.test.js
```
Expected: PASS (this test has nothing to fail against first since it only exercises files just written — if it fails, fix `schema.sql` or `testDb.js` until it passes before moving on).

- [ ] **Step 11: Commit**

```powershell
git add package.json package-lock.json .gitignore server/db/pool.js server/db/schema.sql server/db/migrate.js test/helpers/testDb.js test/db/schema.test.js
git commit -m "Add Postgres schema, pool, and pg-mem test harness"
```

---

### Task 2: User model (create/find/verify)

**Files:**
- Create: `server/db/users.js`
- Test: `test/db/users.test.js`

**Interfaces:**
- Consumes: `createTestPool()` from `test/helpers/testDb.js` (Task 1).
- Produces: `createUser(pool, username, password) -> Promise<{id, username, created_at}>`, `findUserByUsername(pool, username) -> Promise<{id, username, password_hash} | null>`, `verifyPassword(user, password) -> Promise<boolean>` — used by `server/scripts/create-user.js` (Task 9) and `server/routes/auth.js` (Task 6).

- [ ] **Step 1: Write the failing test**

Create `test/db/users.test.js`:
```js
const { createTestPool } = require('../helpers/testDb');
const { createUser, findUserByUsername, verifyPassword } = require('../../server/db/users');

let pool;
beforeAll(async () => { pool = await createTestPool(); });
afterAll(async () => { await pool.end(); });

test('createUser stores a bcrypt hash, not the plaintext password', async () => {
  await createUser(pool, 'operator1', 'CorrectHorseBatteryStaple1');
  const stored = await findUserByUsername(pool, 'operator1');
  expect(stored.username).toBe('operator1');
  expect(stored.password_hash).not.toBe('CorrectHorseBatteryStaple1');
});

test('verifyPassword returns true only for the correct password', async () => {
  const stored = await findUserByUsername(pool, 'operator1');
  expect(await verifyPassword(stored, 'CorrectHorseBatteryStaple1')).toBe(true);
  expect(await verifyPassword(stored, 'wrong-password')).toBe(false);
});

test('findUserByUsername returns null for unknown username', async () => {
  expect(await findUserByUsername(pool, 'nobody')).toBeNull();
});
```

- [ ] **Step 2: Run the test to verify it fails**

```powershell
npx jest test/db/users.test.js
```
Expected: FAIL with `Cannot find module '../../server/db/users'`.

- [ ] **Step 3: Write `server/db/users.js`**

```js
const bcrypt = require('bcrypt');

const SALT_ROUNDS = 12;

async function createUser(pool, username, password) {
  const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
  const result = await pool.query(
    'INSERT INTO users (username, password_hash) VALUES ($1, $2) RETURNING id, username, created_at',
    [username, passwordHash]
  );
  return result.rows[0];
}

async function findUserByUsername(pool, username) {
  const result = await pool.query(
    'SELECT id, username, password_hash FROM users WHERE username = $1',
    [username]
  );
  return result.rows[0] || null;
}

async function verifyPassword(user, password) {
  if (!user) return false;
  return bcrypt.compare(password, user.password_hash);
}

module.exports = { createUser, findUserByUsername, verifyPassword };
```

- [ ] **Step 4: Run the test to verify it passes**

```powershell
npx jest test/db/users.test.js
```
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```powershell
git add server/db/users.js test/db/users.test.js
git commit -m "Add user model with bcrypt password hashing"
```

---

### Task 3: Express app skeleton serving the frontend

**Files:**
- Create: `server/app.js`
- Create: `server/index.js`
- Create: `test/helpers/testApp.js`
- Modify: move `index.html` to `public/index.html`
- Test: `test/app.test.js`

**Interfaces:**
- Consumes: `createPool` (Task 1).
- Produces: `createApp({pool, sessionStore, sessionSecret}) -> express.Application` — every later task that adds routes modifies this file. `createTestApp(pool) -> express.Application` — used by every route test from Task 6 onward.

- [ ] **Step 1: Move the frontend into `public/`**

```powershell
git mv index.html public/index.html
```

- [ ] **Step 2: Write the failing test**

Create `test/app.test.js`:
```js
const request = require('supertest');
const { createTestPool } = require('./helpers/testDb');
const { createTestApp } = require('./helpers/testApp');

test('serves the frontend from public/index.html', async () => {
  const pool = await createTestPool();
  const app = createTestApp(pool);

  const res = await request(app).get('/');

  expect(res.status).toBe(200);
  expect(res.text).toContain('Merchant Tools');

  await pool.end();
});
```

- [ ] **Step 3: Run the test to verify it fails**

```powershell
npx jest test/app.test.js
```
Expected: FAIL with `Cannot find module './helpers/testApp'`.

- [ ] **Step 4: Write `server/app.js`**

```js
const path = require('path');
const express = require('express');
const cookieParser = require('cookie-parser');
const session = require('express-session');
const helmet = require('helmet');

function createApp({ pool, sessionStore, sessionSecret }) {
  const app = express();

  app.set('trust proxy', 1);
  app.locals.pool = pool;

  app.use(helmet({
    // public/index.html relies on an inline <script> block, inline
    // onclick="..." handlers throughout, and a third-party CDN script
    // (xlsx.js). A CSP permissive enough not to break these would need
    // 'unsafe-inline' on script-src and script-src-attr, which provides
    // negligible real XSS protection over no CSP at all. Disabling CSP
    // here (Helmet's other headers — HSTS, X-Frame-Options,
    // X-Content-Type-Options, Referrer-Policy — still apply) is more
    // honest than shipping a CSP that looks strict but isn't. Revisit if
    // the frontend ever moves off inline scripts/handlers.
    contentSecurityPolicy: false
  }));
  app.use(express.json());
  app.use(cookieParser());
  app.use(session({
    store: sessionStore,
    secret: sessionSecret,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 8 * 60 * 60 * 1000
    }
  }));

  app.use(express.static(path.join(__dirname, '..', 'public')));

  return app;
}

module.exports = { createApp };
```

- [ ] **Step 5: Write `server/index.js`**

```js
require('dotenv').config();
const session = require('express-session');
const PgSession = require('connect-pg-simple')(session);
const { createApp } = require('./app');
const { createPool } = require('./db/pool');

const pool = createPool(process.env.DATABASE_URL);

const app = createApp({
  pool,
  // createTableIfMissing is intentionally omitted (defaults to false): the
  // session table is created by schema.sql/migrate.js under the privileged
  // connection, since the app's runtime DB role (Task 14) has no CREATE
  // privilege.
  sessionStore: new PgSession({ pool }),
  sessionSecret: process.env.SESSION_SECRET
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log('Merchant Tools server listening on port ' + port);
});
```

- [ ] **Step 6: Write `test/helpers/testApp.js`**

```js
const session = require('express-session');
const { createApp } = require('../../server/app');

function createTestApp(pool) {
  return createApp({
    pool,
    sessionStore: new session.MemoryStore(),
    sessionSecret: 'test-secret'
  });
}

module.exports = { createTestApp };
```

- [ ] **Step 7: Run the test to verify it passes**

```powershell
npx jest test/app.test.js
```
Expected: PASS.

- [ ] **Step 8: Commit**

```powershell
git add server/app.js server/index.js test/helpers/testApp.js test/app.test.js public/index.html
git commit -m "Add Express app skeleton serving the frontend from public/"
```

---

### Task 4: CSRF middleware (double-submit cookie)

**Files:**
- Create: `server/middleware/csrf.js`
- Test: `test/middleware/csrf.test.js`

**Interfaces:**
- Produces: `issueCsrfCookie(req, res, next)`, `verifyCsrf(req, res, next)` — wired into `server/app.js` in this task, and used by `server/routes/partners.js` / `server/routes/integration.js` in Tasks 7–8.

- [ ] **Step 1: Write the failing test**

Create `test/middleware/csrf.test.js`:
```js
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
```

- [ ] **Step 2: Run the test to verify it fails**

```powershell
npx jest test/middleware/csrf.test.js
```
Expected: FAIL with `Cannot find module '../../server/middleware/csrf'`.

- [ ] **Step 3: Write `server/middleware/csrf.js`**

```js
const crypto = require('crypto');

function issueCsrfCookie(req, res, next) {
  if (!req.cookies.csrfToken) {
    const token = crypto.randomBytes(32).toString('hex');
    res.cookie('csrfToken', token, {
      httpOnly: false,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax'
    });
    req.cookies.csrfToken = token;
  }
  next();
}

function verifyCsrf(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const cookieToken = req.cookies.csrfToken;
  const headerToken = req.get('X-CSRF-Token');
  if (!cookieToken || !headerToken || cookieToken !== headerToken) {
    return res.status(403).json({ error: 'invalid csrf token' });
  }
  next();
}

module.exports = { issueCsrfCookie, verifyCsrf };
```

- [ ] **Step 4: Run the test to verify it passes**

```powershell
npx jest test/middleware/csrf.test.js
```
Expected: PASS (3 tests).

- [ ] **Step 5: Wire `issueCsrfCookie` into the app**

Modify `server/app.js`: add the import and one `app.use` call.

```js
const path = require('path');
const express = require('express');
const cookieParser = require('cookie-parser');
const session = require('express-session');
const helmet = require('helmet');
const { issueCsrfCookie } = require('./middleware/csrf');

function createApp({ pool, sessionStore, sessionSecret }) {
  const app = express();

  app.set('trust proxy', 1);
  app.locals.pool = pool;

  app.use(helmet({
    // public/index.html relies on an inline <script> block, inline
    // onclick="..." handlers throughout, and a third-party CDN script
    // (xlsx.js). A CSP permissive enough not to break these would need
    // 'unsafe-inline' on script-src and script-src-attr, which provides
    // negligible real XSS protection over no CSP at all. Disabling CSP
    // here (Helmet's other headers — HSTS, X-Frame-Options,
    // X-Content-Type-Options, Referrer-Policy — still apply) is more
    // honest than shipping a CSP that looks strict but isn't. Revisit if
    // the frontend ever moves off inline scripts/handlers.
    contentSecurityPolicy: false
  }));
  app.use(express.json());
  app.use(cookieParser());
  app.use(session({
    store: sessionStore,
    secret: sessionSecret,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 8 * 60 * 60 * 1000
    }
  }));
  app.use(issueCsrfCookie);

  app.use(express.static(path.join(__dirname, '..', 'public')));

  return app;
}

module.exports = { createApp };
```

- [ ] **Step 6: Run the full suite to confirm nothing broke**

```powershell
npx jest
```
Expected: PASS (all tests from Tasks 1–4).

- [ ] **Step 7: Commit**

```powershell
git add server/middleware/csrf.js test/middleware/csrf.test.js server/app.js
git commit -m "Add double-submit CSRF cookie middleware"
```

---

### Task 5: requireAuth middleware

**Files:**
- Create: `server/middleware/requireAuth.js`
- Test: `test/middleware/requireAuth.test.js`

**Interfaces:**
- Produces: `requireAuth(req, res, next)` — wired onto `/api/partners` and `/api/integration` routers in Tasks 7–8.

- [ ] **Step 1: Write the failing test**

Create `test/middleware/requireAuth.test.js`:
```js
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
```

- [ ] **Step 2: Run the test to verify it fails**

```powershell
npx jest test/middleware/requireAuth.test.js
```
Expected: FAIL with `Cannot find module '../../server/middleware/requireAuth'`.

- [ ] **Step 3: Write `server/middleware/requireAuth.js`**

```js
function requireAuth(req, res, next) {
  if (!req.session || !req.session.userId) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  next();
}

module.exports = { requireAuth };
```

- [ ] **Step 4: Run the test to verify it passes**

```powershell
npx jest test/middleware/requireAuth.test.js
```
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```powershell
git add server/middleware/requireAuth.js test/middleware/requireAuth.test.js
git commit -m "Add requireAuth middleware"
```

---

### Task 6: Auth routes (login / logout / me) with rate limiting

**Files:**
- Create: `server/middleware/rateLimit.js`
- Create: `server/middleware/asyncHandler.js`
- Create: `server/routes/auth.js`
- Modify: `server/app.js`
- Test: `test/routes/auth.test.js`

**Interfaces:**
- Consumes: `findUserByUsername`, `verifyPassword` (Task 2); `createTestPool`, `createTestApp` (Tasks 1, 3).
- Produces: `createAuthRouter() -> express.Router` mounted at `/api` — the frontend (Task 10) calls `POST /api/login`, `POST /api/logout`, `GET /api/me` against this router. `asyncHandler(fn)` — reused by `server/routes/partners.js` and `server/routes/integration.js` in Tasks 7–8.

- [ ] **Step 1: Write `server/middleware/asyncHandler.js`**

```js
function asyncHandler(fn) {
  return function (req, res, next) {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

module.exports = { asyncHandler };
```

- [ ] **Step 2: Write `server/middleware/rateLimit.js`**

```js
const rateLimit = require('express-rate-limit');

function createLoginLimiter() {
  return rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 5,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'too many login attempts, try again later' }
  });
}

module.exports = { createLoginLimiter };
```

- [ ] **Step 3: Write the failing test**

Create `test/routes/auth.test.js`:
```js
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
```

- [ ] **Step 4: Run the test to verify it fails**

```powershell
npx jest test/routes/auth.test.js
```
Expected: FAIL — `/api/login` returns 404 (no such route yet).

- [ ] **Step 5: Write `server/routes/auth.js`**

```js
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
```

- [ ] **Step 6: Wire the auth router and a final error handler into the app**

Modify `server/app.js`:

```js
const path = require('path');
const express = require('express');
const cookieParser = require('cookie-parser');
const session = require('express-session');
const helmet = require('helmet');
const { issueCsrfCookie } = require('./middleware/csrf');
const { createAuthRouter } = require('./routes/auth');

function createApp({ pool, sessionStore, sessionSecret }) {
  const app = express();

  app.set('trust proxy', 1);
  app.locals.pool = pool;

  app.use(helmet({
    // public/index.html relies on an inline <script> block, inline
    // onclick="..." handlers throughout, and a third-party CDN script
    // (xlsx.js). A CSP permissive enough not to break these would need
    // 'unsafe-inline' on script-src and script-src-attr, which provides
    // negligible real XSS protection over no CSP at all. Disabling CSP
    // here (Helmet's other headers — HSTS, X-Frame-Options,
    // X-Content-Type-Options, Referrer-Policy — still apply) is more
    // honest than shipping a CSP that looks strict but isn't. Revisit if
    // the frontend ever moves off inline scripts/handlers.
    contentSecurityPolicy: false
  }));
  app.use(express.json());
  app.use(cookieParser());
  app.use(session({
    store: sessionStore,
    secret: sessionSecret,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 8 * 60 * 60 * 1000
    }
  }));
  app.use(issueCsrfCookie);

  app.use('/api', createAuthRouter());

  app.use(express.static(path.join(__dirname, '..', 'public')));

  app.use((err, req, res, next) => {
    console.error(err);
    res.status(500).json({ error: 'internal server error' });
  });

  return app;
}

module.exports = { createApp };
```

- [ ] **Step 7: Run the test to verify it passes**

```powershell
npx jest test/routes/auth.test.js
```
Expected: PASS (5 tests).

- [ ] **Step 8: Run the full suite**

```powershell
npx jest
```
Expected: PASS (all tests from Tasks 1–6).

- [ ] **Step 9: Commit**

```powershell
git add server/middleware/asyncHandler.js server/middleware/rateLimit.js server/routes/auth.js server/app.js test/routes/auth.test.js
git commit -m "Add login/logout/me routes with rate limiting and session rotation"
```

---

### Task 7: Partners API (list / create / update / delete)

**Files:**
- Create: `server/constants.js`
- Create: `server/routes/partners.js`
- Modify: `server/app.js`
- Test: `test/routes/partners.test.js`

**Interfaces:**
- Consumes: `requireAuth` (Task 5), `verifyCsrf` (Task 4), `asyncHandler` (Task 6), `PARTNER_TYPES`/`STAGES` (this task).
- Produces: `PARTNER_TYPES`, `STAGES` arrays (also consumed by `server/routes/integration.js` in Task 8). REST resource `/api/partners` — consumed by the frontend in Task 11.

- [ ] **Step 1: Write `server/constants.js`**

```js
const PARTNER_TYPES = ['api', 'mall'];
const STAGES = ['s0', 's1', 's2', 's3', 's4', 's5', 's6', 's6b', 's7', 's8'];

module.exports = { PARTNER_TYPES, STAGES };
```

- [ ] **Step 2: Write the failing test**

Create `test/routes/partners.test.js`:
```js
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
```

- [ ] **Step 3: Run the test to verify it fails**

```powershell
npx jest test/routes/partners.test.js
```
Expected: FAIL — `/api/partners` returns 404 (no such route yet).

- [ ] **Step 4: Write `server/routes/partners.js`**

```js
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
```

- [ ] **Step 5: Wire the partners router into the app**

Modify `server/app.js`: add the imports and the protected mount, inserted before the static middleware.

```js
const path = require('path');
const express = require('express');
const cookieParser = require('cookie-parser');
const session = require('express-session');
const helmet = require('helmet');
const { issueCsrfCookie, verifyCsrf } = require('./middleware/csrf');
const { requireAuth } = require('./middleware/requireAuth');
const { createAuthRouter } = require('./routes/auth');
const partnersRoutes = require('./routes/partners');

function createApp({ pool, sessionStore, sessionSecret }) {
  const app = express();

  app.set('trust proxy', 1);
  app.locals.pool = pool;

  app.use(helmet({
    // public/index.html relies on an inline <script> block, inline
    // onclick="..." handlers throughout, and a third-party CDN script
    // (xlsx.js). A CSP permissive enough not to break these would need
    // 'unsafe-inline' on script-src and script-src-attr, which provides
    // negligible real XSS protection over no CSP at all. Disabling CSP
    // here (Helmet's other headers — HSTS, X-Frame-Options,
    // X-Content-Type-Options, Referrer-Policy — still apply) is more
    // honest than shipping a CSP that looks strict but isn't. Revisit if
    // the frontend ever moves off inline scripts/handlers.
    contentSecurityPolicy: false
  }));
  app.use(express.json());
  app.use(cookieParser());
  app.use(session({
    store: sessionStore,
    secret: sessionSecret,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 8 * 60 * 60 * 1000
    }
  }));
  app.use(issueCsrfCookie);

  app.use('/api', createAuthRouter());
  app.use('/api/partners', requireAuth, verifyCsrf, partnersRoutes);

  app.use(express.static(path.join(__dirname, '..', 'public')));

  app.use((err, req, res, next) => {
    console.error(err);
    res.status(500).json({ error: 'internal server error' });
  });

  return app;
}

module.exports = { createApp };
```

- [ ] **Step 6: Run the test to verify it passes**

```powershell
npx jest test/routes/partners.test.js
```
Expected: PASS (5 tests).

- [ ] **Step 7: Run the full suite**

```powershell
npx jest
```
Expected: PASS (all tests from Tasks 1–7).

- [ ] **Step 8: Commit**

```powershell
git add server/constants.js server/routes/partners.js server/app.js test/routes/partners.test.js
git commit -m "Add partners CRUD API"
```

---

### Task 8: Integration checklist API (get / put)

**Files:**
- Create: `server/routes/integration.js`
- Modify: `server/app.js`
- Test: `test/routes/integration.test.js`

**Interfaces:**
- Consumes: `PARTNER_TYPES` (Task 7), `requireAuth`, `verifyCsrf`, `asyncHandler`.
- Produces: REST resource `/api/integration/:type` — consumed by the frontend in Task 12.

- [ ] **Step 1: Write the failing test**

Create `test/routes/integration.test.js`:
```js
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

test('GET /api/integration/:type requires a session', async () => {
  const res = await request(app).get('/api/integration/api');
  expect(res.status).toBe(401);
});

test('returns an empty checklist for a freshly seeded type', async () => {
  const res = await agent.get('/api/integration/api');
  expect(res.status).toBe(200);
  expect(res.body).toEqual({ checks: {} });
});

test('rejects an unknown type', async () => {
  const res = await agent.get('/api/integration/bogus');
  expect(res.status).toBe(400);
});

test('saves and reloads checklist state for a type', async () => {
  const put = await agent
    .put('/api/integration/mall')
    .set('X-CSRF-Token', csrfToken)
    .send({ checks: { mall_docs_asel: true, mall_b2b_merchants: false } });
  expect(put.status).toBe(200);
  expect(put.body).toEqual({ checks: { mall_docs_asel: true, mall_b2b_merchants: false } });

  const get = await agent.get('/api/integration/mall');
  expect(get.body).toEqual({ checks: { mall_docs_asel: true, mall_b2b_merchants: false } });
});

test('PUT without a csrf token is rejected', async () => {
  const res = await agent.put('/api/integration/api').send({ checks: {} });
  expect(res.status).toBe(403);
});
```

- [ ] **Step 2: Run the test to verify it fails**

```powershell
npx jest test/routes/integration.test.js
```
Expected: FAIL — `/api/integration/:type` returns 404.

- [ ] **Step 3: Write `server/routes/integration.js`**

```js
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
```

- [ ] **Step 4: Wire the integration router into the app**

Modify `server/app.js`: add the import and the protected mount.

```js
const path = require('path');
const express = require('express');
const cookieParser = require('cookie-parser');
const session = require('express-session');
const helmet = require('helmet');
const { issueCsrfCookie, verifyCsrf } = require('./middleware/csrf');
const { requireAuth } = require('./middleware/requireAuth');
const { createAuthRouter } = require('./routes/auth');
const partnersRoutes = require('./routes/partners');
const integrationRoutes = require('./routes/integration');

function createApp({ pool, sessionStore, sessionSecret }) {
  const app = express();

  app.set('trust proxy', 1);
  app.locals.pool = pool;

  app.use(helmet({
    // public/index.html relies on an inline <script> block, inline
    // onclick="..." handlers throughout, and a third-party CDN script
    // (xlsx.js). A CSP permissive enough not to break these would need
    // 'unsafe-inline' on script-src and script-src-attr, which provides
    // negligible real XSS protection over no CSP at all. Disabling CSP
    // here (Helmet's other headers — HSTS, X-Frame-Options,
    // X-Content-Type-Options, Referrer-Policy — still apply) is more
    // honest than shipping a CSP that looks strict but isn't. Revisit if
    // the frontend ever moves off inline scripts/handlers.
    contentSecurityPolicy: false
  }));
  app.use(express.json());
  app.use(cookieParser());
  app.use(session({
    store: sessionStore,
    secret: sessionSecret,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 8 * 60 * 60 * 1000
    }
  }));
  app.use(issueCsrfCookie);

  app.use('/api', createAuthRouter());
  app.use('/api/partners', requireAuth, verifyCsrf, partnersRoutes);
  app.use('/api/integration', requireAuth, verifyCsrf, integrationRoutes);

  app.use(express.static(path.join(__dirname, '..', 'public')));

  app.use((err, req, res, next) => {
    console.error(err);
    res.status(500).json({ error: 'internal server error' });
  });

  return app;
}

module.exports = { createApp };
```

- [ ] **Step 5: Run the test to verify it passes**

```powershell
npx jest test/routes/integration.test.js
```
Expected: PASS (5 tests).

- [ ] **Step 6: Run the full suite**

```powershell
npx jest
```
Expected: PASS (all tests from Tasks 1–8).

- [ ] **Step 7: Commit**

```powershell
git add server/routes/integration.js server/app.js test/routes/integration.test.js
git commit -m "Add integration checklist get/put API"
```

---

### Task 9: create-user CLI script and environment file

**Files:**
- Create: `server/scripts/create-user.js`
- Create: `.env.example`

**Interfaces:**
- Consumes: `createPool` (Task 1), `createUser` (Task 2).
- Produces: the `npm run create-user -- <username> <password>` command used in Task 14 to provision the first real user.

- [ ] **Step 1: Write `server/scripts/create-user.js`**

```js
require('dotenv').config();
const { createPool } = require('../db/pool');
const { createUser } = require('../db/users');

async function main() {
  const [, , username, password] = process.argv;
  if (!username || !password) {
    console.error('Usage: node server/scripts/create-user.js <username> <password>');
    process.exit(1);
  }

  const pool = createPool(process.env.DATABASE_URL);
  try {
    const user = await createUser(pool, username, password);
    console.log('Created user: ' + user.username + ' (id ' + user.id + ')');
  } catch (err) {
    console.error('Failed to create user: ' + err.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

main();
```

- [ ] **Step 2: Write `.env.example`**

```
DATABASE_URL=postgres://user:password@localhost:5432/merchant_tools
# Only needed in production, where DATABASE_URL is switched to a restricted
# role without CREATE privilege (see Task 14). Locally, migrate.js falls
# back to DATABASE_URL when this is unset.
MIGRATION_DATABASE_URL=
SESSION_SECRET=replace-with-a-long-random-string
PORT=3000
NODE_ENV=development
```

- [ ] **Step 3: Run the full suite to confirm nothing broke**

```powershell
npx jest
```
Expected: PASS (this task adds no new tests — it's a CLI script exercised for real in Task 14 against the deployed database, since there's no real Postgres on this machine to run it against now).

- [ ] **Step 4: Commit**

```powershell
git add server/scripts/create-user.js .env.example
git commit -m "Add create-user CLI script and .env.example"
```

---

### Task 10: Frontend — API fetch helper and login gate

**Files:**
- Modify: `public/index.html`

**Interfaces:**
- Consumes: `POST /api/login`, `POST /api/logout`, `GET /api/me` (Task 6).
- Produces: `apiFetch(url, options)`, `getCsrfCookie()`, `checkAuth()`, `initApp()` (stub, extended in Task 11) — used by every later frontend task.

- [ ] **Step 1: Add the login screen markup right after `<body>`**

In `public/index.html`, find:
```html
<body>

<!-- ── главная навигация ── -->
<nav class="main-nav">
```
Replace with:
```html
<body>

<style>
  .login-screen { position: fixed; inset: 0; background: var(--bg, #fff); display: flex; align-items: center; justify-content: center; z-index: 1000; }
  .login-form { display: flex; flex-direction: column; gap: 10px; width: 280px; }
  .login-form h1 { font-size: 18px; margin-bottom: 8px; text-align: center; }
  .login-form input { padding: 10px; border: 1px solid rgba(0,0,0,0.16); border-radius: 8px; font-size: 14px; }
  .login-error { color: #A32D2D; font-size: 13px; margin: 0; }
  /* Hidden until JS confirms a session (body.authenticated) — prevents a
     flash of the app's nav/pages before the async /api/me check resolves.
     The login screen itself has no such gate: it's visible from first
     paint via its own CSS above, with no inline display:none. */
  body:not(.authenticated) .main-nav, body:not(.authenticated) .page { display: none !important; }
</style>
<div id="login-screen" class="login-screen">
  <form id="login-form" class="login-form" onsubmit="return handleLogin(event)">
    <h1>🛒 Merchant Tools</h1>
    <input type="text" id="login-username" placeholder="Логин" autocomplete="username" required>
    <input type="password" id="login-password" placeholder="Пароль" autocomplete="current-password" required>
    <button type="submit" class="btn btn-success">Войти</button>
    <p id="login-error" class="login-error" style="display:none"></p>
  </form>
</div>

<!-- ── главная навигация ── -->
<nav class="main-nav">
```

- [ ] **Step 2: Add a logout button to the nav**

Find:
```html
  <button class="main-tab" onclick="showMain('logo')">Создание логотипа</button>
</nav>
```
Replace with:
```html
  <button class="main-tab" onclick="showMain('logo')">Создание логотипа</button>
  <button class="main-tab" onclick="handleLogout()" style="margin-left:auto">Выйти</button>
</nav>
```

- [ ] **Step 3: Add the auth JS right after the `<script>` tag**

Find:
```html
<script>
```
(the first line right after it starts the existing code — insert the new block immediately after the `<script>` line, before any existing code):
```html
<script>
function apiFetch(url, options) {
  options = options || {};
  var headers = Object.assign({ 'Content-Type': 'application/json' }, options.headers || {});
  var method = (options.method || 'GET').toUpperCase();
  if (method !== 'GET' && method !== 'HEAD') {
    headers['X-CSRF-Token'] = getCsrfCookie();
  }
  return fetch(url, Object.assign({}, options, { headers: headers, credentials: 'same-origin' }));
}

function getCsrfCookie() {
  var match = document.cookie.match(/(?:^|; )csrfToken=([^;]*)/);
  return match ? decodeURIComponent(match[1]) : '';
}

function showLoginScreen() {
  document.body.classList.remove('authenticated');
  document.getElementById('login-screen').style.display = 'flex';
}

function hideLoginScreen() {
  document.getElementById('login-screen').style.display = 'none';
  document.body.classList.add('authenticated');
}

function handleLogin(event) {
  event.preventDefault();
  var username = document.getElementById('login-username').value.trim();
  var password = document.getElementById('login-password').value;
  var errorEl = document.getElementById('login-error');
  errorEl.style.display = 'none';

  apiFetch('/api/login', { method: 'POST', body: JSON.stringify({ username: username, password: password }) })
    .then(function(res) {
      if (!res.ok) {
        errorEl.textContent = res.status === 429 ? 'Слишком много попыток входа. Попробуйте позже.' : 'Неверный логин или пароль.';
        errorEl.style.display = 'block';
        return;
      }
      hideLoginScreen();
      initApp();
    })
    .catch(function() {
      errorEl.textContent = 'Не удалось связаться с сервером.';
      errorEl.style.display = 'block';
    });

  return false;
}

function handleLogout() {
  apiFetch('/api/logout', { method: 'POST' }).then(function() {
    location.reload();
  });
}

function checkAuth() {
  apiFetch('/api/me').then(function(res) {
    if (res.ok) {
      hideLoginScreen();
      initApp();
    } else {
      showLoginScreen();
    }
  }).catch(function() {
    showLoginScreen();
  });
}

function initApp() {
  loadPartners();
}

checkAuth();
```

- [ ] **Step 4: Remove the old top-level `loadPartners()` call**

Find:
```html
var partners = [];
var nextPartnerId = 1;
var activePartnerId = null;
loadPartners();
```
Replace with:
```html
var partners = [];
var nextPartnerId = 1;
var activePartnerId = null;
```
(`loadPartners()` is now invoked from `initApp()`, which only runs after `checkAuth()` confirms a valid session.)

- [ ] **Step 5: Verify by code review**

There is no real Postgres on this machine yet (only `pg-mem` in tests), so this step cannot be exercised end-to-end in a browser until Task 14 provides a deployed database. Re-read the four edits above and confirm: the login form's `onsubmit` matches `handleLogin`, `checkAuth()` is the only top-level call left, and `initApp()` is defined before `checkAuth()` runs (function declarations are hoisted, so definition order in the file does not matter here). Full manual verification happens in Task 14.

- [ ] **Step 6: Commit**

```powershell
git add public/index.html
git commit -m "Add login gate and API fetch helper to the frontend"
```

---

### Task 11: Frontend — wire Partners CRUD to the backend

**Files:**
- Modify: `public/index.html`

**Interfaces:**
- Consumes: `apiFetch` (Task 10), `/api/partners` REST resource (Task 7).

- [ ] **Step 1: Replace `loadPartners` and remove `savePartners`**

Find:
```html
function loadPartners() {
  try {
    var raw = localStorage.getItem('merchant_tools_partners');
    if (raw) {
      var data = JSON.parse(raw);
      partners = data.partners || [];
      nextPartnerId = data.nextPartnerId || 1;
    }
  } catch(e) { logErr('localStorage load error: ' + e.message); }
}
function savePartners() {
  try {
    localStorage.setItem('merchant_tools_partners', JSON.stringify({
      partners: partners,
      nextPartnerId: nextPartnerId
    }));
  } catch(e) { logErr('localStorage save error: ' + e.message); }
}
```
Replace with:
```html
function loadPartners() {
  apiFetch('/api/partners').then(function(res) {
    if (!res.ok) { logErr('Failed to load partners: ' + res.status); return; }
    return res.json();
  }).then(function(data) {
    partners = data || [];
    renderKanban();
  }).catch(function(e) { logErr('loadPartners error: ' + e.message); });
}
```

- [ ] **Step 2: Wire partner creation**

Find:
```html
function savePartner() {
  var name = document.getElementById('partner-name-input').value.trim();
  if (!name) { document.getElementById('partner-name-input').focus(); return; }
  var type = document.getElementById('partner-type-input').value;
  partners.push({ id: nextPartnerId++, name: name, type: type, stage: 's0', checks: {} });
  savePartners();
  closeAddPartner();
  renderKanban();
}
```
Replace with:
```html
function savePartner() {
  var name = document.getElementById('partner-name-input').value.trim();
  if (!name) { document.getElementById('partner-name-input').focus(); return; }
  var type = document.getElementById('partner-type-input').value;
  apiFetch('/api/partners', { method: 'POST', body: JSON.stringify({ name: name, type: type }) })
    .then(function(res) { return res.json().then(function(body) { return { ok: res.ok, body: body }; }); })
    .then(function(result) {
      if (!result.ok) { logErr('Failed to create partner: ' + JSON.stringify(result.body)); return; }
      partners.push(result.body);
      closeAddPartner();
      renderKanban();
    })
    .catch(function(e) { logErr('savePartner error: ' + e.message); });
}
```

- [ ] **Step 3: Wire the drag-drop stage change**

Find (inside `initDragDrop()`):
```html
    col.addEventListener('drop', function(e) {
      e.preventDefault();
      col.classList.remove('drag-over');
      if (draggingId === null) return;
      var newStage = col.getAttribute('data-stage');
      for (var i = 0; i < partners.length; i++) {
        if (partners[i].id === draggingId) {
          partners[i].stage = newStage;
          break;
        }
      }
      savePartners();
      renderKanban();
    });
```
Replace with:
```html
    col.addEventListener('drop', function(e) {
      e.preventDefault();
      col.classList.remove('drag-over');
      if (draggingId === null) return;
      var newStage = col.getAttribute('data-stage');
      apiFetch('/api/partners/' + draggingId, { method: 'PATCH', body: JSON.stringify({ stage: newStage }) })
        .then(function(res) {
          if (!res.ok) { logErr('Failed to update partner stage: ' + draggingId); return null; }
          return res.json();
        })
        .then(function(updated) {
          if (!updated) return;
          for (var i = 0; i < partners.length; i++) {
            if (partners[i].id === draggingId) { partners[i] = updated; break; }
          }
          renderKanban();
        })
        .catch(function(e) { logErr('drag-drop stage update error: ' + e.message); });
    });
```

- [ ] **Step 4: Wire the stage dropdown in the card modal**

Find:
```html
function updateStage(id, stage) {
  for (var i = 0; i < partners.length; i++) {
    if (partners[i].id === id) { partners[i].stage = stage; break; }
  }
  savePartners();
  renderKanban();
}
```
Replace with:
```html
function updateStage(id, stage) {
  apiFetch('/api/partners/' + id, { method: 'PATCH', body: JSON.stringify({ stage: stage }) })
    .then(function(res) {
      if (!res.ok) { logErr('Failed to update partner stage: ' + id); return null; }
      return res.json();
    })
    .then(function(updated) {
      if (!updated) return;
      for (var i = 0; i < partners.length; i++) {
        if (partners[i].id === id) { partners[i] = updated; break; }
      }
      renderKanban();
    })
    .catch(function(e) { logErr('updateStage error: ' + e.message); });
}
```

- [ ] **Step 5: Wire per-partner checklist toggles**

Find:
```html
function toggleCardCheck(id, itemId) {
  for (var i = 0; i < partners.length; i++) {
    if (partners[i].id === id) {
      partners[i].checks[itemId] = !partners[i].checks[itemId];
      break;
    }
  }
  savePartners();
  openCard(id);
}
```
Replace with:
```html
function toggleCardCheck(id, itemId) {
  var p = null;
  for (var i = 0; i < partners.length; i++) { if (partners[i].id === id) { p = partners[i]; break; } }
  if (!p) return;
  var newChecks = Object.assign({}, p.checks);
  newChecks[itemId] = !newChecks[itemId];
  apiFetch('/api/partners/' + id, { method: 'PATCH', body: JSON.stringify({ checks: newChecks }) })
    .then(function(res) {
      if (!res.ok) { logErr('Failed to update partner checks: ' + id); return null; }
      return res.json();
    })
    .then(function(updated) {
      if (!updated) return;
      for (var i = 0; i < partners.length; i++) {
        if (partners[i].id === id) { partners[i] = updated; break; }
      }
      openCard(id);
    })
    .catch(function(e) { logErr('toggleCardCheck error: ' + e.message); });
}
```

- [ ] **Step 6: Wire partner deletion**

Find:
```html
function deletePartner(id) {
  partners = partners.filter(function(p) { return p.id !== id; });
  savePartners();
  closeCard();
}
```
Replace with:
```html
function deletePartner(id) {
  apiFetch('/api/partners/' + id, { method: 'DELETE' })
    .then(function(res) {
      if (res.status !== 204) { logErr('Failed to delete partner ' + id); return; }
      partners = partners.filter(function(p) { return p.id !== id; });
      closeCard();
    })
    .catch(function(e) { logErr('deletePartner error: ' + e.message); });
}
```

- [ ] **Step 7: Verify by code review**

As in Task 10, this cannot be exercised in a real browser without a deployed database. Confirm each replacement matches the "Find" block exactly and that no remaining call sites reference `savePartners` (search the file for `savePartners(` — it should now only appear inside comments, if at all). Full manual verification happens in Task 14.

- [ ] **Step 8: Commit**

```powershell
git add public/index.html
git commit -m "Wire Partners kanban to the backend API"
```

---

### Task 12: Frontend — wire Integration checklist to the backend

**Files:**
- Modify: `public/index.html`

**Interfaces:**
- Consumes: `apiFetch` (Task 10), `/api/integration/:type` REST resource (Task 8).

- [ ] **Step 1: Add per-type lazy-load and save helpers**

Find:
```html
var checkState = {};
```
Replace with:
```html
var checkState = {};
var checklistLoaded = { api: false, mall: false };

function ensureChecklistLoaded(type, callback) {
  if (checklistLoaded[type]) { callback(); return; }
  apiFetch('/api/integration/' + type).then(function(res) { return res.json(); }).then(function(data) {
    Object.assign(checkState, data.checks || {});
    checklistLoaded[type] = true;
    callback();
  }).catch(function(e) { logErr('Failed to load integration checklist: ' + e.message); });
}

function saveChecklist(type) {
  var prefix = type + '_';
  var subset = {};
  Object.keys(checkState).forEach(function(key) {
    if (key.indexOf(prefix) === 0) subset[key] = checkState[key];
  });
  apiFetch('/api/integration/' + type, { method: 'PUT', body: JSON.stringify({ checks: subset }) })
    .catch(function(e) { logErr('Failed to save integration checklist: ' + e.message); });
}
```

- [ ] **Step 2: Load before first render**

Find:
```html
function startOnboarding(type) {
  var container = document.getElementById('checklist-' + type);
  if (container.style.display === 'block') { container.style.display = 'none'; return; }
  renderChecklist(type);
  container.style.display = 'block';
}
```
Replace with:
```html
function startOnboarding(type) {
  var container = document.getElementById('checklist-' + type);
  if (container.style.display === 'block') { container.style.display = 'none'; return; }
  ensureChecklistLoaded(type, function() {
    renderChecklist(type);
    container.style.display = 'block';
  });
}
```

- [ ] **Step 3: Save on every toggle**

Find:
```html
function toggleCheck(type, id) {
  checkState[id] = !checkState[id];
  renderChecklist(type);
}
```
Replace with:
```html
function toggleCheck(type, id) {
  checkState[id] = !checkState[id];
  renderChecklist(type);
  saveChecklist(type);
}
```

- [ ] **Step 4: Save the cleared state when a checklist completes**

Find:
```html
  var container = document.getElementById('checklist-' + type);
  container.style.display = 'none';
  log('Onboarding ' + type + ' completed and reset');
}
```
Replace with:
```html
  var container = document.getElementById('checklist-' + type);
  container.style.display = 'none';
  saveChecklist(type);
  log('Onboarding ' + type + ' completed and reset');
}
```

- [ ] **Step 5: Verify by code review**

Same constraint as Tasks 10–11 — no local database to exercise this against yet. Confirm the four edits match their "Find" blocks exactly, and that `ensureChecklistLoaded` is defined before `startOnboarding` calls it (again, hoisting makes definition order irrelevant, but check the block was inserted in the right place). Full manual verification happens in Task 14.

- [ ] **Step 6: Commit**

```powershell
git add public/index.html
git commit -m "Wire Integration checklist to the backend API"
```

---

### Task 13: Frontend — import creates partners via the API

**Files:**
- Modify: `public/index.html`

**Interfaces:**
- Consumes: `apiFetch`, `/api/partners` (POST + PATCH), `loadPartners()` (Task 11).

- [ ] **Step 1: Rewrite `importPartners`**

Find:
```html
function importPartners(input) {
  var file = input.files[0];
  if (!file) return;
  var reader = new FileReader();
  reader.onload = function(e) {
    try {
      var data = JSON.parse(e.target.result);
      if (!Array.isArray(data.partners)) throw new Error('Неверный формат файла');
      partners = data.partners;
      nextPartnerId = data.nextPartnerId || 1;
      savePartners();
      renderKanban();
      log('Загружено партнёров: ' + partners.length);
    } catch(ex) {
      logErr('Ошибка импорта: ' + ex.message);
      alert('Ошибка загрузки файла: ' + ex.message);
    }
    input.value = '';
  };
  reader.readAsText(file, 'UTF-8');
}
```
Replace with:
```html
function importPartners(input) {
  var file = input.files[0];
  if (!file) return;
  var reader = new FileReader();
  reader.onload = function(e) {
    try {
      var data = JSON.parse(e.target.result);
      if (!Array.isArray(data.partners)) throw new Error('Неверный формат файла');
      var creates = data.partners.map(function(p) {
        return apiFetch('/api/partners', { method: 'POST', body: JSON.stringify({ name: p.name, type: p.type }) })
          .then(function(res) { return res.json(); })
          .then(function(created) {
            return apiFetch('/api/partners/' + created.id, {
              method: 'PATCH',
              body: JSON.stringify({ stage: p.stage, checks: p.checks || {} })
            });
          });
      });
      Promise.all(creates).then(function() {
        loadPartners();
        log('Импортировано партнёров: ' + data.partners.length);
      });
    } catch(ex) {
      logErr('Ошибка импорта: ' + ex.message);
      alert('Ошибка загрузки файла: ' + ex.message);
    }
    input.value = '';
  };
  reader.readAsText(file, 'UTF-8');
}
```

Note: `exportPartners()` needs no change — it already reads from the in-memory `partners` array, which Task 11 keeps populated from the API.

- [ ] **Step 2: Verify by code review**

Same constraint as Tasks 10–12 — deferred to Task 14. Confirm the replaced block matches exactly and that `exportPartners` was left untouched.

- [ ] **Step 3: Commit**

```powershell
git add public/index.html
git commit -m "Make partner import create records via the API"
```

---

### Task 14: Deploy to Railway and run the first end-to-end verification

**Files:** none (infrastructure task; may add a Railway config file if the CLI generates one — commit it if so).

**Interfaces:**
- Consumes: everything from Tasks 1–13.
- Produces: a live URL serving the app with a real Postgres database — the first point where the full login → partners → integration flow can be manually verified in a browser.

- [ ] **Step 1: Install the Railway CLI and log in**

```powershell
npm install -g @railway/cli
railway login
```
Expected: opens a browser to authenticate; terminal shows "Logged in as ...".

- [ ] **Step 2: Create the Railway project and Postgres addon**

```powershell
cd C:\Users\karap\merchant-tools
railway init
railway add --database postgres
```

- [ ] **Step 3: Set environment variables**

Generate a session secret:
```powershell
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```
Copy the output, then set variables on Railway (via `railway variables set KEY=value` for each, or the Railway dashboard):
- `SESSION_SECRET` = the generated value
- `NODE_ENV` = `production`
- `DATABASE_URL` is set automatically by the Postgres addon — confirm it exists with `railway variables`.

- [ ] **Step 4: Deploy**

```powershell
railway up
```
Expected: build succeeds, deployment URL is printed (also visible via `railway domain` if one isn't generated automatically — run `railway domain` to provision one). The app may log DB connection errors until Step 5 runs — that's expected, ignore for now.

- [ ] **Step 5: Save the privileged connection string, then run the schema migration**

Before touching anything else, copy Railway's auto-provisioned (privileged) Postgres URL into a second variable so it survives Step 6, which overwrites `DATABASE_URL` with a restricted one:
```powershell
railway variables
```
Copy the value shown for `DATABASE_URL`, then:
```powershell
railway variables set MIGRATION_DATABASE_URL="<paste the DATABASE_URL value here>"
railway run npm run migrate
```
Expected: prints `Schema applied successfully.` (this creates `users`, `partners`, `integration_checklist`, and `session`).

- [ ] **Step 6: Create a restricted DB role for the running app and switch `DATABASE_URL` to it**

This satisfies the spec requirement that the app never runs under the same privileged role used for migrations. Generate a password:
```powershell
node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"
```
Open an interactive `psql` session against the database:
```powershell
railway connect postgres
```
At the `psql` prompt, run (replacing `PASTE_GENERATED_PASSWORD_HERE`):
```sql
CREATE ROLE merchant_tools_app WITH LOGIN PASSWORD 'PASTE_GENERATED_PASSWORD_HERE';
GRANT CONNECT ON DATABASE railway TO merchant_tools_app;
GRANT USAGE ON SCHEMA public TO merchant_tools_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON users, partners, integration_checklist, session TO merchant_tools_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO merchant_tools_app;
\q
```
Note: this role deliberately has no `CREATE` privilege — it can only read/write rows in the four existing tables, never alter schema.

Take the host/port/database name from the `MIGRATION_DATABASE_URL` value you saved in Step 5 (format `postgres://<user>:<password>@<host>:<port>/<database>`) and build a new connection string with the new role's credentials, then set it as the app's runtime `DATABASE_URL`:
```powershell
railway variables set DATABASE_URL="postgres://merchant_tools_app:<generated-password>@<host>:<port>/<database>"
```
Setting this triggers a redeploy automatically. Confirm the new deploy comes up without DB connection errors: `railway logs`.

- [ ] **Step 7: Create the first user**

```powershell
railway run npm run create-user -- operator1 "ChangeThisPassword123"
```
Expected: prints `Created user: operator1 (id 1)`. Pick a real password and share it with the team out-of-band, not via chat. (This runs fine under the restricted role from Step 6 — it only needs `INSERT`/`SELECT` on `users`, which was granted.)

- [ ] **Step 8: Manual end-to-end smoke test in a browser**

Open the Railway-provided URL. Verify, in order:
1. The login screen appears (not the app) — confirms the whole app is gated as required.
2. Logging in with a wrong password shows an inline error, not a broken page.
3. Logging in with `operator1` / the real password succeeds and shows the "Анализатор фида" tab.
4. Open "Партнёры в работе", click "Завести партнёра", add one — it appears as a card.
5. Drag the card to a different column — reload the page — the card is still in the new column (proves persistence, not just in-memory state).
6. Open the card, check a couple of checklist boxes, close it, reload — the checks are still there.
7. Open "Интеграция", check a few boxes, reload — they're still checked.
8. Click "Выйти" — the login screen reappears, and reloading the URL directly does not show the app without logging in again.

- [ ] **Step 9: Commit any Railway-generated config files**

```powershell
git status
```
If `railway init`/`railway up` created a config file (e.g. `railway.json` or `railway.toml`), add and commit it:
```powershell
git add railway.json
git commit -m "Add Railway deployment config"
```
If nothing was generated, skip this step — there is nothing to commit.
