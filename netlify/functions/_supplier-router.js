// netlify/functions/_supplier-router.js
// Shared helper for routing orders to suppliers and generating supplier-specific emails.

const { logActivity } = require('./_activity-log');

/**
 * Assigns supplier_id to orders based on medication_suppliers preferred mapping.
 * Returns map of orderId → supplierId for orders that were assigned.
 */
async function routeOrdersToSuppliers(orderIds, queryFn) {
  if (!orderIds || orderIds.length === 0) return {};

  // Get preferred supplier for each order's medication
  const result = await queryFn(
    `UPDATE orders o
     SET supplier_id = ms.supplier_id,
         supplier_product_code = ms.supplier_product_code
     FROM medication_suppliers ms
     WHERE o.medication_id = ms.medication_id
       AND ms.is_preferred = TRUE
       AND o.id = ANY($1)
       AND o.supplier_id IS NULL
     RETURNING o.id, o.supplier_id`,
    [orderIds]
  );

  const assignments = {};
  for (const row of result.rows) {
    assignments[row.id] = row.supplier_id;
  }
  return assignments;
}

/**
 * Groups orders by supplier into supplier_orders batch records.
 * Returns array of { supplierOrder, orderIds }.
 */
async function createSupplierBatches(orderIds, userId, queryFn) {
  if (!orderIds || orderIds.length === 0) return [];

  // Get orders grouped by supplier
  const ordersResult = await queryFn(
    `SELECT id, supplier_id FROM orders
     WHERE id = ANY($1) AND supplier_id IS NOT NULL
     ORDER BY supplier_id`,
    [orderIds]
  );

  // Group by supplier
  const bySupplier = {};
  for (const row of ordersResult.rows) {
    if (!bySupplier[row.supplier_id]) bySupplier[row.supplier_id] = [];
    bySupplier[row.supplier_id].push(row.id);
  }

  const batches = [];
  for (const [supplierId, supplierOrderIds] of Object.entries(bySupplier)) {
    // Create supplier_orders batch record
    const batchResult = await queryFn(
      `INSERT INTO supplier_orders (supplier_id, status, sent_by)
       VALUES ($1, 'draft', $2)
       RETURNING id, supplier_id, batch_ref, status, created_at`,
      [supplierId, userId || null]
    );

    const supplierOrder = batchResult.rows[0];

    // Link orders to this supplier batch
    await queryFn(
      `UPDATE orders SET supplier_order_id = $1 WHERE id = ANY($2)`,
      [supplierOrder.id, supplierOrderIds]
    );

    batches.push({
      supplierOrder,
      orderIds: supplierOrderIds
    });
  }

  return batches;
}

/**
 * Generates supplier-specific email content for a supplier_orders batch.
 * Returns { to, subject, body, supplier } ready for email.
 */
