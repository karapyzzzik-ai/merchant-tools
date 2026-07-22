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
    // express.json() throws a SyntaxError with .status = 400 on malformed
    // JSON bodies; honor that instead of always reporting 500, without
    // ever leaking err.message/stack to the client.
    const status = err.status || err.statusCode || 500;
    const message = status === 500 ? 'internal server error' : 'invalid request body';
    res.status(status).json({ error: message });
  });

  return app;
}

module.exports = { createApp };
