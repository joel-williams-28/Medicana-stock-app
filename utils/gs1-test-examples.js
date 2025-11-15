/**
 * GS1 DataMatrix Parser - Test Examples and Documentation
 *
 * This file demonstrates how various GS1 barcode formats are parsed
 * and how the data flows into the medication stock management system.
 */

// Example 1: Standard GS1 DataMatrix with all common fields (parenthesized format)
const example1 = {
  input: "(01)05012345678901(17)260430(10)LOT12345(21)SN987654",
  description: "Full GS1 DataMatrix with GTIN, expiry, batch, and serial number",
  expectedOutput: {
    isGs1: true,
    gtin: "05012345678901",
    expiryDateRaw: "260430",
    expiryDate: new Date(2026, 3, 30), // April 30, 2026
    batch: "LOT12345",
    serial: "SN987654"
  },
  modalMapping: {
    barcode: "05012345678901",         // Used for medication lookup
    batchNumber: "LOT12345",            // Auto-populated in batch field
    expiryMonth: "04",                  // Auto-populated (April)
    expiryYear: "2026"                  // Auto-populated
  }
};

// Example 2: GS1 without serial number (common in hospital settings)
const example2 = {
  input: "(01)03401234567893(17)251231(10)BATCH-A1",
  description: "GS1 code without serial number - typical for bulk medications",
  expectedOutput: {
    isGs1: true,
    gtin: "03401234567893",
    expiryDateRaw: "251231",
    expiryDate: new Date(2025, 11, 31), // December 31, 2025
    batch: "BATCH-A1",
    serial: undefined
  },
  modalMapping: {
    barcode: "03401234567893",
    batchNumber: "BATCH-A1",
    expiryMonth: "12",
    expiryYear: "2025"
  }
};

// Example 3: Non-parenthesized format with GS separator (ASCII 29)
const example3 = {
  input: "0105012345678901" + String.fromCharCode(29) + "17260430" + String.fromCharCode(29) + "10LOT999",
  description: "GS1 code with ASCII group separator (0x1D) instead of parentheses",
  expectedOutput: {
    isGs1: true,
    gtin: "05012345678901",
    expiryDateRaw: "260430",
    expiryDate: new Date(2026, 3, 30),
    batch: "LOT999",
    serial: undefined
  },
  modalMapping: {
    barcode: "05012345678901",
    batchNumber: "LOT999",
    expiryMonth: "04",
    expiryYear: "2026"
  }
};

// Example 4: Standard 1D barcode (EAN-13) - should NOT be parsed as GS1
const example4 = {
  input: "5012345678900",
  description: "Standard EAN-13 barcode - not GS1, uses existing behavior",
  expectedOutput: {
    isGs1: false,
    raw: "5012345678900"
  },
  modalMapping: {
    barcode: "5012345678900",     // Used as-is
    batchNumber: "",                // Not auto-populated (manual entry)
    expiryMonth: "",                // Not auto-populated (manual entry)
    expiryYear: ""                  // Not auto-populated (manual entry)
  }
};

// Example 5: GS1 with minimal fields (GTIN and expiry only)
const example5 = {
  input: "(01)08712345678906(17)270815",
  description: "Minimal GS1 code with only GTIN and expiry date",
  expectedOutput: {
    isGs1: true,
    gtin: "08712345678906",
    expiryDateRaw: "270815",
    expiryDate: new Date(2027, 7, 15), // August 15, 2027
    batch: undefined,
    serial: undefined
  },
  modalMapping: {
    barcode: "08712345678906",
    batchNumber: "",                // Not available in barcode
    expiryMonth: "08",
    expiryYear: "2027"
  }
};

// Example 6: Invalid expiry date (should handle gracefully)
const example6 = {
  input: "(01)05012345678901(17)261332(10)BATCH123",
  description: "GS1 code with invalid expiry date (month 13, day 32)",
  expectedOutput: {
    isGs1: true,
    gtin: "05012345678901",
    expiryDateRaw: "261332",
    expiryDate: null,               // Invalid date returns null
    batch: "BATCH123",
    serial: undefined
  },
  modalMapping: {
    barcode: "05012345678901",
    batchNumber: "BATCH123",
    expiryMonth: "",                // Invalid date, not populated
    expiryYear: ""                  // Invalid date, not populated
  }
};

