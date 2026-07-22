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
