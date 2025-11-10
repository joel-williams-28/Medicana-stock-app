// netlify/functions/medication-upsert.js
// Finds or creates a medication by barcode or slug (name+strength+form)
// Returns the medication ID to use for batch operations
const db = require('./_db');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { 
      statusCode: 405, 
      body: JSON.stringify({ success: false, message: 'Method not allowed' }) 
    };
  }

  try {
    const { 
      name, 
      strength, 
      form,       // maps to "form" in DB
      barcode,
      standardItemsPerBox,
      minLevel,          // boxes
      minLevelBoxes      // boxes (alt name tolerated)
    } = JSON.parse(event.body || '{}');

    // Accept either 'minLevel' or 'minLevelBoxes' from client; prefer a defined one
    const rawMin = (minLevelBoxes !== undefined ? minLevelBoxes : minLevel);
    const minBoxes = Number.isFinite(Number(rawMin)) ? Number(rawMin) : 0;
    const minProvided = (minLevelBoxes !== undefined || minLevel !== undefined);

    // Validate required fields
    if (!name) {
      return {
        statusCode: 400,
        body: JSON.stringify({ 
          success: false, 
          message: 'Missing required field: name' 
        })
      };
    }

    let medicationId = null;

    // Strategy 1: If barcode provided, find or create by barcode
    if (barcode && barcode.trim()) {
      const barcodeResult = await db.query(
        'SELECT id FROM medications WHERE barcode = $1',
        [barcode.trim()]
      );

      if (barcodeResult.rows.length > 0) {
        // Found existing medication by barcode - update min_level_boxes if provided
        medicationId = barcodeResult.rows[0].id;
        if (minProvided) {
          await db.query(
            'UPDATE medications SET min_level_boxes = $1 WHERE id = $2',
            [minBoxes, medicationId]
          );
        }
      } else {
        // Create new medication with barcode
        const maxIdResult = await db.query('SELECT COALESCE(MAX(id::integer), 0) + 1 AS next_id FROM medications WHERE id ~ \'^[0-9]+$\'');
        medicationId = String(maxIdResult.rows[0].next_id);

        await db.query(
          `INSERT INTO medications 
           (id, name, strength, form, barcode, min_level_boxes, standard_items_per_box, fefo, is_active)
           VALUES ($1, $2, $3, $4, $5, $6, $7, true, true)`,
          [
            medicationId,
            name,
            strength || '',
            form || 'stock',
            barcode.trim(),
            minBoxes,
            standardItemsPerBox || null
          ]
        );
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
        // Found existing medication by slug - update min_level_boxes if provided
        medicationId = slugResult.rows[0].id;
        if (minProvided) {
          await db.query(
            'UPDATE medications SET min_level_boxes = $1 WHERE id = $2',
            [minBoxes, medicationId]
          );
        }
      } else {
        // Create new medication without barcode
        const maxIdResult = await db.query('SELECT COALESCE(MAX(id::integer), 0) + 1 AS next_id FROM medications WHERE id ~ \'^[0-9]+$\'');
        medicationId = String(maxIdResult.rows[0].next_id);

        await db.query(
          `INSERT INTO medications 
           (id, name, strength, form, barcode, min_level_boxes, standard_items_per_box, fefo, is_active)
           VALUES ($1, $2, $3, $4, $5, $6, $7, true, true)`,
          [
            medicationId,
            name,
            strengthValue || '',
            formValue,
            '', // No barcode
            minBoxes,
            standardItemsPerBox || null
          ]
        );
      }
    }

    return {
      statusCode: 200,
      body: JSON.stringify({ 
        success: true, 
        medicationId 
      })
    };
  } catch (e) {
    console.error('medication-upsert error:', e);
    return {
      statusCode: 500,
      body: JSON.stringify({ success: false, message: 'Server error.' })
    };
  }
};

