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

    return {
      statusCode: 200,
      body: JSON.stringify({ success: true, message: 'Password verified.' })
    };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ success: false, message: 'Server error.' }) };
  }
};

