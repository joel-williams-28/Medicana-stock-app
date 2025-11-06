// netlify/functions/meds-add.js
// Adds or updates a medication in the database
const db = require('./_db');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { 
      statusCode: 405, 
      body: JSON.stringify({ success: false, message: 'Method not allowed' }) 
    };
  }

  try {
    const body = JSON.parse(event.body || '{}');
    const { 
      id, 
      name, 
      strength, 
      type,       // maps to "form" in DB
      barcode, 
      minLevel,  // This should be boxes, not items
      standardItemsPerBox 
    } = body;

    console.log('meds-add received:', { id, name, minLevel, standardItemsPerBox });

    // Convert minLevel to boxes (treating it as boxes already)
    const minBoxes = Number.isFinite(Number(minLevel)) ? Number(minLevel) : 0;
    
    console.log('meds-add parsed minBoxes:', minBoxes);

    // Validate required fields
    if (!id || !name) {
      return {
        statusCode: 400,
        body: JSON.stringify({ 
          success: false, 
          message: 'Missing required fields: id, name' 
        })
      };
    }

    // Upsert medication
    // Try min_level_boxes first, fall back to min_level if column doesn't exist yet
    let query = `
      INSERT INTO medications 
        (id, name, strength, form, barcode, min_level_boxes, standard_items_per_box, fefo)
      VALUES ($1, $2, $3, $4, $5, $6, $7, true)
      ON CONFLICT (id) 
      DO UPDATE SET
        name = EXCLUDED.name,
        strength = EXCLUDED.strength,
        form = EXCLUDED.form,
        barcode = EXCLUDED.barcode,
        min_level_boxes = EXCLUDED.min_level_boxes,
        standard_items_per_box = EXCLUDED.standard_items_per_box
    `;

    try {
      await db.query(query, [
        id,
        name,
        strength || '',
        type || 'stock',
        barcode || '',
        minBoxes,
        standardItemsPerBox || null
      ]);
      console.log('meds-add: Successfully inserted/updated medication with min_level_boxes:', minBoxes);
    } catch (dbError) {
      // If min_level_boxes column doesn't exist, try with min_level (for backward compatibility during migration)
      if (dbError.message && dbError.message.includes('min_level_boxes')) {
        console.warn('meds-add: min_level_boxes column not found, trying min_level instead');
        query = `
          INSERT INTO medications 
            (id, name, strength, form, barcode, min_level, standard_items_per_box, fefo)
          VALUES ($1, $2, $3, $4, $5, $6, $7, true)
          ON CONFLICT (id) 
          DO UPDATE SET
            name = EXCLUDED.name,
            strength = EXCLUDED.strength,
            form = EXCLUDED.form,
            barcode = EXCLUDED.barcode,
            min_level = EXCLUDED.min_level,
            standard_items_per_box = EXCLUDED.standard_items_per_box
        `;
        await db.query(query, [
          id,
          name,
          strength || '',
          type || 'stock',
          barcode || '',
          minBoxes,
          standardItemsPerBox || null
        ]);
        console.log('meds-add: Successfully inserted/updated medication with min_level (fallback):', minBoxes);
      } else {
        throw dbError;
      }
    }

    return {
      statusCode: 200,
      body: JSON.stringify({ success: true })
    };
  } catch (e) {
    console.error('meds-add error:', e);
    return {
      statusCode: 500,
      body: JSON.stringify({ success: false, message: 'Server error.' })
    };
  }
};

