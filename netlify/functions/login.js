// netlify/functions/login.js
// Authenticates users against Neon PostgreSQL with bcrypt hashed passwords
const db = require('./_db');
const bcrypt = require('bcryptjs');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ success: false, message: 'Method not allowed' }) };
  }

  try {
    const { username, password } = JSON.parse(event.body || '{}');

    if (!username || !password) {
      return { 
        statusCode: 400, 
        body: JSON.stringify({ success: false, message: 'Username and password are required.' }) 
      };
    }

    // Query user from database
    const result = await db.query(
      'SELECT id, username, password_hash, email, first_name, full_name, role, active FROM users WHERE username = $1',
      [username]
    );

    if (result.rows.length === 0) {
      return { 
        statusCode: 401, 
        body: JSON.stringify({ success: false, message: 'Invalid credentials.' }) 
      };
    }

    const user = result.rows[0];

    // Check if user is active
    if (!user.active) {
      return { 
        statusCode: 401, 
        body: JSON.stringify({ success: false, message: 'Account is inactive.' }) 
      };
    }

    // Verify password with bcrypt
    const passwordMatch = await bcrypt.compare(password, user.password_hash);

    if (!passwordMatch) {
      return { 
        statusCode: 401, 
        body: JSON.stringify({ success: false, message: 'Invalid credentials.' }) 
      };
    }

    // Return only non-sensitive fields
    const safeUser = {
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
    console.error('Login error:', err);
    return { 
      statusCode: 500, 
      body: JSON.stringify({ success: false, message: 'Server error.' }) 
    };
  }
};
