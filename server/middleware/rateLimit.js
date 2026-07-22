const rateLimit = require('express-rate-limit');

function createLoginLimiter() {
  return rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 5,
    standardHeaders: true,
    legacyHeaders: false,
    // Only failed attempts count. Without this, a handful of legitimate
    // logins from a shared office IP (this is an internal ~20-person tool,
    // manual account provisioning, likely one NAT'd egress IP) could burn
    // through the budget and lock out the whole office for 15 minutes.
    skipSuccessfulRequests: true,
    message: { error: 'too many login attempts, try again later' }
  });
}

module.exports = { createLoginLimiter };
