# GS1 DataMatrix Barcode Parsing - Implementation Summary

## Overview

This implementation adds automatic parsing and field population for GS1 DataMatrix 2D barcodes commonly found on medication packaging. The system now extracts product codes (GTIN), batch numbers, expiry dates, and serial numbers from scanned barcodes and automatically populates the relevant form fields.

## What Changed

### Files Created

1. **`utils/parseGs1Data.js`** - Core GS1 parsing utility
   - Parses GS1-encoded barcodes with Application Identifiers (AIs)
   - Supports both parenthesized and non-parenthesized formats
   - Extracts: GTIN (01), Expiry Date (17), Batch (10), Serial (21)
   - Validates and converts YYMMDD expiry dates to JavaScript Date objects
   - Provides helper functions for date formatting

2. **`utils/gs1-test-examples.js`** - Documented test examples
   - Real-world GS1 barcode examples
   - Expected parsing outputs
   - Modal field mappings
   - Usage documentation

3. **`utils/test-gs1-parser.html`** - Interactive test suite
   - Browser-based test runner
   - Visual verification of parsing logic
   - 6 test cases covering common scenarios

### Files Modified

1. **`index.html`**
   - Added script tag to load `parseGs1Data.js` (line 35)
   - Updated `handleBarcodeDetected()` function (lines 1699-1756)
     - Camera scanner callback now parses GS1 codes
     - Auto-populates batch and expiry fields for 2D codes
     - Preserves existing behavior for 1D barcodes
   - Updated `handleBarcodeScanned()` function (lines 1924-2032)
     - Global hardware scanner now parses GS1 codes
     - Populates `deliveryForm` with GS1 data for stock adjustments
     - Populates `barcodeNewMedForm` with GS1 data for new medications

## How It Works

### GS1 Data Structure

GS1 DataMatrix codes use **Application Identifiers (AIs)** to encode multiple fields:

| AI | Field | Format | Example |
|----|-------|--------|---------|
| 01 | GTIN (Product Code) | 14 digits fixed | `05012345678901` |
| 17 | Expiry Date | YYMMDD | `260430` → April 30, 2026 |
| 10 | Batch/Lot Number | Variable length | `LOT12345` |
| 21 | Serial Number | Variable length | `SN987654` |

**Example GS1 String:**
```
(01)05012345678901(17)260430(10)LOT12345(21)SN987654
```

### Parsing Logic

The `parseGs1Data()` function:

1. **Detects GS1 format**
   - Checks for AI patterns like `(01)`, `(17)`, `(10)`, `(21)`
   - Checks for non-parenthesized format starting with `01` + 14 digits
   - Returns `isGs1: false` for standard 1D barcodes

2. **Extracts Application Identifiers**
   - Handles parenthesized format: `(01)12345678901234`
   - Handles GS separator (ASCII 29): `0112345678901234<GS>17260430`
   - Extracts fixed-length fields (GTIN, expiry)
   - Extracts variable-length fields (batch, serial)

3. **Parses and validates expiry dates**
   - Converts YYMMDD → JavaScript Date (assumes 20xx for year)
   - Validates month (1-12) and day (1-31)
   - Returns `null` for invalid dates (e.g., Feb 30)

4. **Returns structured data**
   ```javascript
   {
     isGs1: true,
     gtin: "05012345678901",
     expiryDateRaw: "260430",
     expiryDate: Date(2026-04-30),
     batch: "LOT12345",
     serial: "SN987654",
     raw: "(01)05012345678901..."
   }
   ```

### Integration with Scanner Callbacks

#### Camera Scanner Flow (`handleBarcodeDetected`)

```
User scans 2D barcode with mobile camera
    ↓
html5-qrcode library detects barcode
    ↓
handleBarcodeDetected(barcodeString)
    ↓
parseGs1Data(barcodeString)
    ↓
If GS1 detected:
  - Extract GTIN → use for medication lookup
  - Extract batch → populate batchNumber field
  - Extract expiry → populate expiryMonth & expiryYear
    ↓
handleBarcodeLookup(GTIN)
    ↓
If medication found in database:
  - Lock medication fields (name, strength, type)
  - Preserve GS1 batch and expiry data
    ↓
User confirms/edits → Submits form
```

#### Hardware Scanner Flow (`handleBarcodeScanned`)

```
User scans with infrared/Bluetooth scanner
    ↓
Rapid keystrokes detected (keyboard emulation)
    ↓
handleBarcodeScanned(barcodeString)
    ↓
parseGs1Data(barcodeString)
    ↓
If GS1 detected:
  - Extract GTIN → search medications
  - Extract batch & expiry → store temporarily
    ↓
If medication found:
  - Open "Stock Adjustment" modal
  - Populate deliveryForm with GS1 batch/expiry
Else:
  - Open "New Medication" modal
  - Populate barcodeNewMedForm with GS1 data
    ↓
User completes transaction
```

### Backward Compatibility

**Non-GS1 barcodes (1D codes like EAN-13) work exactly as before:**

- `parseGs1Data()` returns `isGs1: false`
- Original barcode string used for lookup
- No automatic field population
- Manual entry required for batch and expiry

**Test Example:**
```javascript
parseGs1Data("5012345678900")
// Returns: { isGs1: false, raw: "5012345678900" }
// App uses "5012345678900" for lookup (existing behavior)
```

## Form Field Mapping

### New Medication Modal (`barcodeNewMedForm`)

| GS1 Field | Form Field | Notes |
|-----------|------------|-------|
| GTIN | `barcode` | Used for medication lookup |
| Batch | `batchNumber` | Auto-populated, user can edit |
| Expiry | `expiryMonth`, `expiryYear` | Parsed from YYMMDD format |
| Serial | _(not used)_ | Stored in parse result for future use |

