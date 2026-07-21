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
