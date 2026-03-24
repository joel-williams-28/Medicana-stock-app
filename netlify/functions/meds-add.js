// netlify/functions/meds-add.js
// Adds or updates a medication in the database
const db = require('./_db');
const { logActivity } = require('./_activity-log');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return db.methodNotAllowed();

  try {
    const tdb = db.forTenant(event);
    if (!tdb) return db.tenantNotFound();

    const body = JSON.parse(event.body || '{}');
    const {
      id,
      name,
      strength,
      type,
      barcode,
      minLevel,
      minLevelBoxes,
      standardItemsPerBox
    } = body;

    // Accept either 'minLevel' or 'minLevelBoxes', default to 0
    const rawMin = (minLevelBoxes !== undefined ? minLevelBoxes : minLevel);
    const minBoxes = Number.isFinite(Number(rawMin)) ? Number(rawMin) : 0;

    if (!id || !name) {
      return db.fail(400, 'Missing required fields: id, name');
    }

    // Check if medication already exists by barcode
    if (barcode && barcode.trim()) {
      const check = await tdb.query(
        'SELECT id FROM medications WHERE barcode = $1 LIMIT 1',
        [barcode.trim()]
      );

      if (check.rowCount > 0) {
        const medicationId = check.rows[0].id;

        // Update min_level_boxes for existing medication
        await tdb.query('UPDATE medications SET min_level_boxes = $1 WHERE id = $2', [minBoxes, medicationId]);

        await logActivity({
          userId: null,
          actionType: 'med_updated',
          entityType: 'medication',
          entityId: medicationId,
          details: { minLevelBoxes: minBoxes, reused: true, barcode: barcode.trim() },
          queryFn: tdb.query
        });

        return db.ok({ reused: true, medicationId });
      }
    }

    // No matching barcode - upsert medication
    await tdb.query(
      `INSERT INTO medications
        (id, name, strength, form, barcode, min_level_boxes, standard_items_per_box, fefo)
       VALUES ($1, $2, $3, $4, $5, $6, $7, true)
       ON CONFLICT (id)
       DO UPDATE SET
        name = EXCLUDED.name,
        strength = EXCLUDED.strength,
        form = EXCLUDED.form,
        barcode = EXCLUDED.barcode,
        min_level_boxes = EXCLUDED.min_level_boxes,
        standard_items_per_box = EXCLUDED.standard_items_per_box`,
      [id, name, strength || '', type || 'stock', barcode || '', minBoxes, standardItemsPerBox || null]
    );

    await logActivity({
      userId: null,
      actionType: 'med_upserted',
      entityType: 'medication',
      entityId: id,
      details: { name, strength, form: type, barcode, minLevelBoxes: minBoxes, standardItemsPerBox },
      queryFn: tdb.query
    });

    return db.ok({ medicationId: id });
  } catch (e) {
    return db.serverError('meds-add', e);
  }
};
