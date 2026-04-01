// netlify/functions/supplier-orders-get.js
// Get supplier order batches with linked order details
const db = require('./_db');

exports.handler = async (event) => {
  if (event.httpMethod !== 'GET') return db.methodNotAllowed();

  try {
    const tdb = db.forTenant(event);
    if (!tdb) return db.tenantNotFound();

    const params = event.queryStringParameters || {};
    const supplierId = params.supplierId;
    const status = params.status;

    // Get supplier order batches
    let batchSql = `
      SELECT so.*, s.name AS supplier_name, s.account_number, s.contact_email,
        u.first_name AS sent_by_name
      FROM supplier_orders so
      JOIN suppliers s ON s.id = so.supplier_id
      LEFT JOIN users u ON u.id = so.sent_by
    `;

    const conditions = [];
    const values = [];

    if (supplierId) {
      values.push(supplierId);
      conditions.push(`so.supplier_id = $${values.length}`);
    }
    if (status) {
      values.push(status);
      conditions.push(`so.status = $${values.length}`);
    }

    if (conditions.length > 0) {
      batchSql += ' WHERE ' + conditions.join(' AND ');
    }
    batchSql += ' ORDER BY so.created_at DESC LIMIT 100';

    const batchResult = await tdb.query(batchSql, values);

    if (batchResult.rows.length === 0) {
      return db.ok({ supplierOrders: [] });
    }

    // Get all linked orders for these batches
    const batchIds = batchResult.rows.map(r => r.id);
    const ordersResult = await tdb.query(`
      SELECT o.id, o.medication_id, o.quantity, o.urgency, o.status,
        o.supplier_order_id, o.supplier_product_code,
        o.quantity_fulfilled, o.fulfilled_at,
        CASE WHEN m.strength IS NULL OR m.strength = 'N/A' THEN m.name
             ELSE m.name || ' ' || m.strength END AS medication_name,
        m.form AS medication_form
      FROM orders o
      LEFT JOIN medications m ON m.id = o.medication_id
      WHERE o.supplier_order_id = ANY($1)
      ORDER BY CASE o.urgency WHEN 'urgent' THEN 0 WHEN 'routine' THEN 1 ELSE 2 END, m.name
    `, [batchIds]);

    // Get items_per_box for box display
    const medIds = [...new Set(ordersResult.rows.map(o => o.medication_id))];
    let ipbMap = {};
    if (medIds.length > 0) {
      const ipbResult = await tdb.query(`
        SELECT DISTINCT ON (medication_id) medication_id, items_per_box
        FROM batches
        WHERE medication_id = ANY($1) AND items_per_box IS NOT NULL AND items_per_box > 0
        ORDER BY medication_id
      `, [medIds]);
      for (const row of ipbResult.rows) {
        ipbMap[row.medication_id] = row.items_per_box;
      }
    }

    // Group orders by supplier_order_id
    const ordersByBatch = {};
    for (const o of ordersResult.rows) {
      if (!ordersByBatch[o.supplier_order_id]) ordersByBatch[o.supplier_order_id] = [];
      const ipb = ipbMap[o.medication_id] || 1;
      ordersByBatch[o.supplier_order_id].push({
        orderId: o.id,
        medicationId: o.medication_id,
        medicationName: o.medication_name,
        medicationForm: o.medication_form,
        supplierProductCode: o.supplier_product_code,
        quantityItems: o.quantity,
        quantityBoxes: Math.ceil(o.quantity / ipb),
        urgency: o.urgency,
        orderStatus: o.status,
        quantityFulfilled: o.quantity_fulfilled,
        fulfilledAt: o.fulfilled_at
      });
    }

    const supplierOrders = batchResult.rows.map(so => ({
      id: so.id,
      supplierId: so.supplier_id,
      supplierName: so.supplier_name,
      accountNumber: so.account_number,
      contactEmail: so.contact_email,
      batchRef: so.batch_ref,
      status: so.status,
      supplierReference: so.supplier_reference,
      expectedDelivery: so.expected_delivery,
      sentAt: so.sent_at,
      confirmedAt: so.confirmed_at,
      dispatchedAt: so.dispatched_at,
      deliveredAt: so.delivered_at,
      sentByName: so.sent_by_name,
      notes: so.notes,
      createdAt: so.created_at,
      orderCount: (ordersByBatch[so.id] || []).length,
      totalBoxes: (ordersByBatch[so.id] || []).reduce((sum, o) => sum + o.quantityBoxes, 0),
      orders: ordersByBatch[so.id] || []
    }));

    return db.ok({ supplierOrders });
  } catch (e) {
    return db.serverError('supplier-orders-get', e);
  }
};
