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
