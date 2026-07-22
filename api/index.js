require('dotenv').config();
const session = require('express-session');
const PgSession = require('connect-pg-simple')(session);
const { createApp } = require('../server/app');
const { createPool } = require('../server/db/pool');

const pool = createPool(process.env.DATABASE_URL);

const app = createApp({
  pool,
  sessionStore: new PgSession({ pool }),
  sessionSecret: process.env.SESSION_SECRET
});

module.exports = app;
