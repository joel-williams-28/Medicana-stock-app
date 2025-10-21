// netlify/functions/seed-users.js
// One-time seeding function. Requires POST and a matching token.
// AFTER SUCCESS, DELETE THIS FILE.
const db = require('./_db');
const bcrypt = require('bcryptjs');

exports.handler = async (event) => {
  // Safety: require POST
  if (event.httpMethod === 'GET') {
    return { statusCode: 200, body: JSON.stringify({ ok: true, message: 'seed-users alive (POST required)' }) };
  }
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ ok: false, message: 'Method not allowed' }) };
  }

  // Safety: require a secret token to avoid anyone on the internet seeding your DB
  const token = (event.queryStringParameters && event.queryStringParameters.token) || '';
  const expected = process.env.SEED_TOKEN || '';
  if (!expected || token !== expected) {
    return { statusCode: 401, body: JSON.stringify({ ok: false, message: 'Unauthorised: bad or missing token' }) };
  }

  // EDIT THIS ARRAY to match the users you want to seed.
  // Passwords are hashed before insert. DO NOT keep plaintext passwords elsewhere.
  const initialUsers = [
    { username: 'JWilliams', password: 'medicana01!', email: 'joel.williams@medicana.co.uk', firstName: 'Joel',  fullName: 'Joel Williams',           role: 'Stock Manager' },
    { username: 'NGiudice',  password: 'medicana01!', email: 'Nicolas.Giudice@Medicana.co.uk', firstName: 'Nicolas', fullName: 'Nicolas Del Giudice',  role: 'Stock Manager' },
    { username: 'SBeale',    password: 'medicana01!', email: 'Sonia.Beale@Medicana.co.uk',     firstName: 'Sonia', fullName: 'Sonia Beale',           role: 'Stock Manager' },
    { username: 'ABadiani',  password: 'medicana01!', email: 'Aasit.Badiani@Medicana.co.uk',   firstName: 'Ash',   fullName: 'Aasit Badiani',         role: 'Pharmacist' }
  ];

  try {
    let inserted = 0, updated = 0;

    for (const u of initialUsers) {
      const hash = await bcrypt.hash(u.password, 10);

      // Upsert pattern: try update; if no row updated, insert.
      const up = await db.query(
        `UPDATE users
         SET password_hash = $1, email = $2, first_name = $3, full_name = $4, role = $5, active = true
         WHERE username = $6
         RETURNING id`,
        [hash, u.email, u.firstName, u.fullName, u.role, u.username]
      );

      if (up.rowCount === 1) {
        updated++;
      } else {
        const ins = await db.query(
          `INSERT INTO users (username, password_hash, email, first_name, full_name, role, active)
           VALUES ($1, $2, $3, $4, $5, $6, true)
           ON CONFLICT (username) DO NOTHING
           RETURNING id`,
          [u.username, hash, u.email, u.firstName, u.fullName, u.role]
        );
        if (ins.rowCount === 1) inserted++;
      }
    }

    return {
      statusCode: 200,
      body: JSON.stringify({ ok: true, inserted, updated })
    };
  } catch (err) {
    console.error('seed-users error:', err);
    return { statusCode: 500, body: JSON.stringify({ ok: false, message: 'Server error' }) };
  }
};