/**
 * How GS1 parsing integrates with the app flow:
 *
 * 1. CAMERA SCANNER FLOW (handleBarcodeDetected):
 *    - User scans 2D barcode with mobile camera
 *    - parseGs1Data() extracts GTIN, batch, expiry
 *    - Opens "New Medication" modal with pre-filled fields
 *    - handleBarcodeLookup() uses GTIN to search database
 *    - If found: locks medication fields, preserves GS1 batch/expiry
 *    - User confirms/edits batch, expiry, quantity, location
 *    - Submits to add stock
 *
 * 2. HARDWARE SCANNER FLOW (handleBarcodeScanned):
 *    - User scans with infrared/Bluetooth handheld scanner
 *    - parseGs1Data() extracts GTIN, batch, expiry
 *    - Searches medications by GTIN
 *    - If found: Opens "Stock Adjustment" modal with GS1 data in deliveryForm
 *    - If not found: Opens "New Medication" modal with GS1 data
 *    - User completes transaction
 *
 * 3. BACKWARD COMPATIBILITY:
 *    - Non-GS1 barcodes (1D codes like EAN-13) work exactly as before
 *    - parseGs1Data returns isGs1: false
 *    - App uses original barcode string for lookup
 *    - No automatic batch/expiry population (manual entry required)
 *
 * 4. DATA VALIDATION:
 *    - Invalid expiry dates (month > 12, day > 31) return null
 *    - Missing AIs return undefined for that field
 *    - Raw string always preserved in result.raw for debugging
 *
 * 5. FUTURE EXPANSION:
 *    To add support for additional GS1 AIs:
 *    - Edit utils/parseGs1Data.js
 *    - Add new AI extraction in parseGs1Data() function
 *    - Update ParsedGs1Data interface/JSDoc
 *    - Map to appropriate form field in handleBarcodeDetected/handleBarcodeScanned
 *
 *    Common AIs to consider:
 *    - (30): Variable count (quantity)
 *    - (310n): Net weight in kg (n = decimal position)
 *    - (392n): Price
 *    - (400): Customer purchase order number
 */

// Run tests in browser console
if (typeof window !== 'undefined' && window.parseGs1Data) {
  console.log('=== GS1 DataMatrix Parser Test Examples ===\n');

  const examples = [example1, example2, example3, example4, example5, example6];

  examples.forEach((example, index) => {
    console.log(`\nExample ${index + 1}: ${example.description}`);
    console.log('Input:', example.input);

    const result = window.parseGs1Data(example.input);

    console.log('Parsed result:', {
      isGs1: result.isGs1,
      gtin: result.gtin,
      expiryDateRaw: result.expiryDateRaw,
      expiryDate: result.expiryDate,
      batch: result.batch,
      serial: result.serial
    });

    console.log('Modal field mapping:', example.modalMapping);

    // Verify key expectations
    if (result.isGs1 !== example.expectedOutput.isGs1) {
      console.error('❌ isGs1 mismatch!');
    } else if (result.isGs1) {
      if (result.gtin === example.expectedOutput.gtin) {
        console.log('✅ GTIN extracted correctly');
      } else {
        console.error('❌ GTIN mismatch!');
      }

      if (result.batch === example.expectedOutput.batch) {
        console.log('✅ Batch extracted correctly');
      } else {
        console.error('❌ Batch mismatch!');
      }

      if (result.expiryDateRaw === example.expectedOutput.expiryDateRaw) {
        console.log('✅ Expiry date raw extracted correctly');
      } else {
        console.error('❌ Expiry date raw mismatch!');
      }
    } else {
      console.log('✅ Correctly identified as non-GS1 barcode');
    }
  });

  console.log('\n=== Test Complete ===');
}
