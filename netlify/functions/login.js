// netlify/functions/login.js
const db = require('./_db');      // our Neon helper (already created)
const bcrypt = require('bcryptjs'); // compare password with stored hash

exports.handler = async (event) => {
  // (Optional) quick heartbeat so GET shows it's alive
  if (event.httpMethod === 'GET') {
    return { statusCode: 200, body: JSON.stringify({ ok: true, message: 'login alive' }) };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ success: false, message: 'Method not allowed' }) };
  }

  try {
    // 1) Read credentials sent by the browser
    const { username, password } = JSON.parse(event.body || '{}');

    if (!username || !password) {
      return { statusCode: 400, body: JSON.stringify({ success: false, message: 'Username and password are required.' }) };
    }

    // 2) Look up the user in Neon
    const { rows } = await db.query(
      'SELECT id, username, password_hash, email, first_name, full_name, role, active FROM users WHERE username = $1',
      [username]
    );
    const user = rows[0];

    // 3) Check user exists and is active
    if (!user || !user.active) {
      return { statusCode: 401, body: JSON.stringify({ success: false, message: 'Invalid credentials.' }) };
    }

    // 4) Compare the password they typed with the stored hash
    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) {
      return { statusCode: 401, body: JSON.stringify({ success: false, message: 'Invalid credentials.' }) };
    }

    // 5) Return a safe user object (no password)
    const safeUser = {
      id: user.id,
      username: user.username,
      email: user.email,
      firstName: user.first_name,
      fullName: user.full_name,
      role: user.role
    };

    return {
      statusCode: 200,
      body: JSON.stringify({ success: true, message: 'Login successful.', user: safeUser })
    };
  } catch (err) {
    console.error('login error:', err);
    return { statusCode: 500, body: JSON.stringify({ success: false, message: 'Server error.' }) };
  }
};