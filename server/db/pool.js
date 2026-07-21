const { Pool } = require('pg');

function createPool(connectionString) {
  return new Pool({ connectionString });
}

module.exports = { createPool };
