// netlify/functions/batch-check.js
// Checks if a batch_code exists and returns its canonical details
// Batch integrity safeguard -- do not remove.
const db = require('./_db');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return db.methodNotAllowed();

  try {
    const tdb = db.forTenant(event);
    if (!tdb) return db.tenantNotFound();

    const { batchCode } = JSON.parse(event.body || '{}');

    if (!batchCode || !batchCode.trim()) {
      return db.fail(400, 'batchCode is required');
    }

    // Batch integrity safeguard -- do not remove.
    const result = await tdb.query(
      `SELECT
         b.id,
         b.medication_id,
         b.expiry_date,
         b.brand,
         b.items_per_box,
         b.batch_code,
         m.form,
         CASE
           WHEN m.strength IS NULL OR m.strength = 'N/A' THEN m.name
           ELSE m.name || ' ' || m.strength
         END AS medication_display_id
       FROM batches b
       LEFT JOIN medications m ON m.id = b.medication_id
       WHERE b.batch_code = $1`,
      [batchCode.trim()]
    );

    if (result.rows.length === 0) {
      return db.ok({ exists: false, batch: null });
    }

    const batch = result.rows[0];
    return db.ok({
      exists: true,
      batch: {
        id: batch.id,
        medicationId: batch.medication_id,
        medicationDisplayId: batch.medication_display_id || null,
        batchCode: batch.batch_code,
        expiryDate: batch.expiry_date ? new Date(batch.expiry_date).toISOString().slice(0, 7) : null,
        expiryDateFull: batch.expiry_date ? batch.expiry_date.toISOString() : null,
        brand: batch.brand || '',
        itemsPerBox: batch.items_per_box || null,
        form: batch.form || 'tablet'
      }
    });
  } catch (e) {
    return db.serverError('batch-check', e);
  }
};
