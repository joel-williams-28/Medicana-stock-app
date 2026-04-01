// netlify/functions/barcode-lookup.js
// Looks up medication by barcode and returns medication details + existing batches
const db = require('./_db');
const { normalizeBarcode } = require('./_barcode-utils');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return db.methodNotAllowed();

  try {
    const tdb = db.forTenant(event);
    if (!tdb) return db.tenantNotFound();

    const { barcode } = JSON.parse(event.body || '{}');

    if (!barcode || !barcode.trim()) {
      return db.fail(400, 'Barcode is required');
    }

    const normalized = normalizeBarcode(barcode);
    // Also build the 14-digit padded form for fallback matching against legacy data
    const padded = normalized.length === 13 && /^\d+$/.test(normalized)
      ? '0' + normalized
      : null;

    const medResult = await tdb.query(
      `SELECT id, name, strength, form, standard_items_per_box, barcode, brand, fefo, min_level_boxes
       FROM medications
       WHERE barcode = $1${padded ? ' OR barcode = $2' : ''}`,
      padded ? [normalized, padded] : [normalized]
    );

    if (medResult.rows.length === 0) {
      return db.ok({ found: false });
    }

    const medication = medResult.rows[0];
    const strengthRaw = medication.strength && medication.strength !== 'N/A'
      ? medication.strength
      : null;

    const batchesResult = await tdb.query(
      `SELECT id, batch_code, expiry_date, brand, items_per_box
       FROM batches
       WHERE medication_id = $1
       ORDER BY expiry_date DESC, batch_code`,
      [medication.id]
    );

    const existingBatches = batchesResult.rows.map(batch => ({
      id: batch.id,
      batchCode: batch.batch_code || '',
      expiryDate: batch.expiry_date
        ? new Date(batch.expiry_date).toISOString().slice(0, 10)
        : null,
      itemsPerBox: batch.items_per_box || null,
      brand: batch.brand || ''
    }));

    return db.ok({
      found: true,
      medication: {
        id: medication.id,
        name: medication.name,
        strength_raw: strengthRaw,
        type: medication.form || 'Tablet',
        standard_items_per_box: medication.standard_items_per_box || null,
        barcode: medication.barcode,
        brand: medication.brand || null,
        fefo: medication.fefo !== false,
        min_level_boxes: medication.min_level_boxes || 0
      },
      existingBatches
    });
  } catch (e) {
    return db.serverError('barcode-lookup', e);
  }
};
