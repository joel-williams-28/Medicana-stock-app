// netlify/functions/medication-upsert.js
// Finds or creates a medication by barcode or slug (name+strength+form)
// Returns the medication ID to use for batch operations
const db = require('./_db');
const { logActivity } = require('./_activity-log');

// Generates next sequential ID for medications
async function getNextMedicationId() {
  const result = await db.query(
    "SELECT COALESCE(MAX(id::integer), 0) + 1 AS next_id FROM medications WHERE id ~ '^[0-9]+$'"
  );
  return String(result.rows[0].next_id);
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return db.methodNotAllowed();

  try {
    const {
      name,
      strength,
      form,
      barcode,
      standardItemsPerBox,
      minLevel,
      minLevelBoxes,
      userId
    } = JSON.parse(event.body || '{}');

    const rawMin = (minLevelBoxes !== undefined ? minLevelBoxes : minLevel);
    const minBoxes = Number.isFinite(Number(rawMin)) ? Number(rawMin) : 0;
    const minProvided = (minLevelBoxes !== undefined || minLevel !== undefined);

    if (!name) {
      return db.fail(400, 'Missing required field: name');
    }

    let medicationId = null;
    let wasCreated = false;

    // Strategy 1: Find or create by barcode
    if (barcode && barcode.trim()) {
      const barcodeResult = await db.query(
        'SELECT id FROM medications WHERE barcode = $1',
        [barcode.trim()]
      );

      if (barcodeResult.rows.length > 0) {
        medicationId = barcodeResult.rows[0].id;
        if (minProvided) {
          await db.query('UPDATE medications SET min_level_boxes = $1 WHERE id = $2', [minBoxes, medicationId]);
        }
      } else {
        medicationId = await getNextMedicationId();
        await db.query(
          `INSERT INTO medications
           (id, name, strength, form, barcode, min_level_boxes, standard_items_per_box, fefo, is_active)
           VALUES ($1, $2, $3, $4, $5, $6, $7, true, true)`,
          [medicationId, name, strength || '', form || 'stock', barcode.trim(), minBoxes, standardItemsPerBox || null]
        );
        wasCreated = true;
      }
    } else {
      // Strategy 2: Find or create by slug (name + strength + form)
      const strengthValue = strength && strength !== 'N/A' ? strength : null;
      const formValue = form || 'stock';

      const slugResult = await db.query(
        `SELECT id FROM medications
         WHERE name = $1
           AND (strength = $2 OR (strength IS NULL AND $2 IS NULL))
           AND form = $3
           AND (barcode IS NULL OR barcode = '')`,
        [name, strengthValue, formValue]
      );

      if (slugResult.rows.length > 0) {
        medicationId = slugResult.rows[0].id;
        if (minProvided) {
          await db.query('UPDATE medications SET min_level_boxes = $1 WHERE id = $2', [minBoxes, medicationId]);
        }
      } else {
        medicationId = await getNextMedicationId();
        await db.query(
          `INSERT INTO medications
           (id, name, strength, form, barcode, min_level_boxes, standard_items_per_box, fefo, is_active)
           VALUES ($1, $2, $3, $4, $5, $6, $7, true, true)`,
          [medicationId, name, strengthValue || '', formValue, '', minBoxes, standardItemsPerBox || null]
        );
        wasCreated = true;
      }
    }

    if (wasCreated) {
      await logActivity({
        userId: userId || null,
        actionType: 'medication_created',
        entityType: 'medication',
        entityId: medicationId,
        details: {
          medicationName: name,
          strength: strength || null,
          form: form || null,
          barcode: barcode || null,
          minLevelBoxes: minBoxes,
          standardItemsPerBox: standardItemsPerBox || null
        }
      });
    }

    return db.ok({ medicationId, wasCreated });
  } catch (e) {
    return db.serverError('medication-upsert', e);
  }
};
