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
    // Try to include location, but handle gracefully if column doesn't exist
    let result;
    try {
      result = await db.query(
        'SELECT id, username, password_hash, email, first_name, full_name, role, active, location FROM users WHERE username = $1',
        [username]
      );
    } catch (err) {
      // If location column doesn't exist, query without it
      if (err.message && err.message.includes('location')) {
        result = await db.query(
          'SELECT id, username, password_hash, email, first_name, full_name, role, active FROM users WHERE username = $1',
          [username]
        );
      } else {
        throw err; // Re-throw if it's a different error
      }
    }

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
      id: user.id,
      username: user.username,
      email: user.email,
      firstName: user.first_name,
      fullName: user.full_name,
      role: user.role,
      primaryLocation: user.location || null
    };

    return {
      statusCode: 200,
      body: JSON.stringify({ success: true, message: 'Login successful.', user: safeUser })
    };
  } catch (err) {
    console.error('Login error:', err);
    console.error('Login error details:', {
      message: err.message,
      stack: err.stack,
      name: err.name
    });
    return { 
      statusCode: 500, 
      body: JSON.stringify({ success: false, message: 'Server error.', error: process.env.NODE_ENV === 'development' ? err.message : undefined }) 
    };
  }
};
