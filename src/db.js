const { Pool } = require('pg');

// Підключення до PostgreSQL. Рядок береться з .env (DATABASE_URL).
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function query(text, params) {
  return pool.query(text, params);
}

module.exports = { pool, query };
