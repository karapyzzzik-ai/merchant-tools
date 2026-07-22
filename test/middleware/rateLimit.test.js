const { createTestPool } = require('../helpers/testDb');
const { PostgresStore } = require('../../server/middleware/rateLimit');

let pool;
let store;

beforeAll(async () => {
  pool = await createTestPool();
});

afterAll(async () => {
  await pool.end();
});

beforeEach(() => {
  store = new PostgresStore(pool);
  store.init({ windowMs: 15 * 60 * 1000 });
});

afterEach(async () => {
  await pool.query('DELETE FROM rate_limits');
});

test('increment starts a new key at 1', async () => {
  const result = await store.increment('1.2.3.4');
  expect(result.totalHits).toBe(1);
  expect(result.resetTime).toBeInstanceOf(Date);
});

test('increment counts up on repeated calls within the window', async () => {
  await store.increment('1.2.3.4');
  await store.increment('1.2.3.4');
  const result = await store.increment('1.2.3.4');
  expect(result.totalHits).toBe(3);
});

test('increment resets the count once the window has passed', async () => {
  const expiredStore = new PostgresStore(pool);
  expiredStore.init({ windowMs: -1 });
  await expiredStore.increment('5.6.7.8');
  const result = await expiredStore.increment('5.6.7.8');
  expect(result.totalHits).toBe(1);
});

test('decrement lowers the count without going below zero', async () => {
  await store.increment('9.9.9.9');
  await store.increment('9.9.9.9');
  await store.decrement('9.9.9.9');
  const result = await store.increment('9.9.9.9');
  expect(result.totalHits).toBe(2);
});

test('resetKey clears the counter entirely', async () => {
  await store.increment('1.1.1.1');
  await store.resetKey('1.1.1.1');
  const result = await store.increment('1.1.1.1');
  expect(result.totalHits).toBe(1);
});
