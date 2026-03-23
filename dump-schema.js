#!/usr/bin/env node
// Dumps the Neon database schema in markdown format for CLAUDE.md
// Usage: DATABASE_URL=postgres://... node dump-schema.js
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

async function dumpSchema() {
  const tables = await pool.query(`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public' ORDER BY table_name
  `);

  for (const { table_name } of tables.rows) {
    console.log(`\n### ${table_name}`);
    console.log('| Column | Type | Nullable | Default |');
    console.log('|--------|------|----------|---------|');

    const cols = await pool.query(`
      SELECT column_name, udt_name, is_nullable, column_default
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = $1
      ORDER BY ordinal_position
    `, [table_name]);

    for (const c of cols.rows) {
      console.log(`| ${c.column_name} | ${c.udt_name} | ${c.is_nullable === 'YES' ? 'YES' : 'NO'} | ${c.column_default || ''} |`);
    }

    const constraints = await pool.query(`
      SELECT con.conname, con.contype,
             array_agg(col.attname ORDER BY u.i) AS columns
      FROM pg_constraint con
      JOIN pg_class rel ON rel.oid = con.conrelid
      JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
      CROSS JOIN LATERAL unnest(con.conkey) WITH ORDINALITY AS u(attnum, i)
      JOIN pg_attribute col ON col.attrelid = rel.oid AND col.attnum = u.attnum
      WHERE nsp.nspname = 'public' AND rel.relname = $1
      GROUP BY con.conname, con.contype
    `, [table_name]);

    if (constraints.rows.length > 0) {
      console.log('');
      for (const c of constraints.rows) {
        const type = { p: 'PRIMARY KEY', u: 'UNIQUE', f: 'FOREIGN KEY', c: 'CHECK' }[c.contype] || c.contype;
        console.log(`**${type}:** (${c.columns.join(', ')})`);
      }
    }
  }

  await pool.end();
}

dumpSchema().catch(err => { console.error(err); process.exit(1); });
