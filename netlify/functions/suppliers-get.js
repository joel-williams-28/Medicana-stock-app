// netlify/functions/suppliers-get.js
// Returns all suppliers with optional order count summary
const db = require('./_db');

exports.handler = async (event) => {
  if (event.httpMethod !== 'GET') return db.methodNotAllowed();

  try {
    const tdb = db.forTenant(event);
    if (!tdb) return db.tenantNotFound();

    const result = await tdb.query(`
      SELECT s.*,
        COALESCE(oc.pending_orders, 0) AS pending_orders,
        COALESCE(oc.total_orders, 0) AS total_orders,
        COALESCE(mc.medication_count, 0) AS medication_count
      FROM suppliers s
      LEFT JOIN (
        SELECT supplier_id,
          COUNT(*) FILTER (WHERE status = 'pending') AS pending_orders,
          COUNT(*) AS total_orders
        FROM orders
        WHERE supplier_id IS NOT NULL
        GROUP BY supplier_id
      ) oc ON oc.supplier_id = s.id
      LEFT JOIN (
        SELECT supplier_id, COUNT(*) AS medication_count
        FROM medication_suppliers
        GROUP BY supplier_id
      ) mc ON mc.supplier_id = s.id
      ORDER BY s.name
    `);

    return db.ok({
      suppliers: result.rows.map(r => ({
        id: r.id,
        name: r.name,
        accountNumber: r.account_number,
        contactEmail: r.contact_email,
        contactPhone: r.contact_phone,
        orderMethod: r.order_method,
        portalUrl: r.portal_url,
        notes: r.notes,
        isActive: r.is_active,
        pendingOrders: Number(r.pending_orders),
        totalOrders: Number(r.total_orders),
        medicationCount: Number(r.medication_count),
        createdAt: r.created_at,
        updatedAt: r.updated_at
      }))
    });
  } catch (e) {
    return db.serverError('suppliers-get', e);
  }
};
