// netlify/functions/medication-upsert.js
// Finds or creates a medication by barcode or slug (name+strength+form)
// Returns the medication ID to use for batch operations
const db = require('./_db');
const { logActivity } = require('./_activity-log');
const { normalizeBarcode } = require('./_barcode-utils');

// Generates next sequential ID for medications
async function getNextMedicationId(queryFn) {
  const result = await queryFn(
    "SELECT COALESCE(MAX(id::integer), 0) + 1 AS next_id FROM medications WHERE id ~ '^[0-9]+$'"
  );
  return String(result.rows[0].next_id);
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return db.methodNotAllowed();

  try {
    const tdb = db.forTenant(event);
    if (!tdb) return db.tenantNotFound();

    const {
      name,
      strength,
      form,
      barcode,
      brand,
      standardItemsPerBox,
      minLevel,
      minLevelBoxes,
      fefo,
      userId,
      medicationId: explicitMedId
    } = JSON.parse(event.body || '{}');

    const rawMin = (minLevelBoxes !== undefined ? minLevelBoxes : minLevel);
    const minBoxes = Number.isFinite(Number(rawMin)) ? Number(rawMin) : 0;
    const minProvided = (minLevelBoxes !== undefined || minLevel !== undefined);
    const fefoValue = fefo !== undefined ? fefo : true;

    if (!name) {
      return db.fail(400, 'Missing required field: name');
    }

    let medicationId = null;
    let wasCreated = false;

    // Explicit edit by medication ID
    if (explicitMedId) {
      const updateFields = [];
      const updateValues = [];
      let paramIdx = 1;

      if (name) { updateFields.push(`name = $${paramIdx++}`); updateValues.push(name); }
      if (strength !== undefined) { updateFields.push(`strength = $${paramIdx++}`); updateValues.push(strength || ''); }
      if (form) { updateFields.push(`form = $${paramIdx++}`); updateValues.push(form); }
      if (brand !== undefined) { updateFields.push(`brand = $${paramIdx++}`); updateValues.push(brand || null); }
      if (standardItemsPerBox !== undefined) { updateFields.push(`standard_items_per_box = $${paramIdx++}`); updateValues.push(standardItemsPerBox); }
      if (fefo !== undefined) { updateFields.push(`fefo = $${paramIdx++}`); updateValues.push(fefoValue); }
      if (minProvided) { updateFields.push(`min_level_boxes = $${paramIdx++}`); updateValues.push(minBoxes); }

      if (updateFields.length > 0) {
        updateValues.push(explicitMedId);
        await tdb.query(
          `UPDATE medications SET ${updateFields.join(', ')} WHERE id = $${paramIdx}`,
          updateValues
        );
      }

      await logActivity({
        userId: userId || null,
        actionType: 'medication_updated',
        entityType: 'medication',
        entityId: explicitMedId,
        details: { medicationName: name, strength, form, brand, barcode, standardItemsPerBox },
        queryFn: tdb.query
      });

      return db.ok({ medicationId: explicitMedId, wasCreated: false, wasUpdated: true });
    }

    // Strategy 1: Find or create by barcode
    const normalizedBarcode = barcode ? normalizeBarcode(barcode) : null;
    if (normalizedBarcode) {
      const barcodeResult = await tdb.query(
        'SELECT id FROM medications WHERE barcode = $1',
        [normalizedBarcode]
      );

      if (barcodeResult.rows.length > 0) {
        medicationId = barcodeResult.rows[0].id;
        if (minProvided) {
          await tdb.query('UPDATE medications SET min_level_boxes = $1 WHERE id = $2', [minBoxes, medicationId]);
        }
      } else {
        medicationId = await getNextMedicationId(tdb.query);
        await tdb.query(
          `INSERT INTO medications
           (id, name, strength, form, barcode, brand, min_level_boxes, standard_items_per_box, fefo, is_active)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, true)`,
          [medicationId, name, strength || '', form || 'stock', normalizedBarcode, brand || null, minBoxes, standardItemsPerBox || null, fefoValue]
        );
        wasCreated = true;
      }
    } else {
      // Strategy 2: Find or create by slug (name + strength + form + brand + pack size)
      const strengthValue = strength && strength !== 'N/A' ? strength : null;
      const formValue = form || 'stock';
      const brandValue = brand || null;
      const itemsPerBoxValue = standardItemsPerBox != null ? Number(standardItemsPerBox) : null;

      const slugResult = await tdb.query(
        `SELECT id FROM medications
         WHERE LOWER(name) = LOWER($1)
           AND (strength = $2 OR (strength IS NULL AND $2 IS NULL))
           AND form = $3
           AND (brand = $4 OR (brand IS NULL AND $4 IS NULL))
           AND (standard_items_per_box = $5 OR (standard_items_per_box IS NULL AND $5 IS NULL))
           AND (barcode IS NULL OR barcode = '')`,
        [name, strengthValue, formValue, brandValue, itemsPerBoxValue]
      );

      if (slugResult.rows.length > 0) {
        medicationId = slugResult.rows[0].id;
        if (minProvided) {
          await tdb.query('UPDATE medications SET min_level_boxes = $1 WHERE id = $2', [minBoxes, medicationId]);
        }
      } else {
        try {
          medicationId = await getNextMedicationId(tdb.query);
          await tdb.query(
            `INSERT INTO medications
             (id, name, strength, form, barcode, brand, min_level_boxes, standard_items_per_box, fefo, is_active)
             VALUES ($1, $2, $3, $4, NULL, $5, $6, $7, $8, true)`,
            [medicationId, name, strengthValue || '', formValue, brand || null, minBoxes, standardItemsPerBox || null, fefoValue]
          );
          wasCreated = true;
        } catch (insertErr) {
          // Unique constraint violation — fall back to finding the existing medication
          if (insertErr.code === '23505') {
            const existing = await tdb.query(
              `SELECT id FROM medications
               WHERE LOWER(name) = LOWER($1)
                 AND (strength = $2 OR (strength IS NULL AND $2 IS NULL))
                 AND form = $3
               LIMIT 1`,
              [name, strengthValue, formValue]
            );
            if (existing.rows.length > 0) {
              medicationId = existing.rows[0].id;
              if (minProvided) {
                await tdb.query('UPDATE medications SET min_level_boxes = $1 WHERE id = $2', [minBoxes, medicationId]);
              }
            } else {
              throw insertErr;
            }
          } else {
            throw insertErr;
          }
        }
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
          brand: brand || null,
          barcode: barcode || null,
          minLevelBoxes: minBoxes,
          standardItemsPerBox: standardItemsPerBox || null,
          fefo: fefoValue
        },
        queryFn: tdb.query
      });
    }

    return db.ok({ medicationId, wasCreated });
  } catch (e) {
    return db.serverError('medication-upsert', e);
  }
};
