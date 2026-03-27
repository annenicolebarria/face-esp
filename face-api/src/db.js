const { Pool } = require('pg')

const useSsl = process.env.DB_SSL !== 'false'

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: useSsl ? { rejectUnauthorized: false } : false,
})

async function query(text, params = []) {
  return pool.query(text, params)
}

module.exports = {
  pool,
  query,
}
