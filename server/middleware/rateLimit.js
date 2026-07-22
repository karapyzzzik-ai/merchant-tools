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
