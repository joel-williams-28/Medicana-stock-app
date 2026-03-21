# Seed Demo Data: Problems & Solutions

## Context

The `seed-demo-data` Netlify Function populates the database with one month of realistic hospital pharmacy data (medications, batches, inventory, transactions, orders, and activity logs). It runs as a serverless function with a **10-second execution limit** on Netlify.

## Problem 1: `slug` is a Generated Column

**Error:** `cannot insert a non-DEFAULT value into column "slug"`

**Cause:** The `medications.slug` column is a PostgreSQL **generated column** — its value is computed automatically from `name`, `strength`, and `form`. The initial INSERT statement included `slug` in its column list and tried to supply a value.

**Fix:** Remove `slug` from the INSERT column list entirely. PostgreSQL will compute it automatically.

**Commit:** `8364b48` — *Fix: remove slug from INSERT (it's a generated column)*

## Problem 2: Netlify 502 Timeout

**Error:** HTTP 502 Bad Gateway after ~10 seconds

**Cause:** The original implementation used **individual INSERT statements** inside loops — roughly 500+ separate SQL queries:
- 60 medications → 60 INSERTs
- ~180 batches → 180 INSERTs
- ~180 inventory rows → 180 INSERTs
- ~300 transactions → 300 individual INSERTs
- ~50 orders → 50 INSERTs
- Activity logs → 50+ INSERTs

Each query incurs a network round-trip to the Neon PostgreSQL database (hosted externally), so 500+ round-trips easily exceeded the 10-second Netlify Function timeout.

**Fix:** Rewrite all inserts as **bulk/batch operations** using multi-row `VALUES` syntax:

```sql
-- Before (in a loop, one per iteration):
INSERT INTO medications (id, name, ...) VALUES ($1, $2, ...);

-- After (single query, all rows at once):
INSERT INTO medications (id, name, ...) VALUES
  ($1, $2, ...),
  ($3, $4, ...),
  ($5, $6, ...);
```

For large datasets (transactions, activity logs), rows are chunked into groups of **200** to avoid exceeding PostgreSQL's parameter limit (~65535 parameters per query).

This reduced the total query count from ~500+ down to ~20, well within the 10-second limit.

**Commit:** `ac9bc9a` — *Optimize seed-demo-data: bulk inserts to avoid Netlify timeout*

## Key Takeaways

1. **Always check for generated columns** before writing INSERTs against a table. Query `\d+ table_name` or check `CLAUDE.md` schema docs.
2. **Never use per-row INSERTs in serverless functions** when seeding data. Use multi-row `VALUES` or `COPY` instead. Each round-trip to an external database costs 20-50ms, so 500 queries = 10-25 seconds.
3. **Chunk large bulk inserts** to stay under PostgreSQL's parameter limit. 200 rows per chunk is a safe default.
4. **Netlify Functions have a 10-second timeout** (26 seconds on Pro). Design accordingly.
