// netlify/functions/suppliers-upsert.js
// Create or update a supplier record
const db = require('./_db');
const { logActivity } = require('./_activity-log');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return db.methodNotAllowed();

  try {
    const tdb = db.forTenant(event);
    if (!tdb) return db.tenantNotFound();

    const {
      id,
      name,
      accountNumber,
      contactEmail,
      contactPhone,
      orderMethod,
      portalUrl,
      notes,
      isActive,
      userId
    } = db.parseBody(event);

    if (!id || !name) {
      return db.fail(400, 'Missing required fields: id, name');
    }

    // Sanitise id to lowercase slug
    const supplierId = id.toLowerCase().replace(/[^a-z0-9_-]/g, '-');

    const result = await tdb.query(
      `INSERT INTO suppliers (id, name, account_number, contact_email, contact_phone, order_method, portal_url, notes, is_active)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (id) DO UPDATE SET
         name = EXCLUDED.name,
         account_number = EXCLUDED.account_number,
         contact_email = EXCLUDED.contact_email,
         contact_phone = EXCLUDED.contact_phone,
         order_method = EXCLUDED.order_method,
         portal_url = EXCLUDED.portal_url,
         notes = EXCLUDED.notes,
         is_active = EXCLUDED.is_active,
         updated_at = NOW()
       RETURNING *`,
      [
        supplierId,
        name,
        accountNumber || null,
        contactEmail || null,
        contactPhone || null,
        orderMethod || 'email',
        portalUrl || null,
        notes || null,
        isActive !== false
      ]
    );

    const supplier = result.rows[0];

    await logActivity({
      userId: userId || null,
      actionType: 'supplier_upserted',
      entityType: 'supplier',
      entityId: supplier.id,
      details: { supplierName: supplier.name, orderMethod: supplier.order_method },
      queryFn: tdb.query
    });

    return db.ok({
      supplier: {
        id: supplier.id,
        name: supplier.name,
        accountNumber: supplier.account_number,
        contactEmail: supplier.contact_email,
        contactPhone: supplier.contact_phone,
        orderMethod: supplier.order_method,
        portalUrl: supplier.portal_url,
        notes: supplier.notes,
        isActive: supplier.is_active,
        createdAt: supplier.created_at,
        updatedAt: supplier.updated_at
      }
    });
  } catch (e) {
    return db.serverError('suppliers-upsert', e);
  }
};
