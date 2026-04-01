// netlify/functions/medication-suppliers-get.js
// Get medication-supplier mappings with display names
const db = require('./_db');

exports.handler = async (event) => {
  if (event.httpMethod !== 'GET') return db.methodNotAllowed();

  try {
    const tdb = db.forTenant(event);
    if (!tdb) return db.tenantNotFound();

    const params = event.queryStringParameters || {};
    const medicationId = params.medicationId;
    const supplierId = params.supplierId;

    let sql = `
      SELECT ms.*,
        CASE WHEN m.strength IS NULL OR m.strength = 'N/A' THEN m.name
             ELSE m.name || ' ' || m.strength END AS medication_name,
        m.form AS medication_form,
        s.name AS supplier_name
      FROM medication_suppliers ms
      JOIN medications m ON m.id = ms.medication_id
      JOIN suppliers s ON s.id = ms.supplier_id
    `;

    const conditions = [];
    const values = [];

    if (medicationId) {
      values.push(medicationId);
      conditions.push(`ms.medication_id = $${values.length}`);
    }
    if (supplierId) {
      values.push(supplierId);
      conditions.push(`ms.supplier_id = $${values.length}`);
    }

    if (conditions.length > 0) {
      sql += ' WHERE ' + conditions.join(' AND ');
    }

    sql += ' ORDER BY m.name, s.name';

    const result = await tdb.query(sql, values);

    return db.ok({
      mappings: result.rows.map(r => ({
        medicationId: r.medication_id,
        medicationName: r.medication_name,
        medicationForm: r.medication_form,
        supplierId: r.supplier_id,
        supplierName: r.supplier_name,
        supplierProductCode: r.supplier_product_code,
        unitPrice: r.unit_price != null ? Number(r.unit_price) : null,
        isPreferred: r.is_preferred,
        leadTimeDays: r.lead_time_days,
        minOrderQuantity: r.min_order_quantity,
        notes: r.notes,
        updatedAt: r.updated_at
      }))
    });
  } catch (e) {
    return db.serverError('medication-suppliers-get', e);
  }
};
