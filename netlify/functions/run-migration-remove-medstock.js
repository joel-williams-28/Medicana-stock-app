// One-shot migration: Remove "Medication Stock L1" as a physical location.
// It is an umbrella group heading for Cupboards 1, 2, 3 — not a real location.
// DELETE THIS FILE after running the migration successfully.

const db = require('./_db');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return db.methodNotAllowed();

  try {
    const results = [];

    // Step 1: Move inventory from med-stock-l1 to cupboard-1
    const inv = await db.query(
      `UPDATE inventory SET location_id = 'cupboard-1' WHERE location_id = 'med-stock-l1'`
    );
    results.push(`Inventory rows moved: ${inv.rowCount}`);

    // Step 2: Move location_min_levels (skip duplicates)
    const lml = await db.query(`
      UPDATE location_min_levels
      SET location_id = 'cupboard-1'
      WHERE location_id = 'med-stock-l1'
        AND NOT EXISTS (
          SELECT 1 FROM location_min_levels lml2
          WHERE lml2.medication_id = location_min_levels.medication_id
            AND lml2.location_id = 'cupboard-1'
        )
    `);
    results.push(`Min level rows moved: ${lml.rowCount}`);

    // Delete any remaining duplicates
    const lmlDel = await db.query(
      `DELETE FROM location_min_levels WHERE location_id = 'med-stock-l1'`
    );
    results.push(`Min level duplicate rows deleted: ${lmlDel.rowCount}`);

    // Step 3: Update transactions
    const tx = await db.query(
      `UPDATE transactions SET location_id = 'cupboard-1' WHERE location_id = 'med-stock-l1'`
    );
    results.push(`Transaction rows updated: ${tx.rowCount}`);

    // Step 4: Update activity_log
    const al = await db.query(
      `UPDATE activity_log SET location_id = 'cupboard-1' WHERE location_id = 'med-stock-l1'`
    );
    results.push(`Activity log rows updated: ${al.rowCount}`);

    // Step 5: Update users
    const usr = await db.query(
      `UPDATE users SET location = 'cupboard-1' WHERE location = 'med-stock-l1'`
    );
    results.push(`User rows updated: ${usr.rowCount}`);

    // Step 6: Delete the location
    const del = await db.query(`DELETE FROM locations WHERE id = 'med-stock-l1'`);
    results.push(`Location deleted: ${del.rowCount}`);

    // Verify
    const verify = await db.query(
      `SELECT id, display_name, group_name FROM locations ORDER BY group_name, display_name`
    );

    return db.ok({ results, locations: verify.rows });
  } catch (err) {
    return db.serverError('run-migration-remove-medstock', err);
  }
};
