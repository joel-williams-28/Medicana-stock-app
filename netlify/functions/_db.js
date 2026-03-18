// netlify/functions/_db.js
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false } // Neon needs SSL
});

// Shared response helpers to reduce boilerplate across all functions
const json = (statusCode, body) => ({
  statusCode,
  body: JSON.stringify(body)
});

const ok = (data = {}) => json(200, { success: true, ...data });
const fail = (statusCode, message, extra = {}) => json(statusCode, { success: false, message, ...extra });
const methodNotAllowed = () => fail(405, 'Method not allowed');
const serverError = (label, err) => {
  console.error(`${label} error:`, err);
  return fail(500, 'Server error.');
};

module.exports = {
  query: (text, params) => pool.query(text, params),
  json,
  ok,
  fail,
  methodNotAllowed,
  serverError
};
