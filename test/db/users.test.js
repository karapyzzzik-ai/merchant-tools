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
