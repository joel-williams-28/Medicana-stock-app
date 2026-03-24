// netlify/functions/login.js
// Authenticates users against Neon PostgreSQL with bcrypt hashed passwords
const db = require('./_db');
const bcrypt = require('bcryptjs');
const { logActivity } = require('./_activity-log');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return db.methodNotAllowed();

  try {
    const tdb = db.forTenant(event);
    if (!tdb) return db.tenantNotFound();

    const { username, password } = JSON.parse(event.body || '{}');

    if (!username || !password) {
      return db.fail(400, 'Username and password are required.');
    }

    const result = await tdb.query(
      'SELECT id, username, password_hash, email, first_name, full_name, role, active, location FROM users WHERE username = $1',
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

    await logActivity({
      userId: user.id,
      actionType: 'login',
      entityType: 'user',
      entityId: user.id,
      details: { username: user.username, fullName: user.full_name },
      queryFn: tdb.query
    });

    return db.ok({
      message: 'Login successful.',
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        firstName: user.first_name,
        fullName: user.full_name,
        role: user.role,
        primaryLocation: user.location || null
      }
    });
  } catch (err) {
    return db.serverError('login', err);
  }
};
