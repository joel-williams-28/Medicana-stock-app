// netlify/functions/verify.js
// Verifies user password against Neon PostgreSQL with bcrypt hashed passwords
const db = require('./_db');
const bcrypt = require('bcryptjs');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return db.methodNotAllowed();

  try {
    const { username, password } = JSON.parse(event.body || '{}');

    if (!username || !password) {
      return db.fail(400, 'Username and password are required.');
    }

    const result = await db.query(
      'SELECT password_hash, active FROM users WHERE username = $1',
      [username]
    );

    if (result.rows.length === 0) {
      return db.fail(401, 'Invalid credentials.');
    }

    const user = result.rows[0];

    if (!user.active) {
      return db.fail(401, 'Account is inactive.');
    }

    const passwordMatch = await bcrypt.compare(password, user.password_hash);
    if (!passwordMatch) {
      return db.fail(401, 'Invalid credentials.');
    }

    return db.ok({ message: 'Password verified.' });
  } catch (err) {
    return db.serverError('verify', err);
  }
};
