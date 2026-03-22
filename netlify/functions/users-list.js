// netlify/functions/users-list.js
// Returns all active users for dropdowns/filters
const db = require('./_db');

exports.handler = async (event) => {
  if (event.httpMethod !== 'GET') return db.methodNotAllowed();

  try {
    const result = await db.query(
      'SELECT id, username, full_name, role FROM users WHERE active = true ORDER BY full_name'
    );
    return db.json(200, { success: true, users: result.rows });
  } catch (e) {
    return db.serverError('users-list', e);
  }
};
