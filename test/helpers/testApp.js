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
