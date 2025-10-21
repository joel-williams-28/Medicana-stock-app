// CommonJS style for simplicity on Netlify
const users = require('../data/users.json');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ success: false, message: 'Method not allowed' }) };
  }

  try {
    const { username, password } = JSON.parse(event.body || '{}');

    if (!username || !password) {
      return { statusCode: 400, body: JSON.stringify({ success: false, message: 'Username and password are required.' }) };
    }

    const user = users[username];

    if (!user || user.password !== password) {
      return { statusCode: 401, body: JSON.stringify({ success: false, message: 'Invalid credentials.' }) };
    }

    // Return only non-sensitive fields
    const safeUser = {
      username,
      email: user.email,
      firstName: user.firstName,
      fullName: user.fullName,
      role: user.role
    };

    return {
      statusCode: 200,
      body: JSON.stringify({ success: true, message: 'Login successful.', user: safeUser })
    };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ success: false, message: 'Server error.' }) };
  }
};

