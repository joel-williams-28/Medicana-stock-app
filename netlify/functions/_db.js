// netlify/functions/_db.js
// Tenant-aware database helper with connection pool caching.
const { Pool } = require('pg');
const { resolveTenant } = require('./_tenants');

// Pool cache — one pool per tenant, persists across warm invocations
const pools = {};

function getPool(tenant) {
  const key = tenant ? tenant.slug : '_default';
  if (!pools[key]) {
    const connectionString = tenant
      ? process.env[tenant.dbEnvVar] || process.env.DATABASE_URL
      : process.env.DATABASE_URL;
    pools[key] = new Pool({
      connectionString,
      ssl: true,
      statement_timeout: 30000,
      idle_in_transaction_session_timeout: 30000,
      // Serverless-friendly pool sizing: each warm function container serves
      // one request at a time, so a small pool avoids exhausting Neon's
      // compute connection budget when many containers are warm.
      max: 3,
      // Drop idle sockets quickly so Neon's free-tier compute can scale to zero.
      idleTimeoutMillis: 10000,
      // Fail fast instead of hanging if Neon is waking from cold start
      // longer than expected — the client will see a clear error.
      connectionTimeoutMillis: 10000
    });
  }
  return pools[key];
}

// Default pool (backward compat for dev/testing)
const defaultPool = { get pool() { return getPool(null); } };

// ── Response helpers (tenant-independent) ──────────────────────────

const json = (statusCode, body) => ({
  statusCode,
  body: JSON.stringify(body)
});

const ok = (data = {}) => json(200, { success: true, ...data });
const fail = (statusCode, message, extra = {}) => json(statusCode, { success: false, message, ...extra });
const methodNotAllowed = () => fail(405, 'Method not allowed');
const tenantNotFound = () => fail(404, 'Organisation not found. Please check the URL.');
const serverError = (label, err) => {
  console.error(`${label} error:`, err);
  return fail(500, 'Server error.');
};

// Safe body parser that handles Netlify's base64 encoding
function parseBody(event) {
  let raw = event.body || '{}';
  if (event.isBase64Encoded) {
    raw = Buffer.from(raw, 'base64').toString('utf-8');
  }
  return JSON.parse(raw);
}

/**
 * Returns a tenant-scoped db object with the same API surface.
 * Usage in handler:
 *   const tdb = db.forTenant(event);
 *   if (!tdb) return db.tenantNotFound();
 *   const result = await tdb.query('SELECT ...', [...]);
 */
function forTenant(event) {
  const tenant = resolveTenant(event);
  if (!tenant) return null;
  const tenantPool = getPool(tenant);
  return {
    query: (text, params) => tenantPool.query(text, params),
    pool: tenantPool,
    tenant,
    // Re-export all response helpers for convenience
    json,
    ok,
    fail,
    methodNotAllowed,
    serverError,
    parseBody
  };
}

module.exports = {
  pool: defaultPool.pool,
  query: (text, params) => getPool(null).query(text, params),
  json,
  ok,
  fail,
  methodNotAllowed,
  tenantNotFound,
  serverError,
  parseBody,
  forTenant
};