async function generateSupplierEmail(supplierOrderId, queryFn) {
  // Get supplier order with supplier details
  const soResult = await queryFn(
    `SELECT so.*, s.name AS supplier_name, s.account_number, s.contact_email
     FROM supplier_orders so
     JOIN suppliers s ON s.id = so.supplier_id
     WHERE so.id = $1`,
    [supplierOrderId]
  );

  if (soResult.rows.length === 0) return null;
  const so = soResult.rows[0];

  // Get linked orders with medication details
  const ordersResult = await queryFn(
    `SELECT o.id, o.medication_id, o.quantity, o.urgency, o.supplier_product_code,
       CASE WHEN m.strength IS NULL OR m.strength = 'N/A' THEN m.name
            ELSE m.name || ' ' || m.strength END AS medication_name,
       m.form AS medication_form
     FROM orders o
     LEFT JOIN medications m ON m.id = o.medication_id
     WHERE o.supplier_order_id = $1
     ORDER BY CASE o.urgency WHEN 'urgent' THEN 0 WHEN 'routine' THEN 1 ELSE 2 END, m.name`,
    [supplierOrderId]
  );

  // Get items_per_box for display
  const medIds = ordersResult.rows.map(o => o.medication_id);
  const ipbResult = await queryFn(
    `SELECT DISTINCT ON (medication_id) medication_id, items_per_box
     FROM batches
     WHERE medication_id = ANY($1) AND items_per_box IS NOT NULL AND items_per_box > 0
     ORDER BY medication_id`,
    [medIds]
  );
  const ipbMap = {};
  for (const row of ipbResult.rows) {
    ipbMap[row.medication_id] = row.items_per_box;
  }

  const orders = ordersResult.rows.map(o => {
    const ipb = ipbMap[o.medication_id] || 1;
    return {
      ...o,
      quantityBoxes: Math.ceil(o.quantity / ipb),
      quantityItems: o.quantity,
      itemsPerBox: ipb
    };
  });

  const urgentItems = orders.filter(o => o.urgency === 'urgent');
  const routineItems = orders.filter(o => o.urgency === 'routine');
  const nonUrgentItems = orders.filter(o => o.urgency === 'non-urgent');

  const now = new Date();
  const dateStr = now.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  const timeStr = now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });

  const formatItem = (o, idx) => {
    let line = `${idx + 1}. ${o.medication_name}`;
    if (o.supplier_product_code) line += ` [${o.supplier_product_code}]`;
    line += ` - ${o.quantityBoxes} ${o.quantityBoxes === 1 ? 'box' : 'boxes'} (${o.quantityItems} items)`;
    return line;
  };

  let body = `Dear ${so.supplier_name},\n\n`;
  if (so.account_number) {
    body += `Account Number: ${so.account_number}\n\n`;
  }
  body += `Please find below our stock order for ${orders.length} medication${orders.length !== 1 ? 's' : ''}.\n\n`;
  body += `STOCK ORDER\n===========\n\n`;

  if (urgentItems.length > 0) {
    body += `URGENT ITEMS:\n`;
    body += urgentItems.map(formatItem).join('\n');
    body += '\n\n';
  }

  if (routineItems.length > 0) {
    body += `ROUTINE ITEMS:\n`;
    body += routineItems.map(formatItem).join('\n');
    body += '\n\n';
  }

  if (nonUrgentItems.length > 0) {
    body += `NON-URGENT ITEMS:\n`;
    body += nonUrgentItems.map(formatItem).join('\n');
    body += '\n\n';
  }

  const totalBoxes = orders.reduce((sum, o) => sum + o.quantityBoxes, 0);
  body += `Total: ${orders.length} medication${orders.length !== 1 ? 's' : ''}, ${totalBoxes} boxes\n\n`;
  body += `Order Date: ${dateStr} ${timeStr}\n\n`;
  body += `Please confirm receipt and expected delivery date.\n\nKind regards,\nMedicana Pharmacy`;

  const subject = `STOCK ORDER - ${so.supplier_name} - ${orders.length} item${orders.length !== 1 ? 's' : ''} - ${dateStr}`;

  return {
    to: so.contact_email || '',
    subject,
    body,
    supplier: {
      id: so.supplier_id,
      name: so.supplier_name,
      accountNumber: so.account_number,
      contactEmail: so.contact_email
    },
    supplierOrderId: so.id,
    batchRef: so.batch_ref,
    orderCount: orders.length,
    totalBoxes,
    orders: orders.map(o => ({
      orderId: o.id,
      medicationName: o.medication_name,
      supplierProductCode: o.supplier_product_code,
      quantityBoxes: o.quantityBoxes,
      quantityItems: o.quantityItems,
      urgency: o.urgency
    }))
  };
}

/**
 * Full routing pipeline: assign suppliers → create batches → generate emails.
 * Returns { supplierBatches, unassignedOrderIds }.
 */
async function routeAndBatchOrders(orderIds, userId, queryFn) {
  // Step 1: Assign suppliers to orders
  const assignments = await routeOrdersToSuppliers(orderIds, queryFn);

  // Identify unassigned orders (no preferred supplier mapped)
  const assignedIds = Object.keys(assignments).map(Number);
  const unassignedOrderIds = orderIds.filter(id => !assignedIds.includes(id));

  // Step 2: Create supplier batches
  const batches = await createSupplierBatches(assignedIds, userId, queryFn);

  // Step 3: Generate emails for each batch
  const supplierBatches = [];
  for (const batch of batches) {
    const email = await generateSupplierEmail(batch.supplierOrder.id, queryFn);
    supplierBatches.push(email);
  }

  return { supplierBatches, unassignedOrderIds };
}

module.exports = {
  routeOrdersToSuppliers,
  createSupplierBatches,
  generateSupplierEmail,
  routeAndBatchOrders
};
