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