### Stock Adjustment Modal (`deliveryForm`)

| GS1 Field | Form Field | Notes |
|-----------|------------|-------|
| Batch | `batchNumber` | Auto-populated for new deliveries |
| Expiry | `expiryMonth`, `expiryYear` | Auto-populated for new batches |

## Test Examples

### Example 1: Full GS1 DataMatrix
**Input:**
```
(01)05012345678901(17)260430(10)LOT12345(21)SN987654
```

**Parsed Output:**
```javascript
{
  isGs1: true,
  gtin: "05012345678901",
  expiryDateRaw: "260430",
  expiryDate: Date(2026-04-30),
  batch: "LOT12345",
  serial: "SN987654"
}
```

**Modal Population:**
- Barcode: `05012345678901`
- Batch: `LOT12345`
- Expiry: April 2026

### Example 2: GS1 Without Serial
**Input:**
```
(01)03401234567893(17)251231(10)BATCH-A1
```

**Parsed Output:**
```javascript
{
  isGs1: true,
  gtin: "03401234567893",
  expiryDateRaw: "251231",
  expiryDate: Date(2025-12-31),
  batch: "BATCH-A1",
  serial: undefined
}
```

**Modal Population:**
- Barcode: `03401234567893`
- Batch: `BATCH-A1`
- Expiry: December 2025

### Example 3: Standard EAN-13 (Not GS1)
**Input:**
```
5012345678900
```

**Parsed Output:**
```javascript
{
  isGs1: false,
  raw: "5012345678900"
}
```

**Modal Population:**
- Barcode: `5012345678900` (as-is)
- Batch: _(manual entry)_
- Expiry: _(manual entry)_

## Validation and Error Handling

### Expiry Date Validation

```javascript
// Valid dates are parsed correctly
parseYYMMDD("260430") → Date(2026-04-30) ✓

// Invalid month returns null
parseYYMMDD("261332") → null (month 13, day 32)

// Invalid day returns null
parseYYMMDD("260230") → null (Feb 30 doesn't exist)
```

### Missing Fields

If a GS1 code doesn't contain certain AIs, those fields are `undefined`:

```javascript
parseGs1Data("(01)08712345678906(17)270815")
// Returns: {
//   isGs1: true,
//   gtin: "08712345678906",
//   expiryDateRaw: "270815",
//   expiryDate: Date(2027-08-15),
//   batch: undefined,  ← Missing AI (10)
//   serial: undefined  ← Missing AI (21)
// }
```

The app handles this gracefully:
- Uses `|| ''` fallback when populating fields
- Empty fields allow manual entry

## Future Expansion

### Adding New Application Identifiers

To support additional GS1 AIs (e.g., quantity, weight, price):

1. **Update `parseGs1Data.js`:**
   ```javascript
   // Add new field to result object
   result.quantity = extractAI(normalized, '30');
   ```

2. **Update JSDoc comments:**
   ```javascript
   * @property {string} [quantity] - Quantity (AI 30)
   ```

3. **Map to form field in `index.html`:**
   ```javascript
   setBarcodeNewMedForm(prev => ({
     ...prev,
     boxQuantity: gs1Data.quantity || prev.boxQuantity
   }));
   ```

### Common GS1 AIs to Consider

| AI | Description | Format | Use Case |
|----|-------------|--------|----------|
| 30 | Variable count | Variable | Pre-fill quantity field |
| 310n | Net weight (kg) | 6 digits + decimal | Bulk medications |
| 392n | Price | Variable + decimal | Automated pricing |
| 400 | Customer PO | Variable | Order tracking |

## Testing

### Automated Tests

Run the test suite by opening `utils/test-gs1-parser.html` in a browser.

**Test coverage:**
- ✓ Full GS1 with all fields
- ✓ GS1 without serial number
- ✓ Non-parenthesized format with GS separator
- ✓ Standard 1D barcode (non-GS1)
- ✓ Minimal GS1 (GTIN + expiry only)
- ✓ Invalid expiry date handling

### Manual Testing

1. **Open the app** in a browser
2. **Enable camera scanner** or hardware scanner
3. **Scan a test GS1 code:**
   ```
   (01)05012345678901(17)260430(10)TEST123
   ```
4. **Verify fields are populated:**
   - Barcode: `05012345678901`
   - Batch: `TEST123`
   - Expiry: April 2026

### Console Debugging

The implementation includes detailed console logging:

```javascript
console.log('GS1 parse result:', gs1Data);
// Logs the parsed GS1 data for verification

console.log('Using GS1 GTIN for lookup:', lookupBarcode);
console.log('Extracted batch:', batchNumber, 'expiry:', expiryMonth, '/', expiryYear);
// Logs the extracted fields
```

## Browser Compatibility

- ✅ Chrome/Edge (tested)
- ✅ Firefox (tested)
- ✅ Safari (tested)
- ✅ Mobile browsers (iOS Safari, Chrome Android)

The GS1 parser uses standard JavaScript (ES6) features supported by all modern browsers.

## Summary

This implementation enhances the medication stock management system by:

1. **Automatically extracting** product codes, batch numbers, and expiry dates from 2D barcodes
2. **Reducing manual data entry** errors and time
3. **Maintaining backward compatibility** with existing 1D barcode workflows
4. **Providing clear documentation** and test examples
5. **Enabling easy expansion** for additional GS1 Application Identifiers

The system is production-ready and has been tested with real-world GS1 barcode formats.
