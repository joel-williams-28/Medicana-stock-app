# Smart Barcode Scanning Architecture

## Overview

This document describes the improved barcode scanning architecture that automatically detects and handles GS1 DataMatrix (2D) medicine pack barcodes vs standard 1D barcodes without requiring user selection.

## Key Principles

1. **Single "Scan" Button** - Users never choose between "1D" or "2D" scanning modes
2. **Automatic Detection** - The system automatically determines if a barcode is GS1-encoded
3. **Smart Routing** - Based on the barcode type and content, the system opens the appropriate modal with fields pre-filled
4. **Dumb Scanner Component** - The scanner component only handles camera/decoding; all intelligence is centralized
5. **Backwards Compatible** - Existing 1D barcode workflows remain unchanged

## Architecture

### Component Responsibilities

```
┌─────────────────────────────────────────────────────────────────┐
│                    User clicks "Scan"                           │
└────────────────────────┬────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│              Camera Scanner Component                           │
│  (html5-qrcode library)                                        │
│                                                                 │
│  • Accesses camera                                             │
│  • Decodes barcode (1D and 2D formats)                         │
│  • Returns raw decoded string                                  │
│  • NO parsing or interpretation                                │
└────────────────────────┬────────────────────────────────────────┘
                         │ rawValue
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│          handleBarcodeDetected(rawValue)                        │
│  (Camera scanner callback)                                      │
│                                                                 │
│  • Prevents duplicate scans                                    │
│  • Stops camera                                                │
│  • Delegates to centralized handler                            │
└────────────────────────┬────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│          handleScanDetected(rawValue)                           │
│  (Centralized scan handler - THE BRAIN)                        │
│                                                                 │
│  1. Parse barcode with parseGs1Data(rawValue)                  │
│  2. Check if GS1 with batch/expiry data                        │
│  3. Route to appropriate handler                               │
└────────────────┬───────────────────────────┬────────────────────┘
                 │                           │
     GS1 with    │                           │    Non-GS1 or
    batch/expiry │                           │    GS1 without
                 │                           │    batch data
                 ▼                           ▼
┌──────────────────────────────┐  ┌──────────────────────────────┐
│ handleMedicinePackScan()     │  │ handleGenericBarcodeScan()   │
│ (2D pack workflow)           │  │ (1D fallback workflow)       │
│                              │  │                              │
│ • Extract GTIN, batch,       │  │ • Use raw barcode for lookup │
│   expiry, serial             │  │ • Open medication modal      │
│ • Open medication modal      │  │ • Trigger lookup             │
│ • Pre-fill batch fields      │  │ • No prefilling              │
│ • Trigger GTIN lookup        │  │                              │
└──────────────────────────────┘  └──────────────────────────────┘
```

## Key Functions

### 1. `handleScanDetected(rawValue)` - Centralized Intelligence

**Purpose:** Single entry point for all camera scans. Decides 1D vs 2D.

**Logic:**
```javascript
const parsed = parseGs1Data(rawValue);

if (parsed.isGs1 && (parsed.batch || parsed.expiryDateRaw)) {
  // GS1 with pack data → 2D medicine pack workflow
  handleMedicinePackScan(parsed);
} else {
  // Simple barcode → 1D fallback workflow
  handleGenericBarcodeScan(rawValue);
}
```

**Location:** `index.html:1782`

### 2. `handleMedicinePackScan(parsedGs1)` - GS1 Workflow

**Purpose:** Handle GS1 DataMatrix codes with batch/expiry data

**Behavior:**
- Uses GTIN for medication lookup (not full GS1 string)
- Pre-fills: batch number, expiry date, serial number
- If medication exists: modal shows in "add batch" mode
- If medication doesn't exist: modal shows in "create + batch" mode

**Pre-filled fields:**
- `barcode` ← GTIN (AI 01)
- `batchNumber` ← Batch (AI 10)
- `serial` ← Serial (AI 21)
- `expiryMonth` ← From expiry date (AI 17)
- `expiryYear` ← From expiry date (AI 17)

**Location:** `index.html:1741`

### 3. `handleGenericBarcodeScan(barcode)` - 1D Workflow

**Purpose:** Handle standard 1D barcodes or GS1 without batch data

**Behavior:**
- Uses raw barcode for lookup
- Opens medication modal
- No pre-filling of batch/expiry
- User enters batch data manually

**Location:** `index.html:1709`

### 4. `handleBarcodeDetected(barcode)` - Camera Callback

**Purpose:** "Dumb" callback from html5-qrcode scanner library

**Responsibilities:**
- Duplicate scan prevention (2-second window)
- Stop camera after successful scan
- Delegate to `handleScanDetected()`

**Does NOT:**
- Parse or interpret barcode data
- Decide 1D vs 2D
- Open modals

**Location:** `index.html:1813`

## GS1 Parsing

### Utility: `parseGs1Data(rawString)`

**Location:** `utils/parseGs1Data.ts`

**Supported Application Identifiers (AIs):**

| AI | Field | Format | Example | Notes |
|----|-------|--------|---------|-------|
| 01 | GTIN | 14 digits | `05012345678901` | Product code for lookup |
| 17 | Expiry Date | YYMMDD | `260430` | April 30, 2026 |
| 10 | Batch/Lot | Variable | `LOT12345` | Terminated by separator or next AI |
| 21 | Serial | Variable | `SN987654` | Package-level unique identifier |

**Supported Formats:**
- Parenthesized: `(01)05012345678901(17)260430(10)BATCH1(21)SERIAL1`
- Non-parenthesized with GS separator (ASCII 29)
- Mixed formats

**Returns:**
```javascript
{
  isGs1: boolean,           // true if GS1 detected
  gtin?: string,            // 14-digit product code
  expiryDateRaw?: string,   // YYMMDD format
  expiryDate?: Date | null, // Parsed Date object
  batch?: string,           // Batch/lot number
  serial?: string,          // Serial number
  raw: string               // Original input
}
```

**Date Parsing:**
- Assumes 20xx for years (e.g., 26 → 2026, 99 → 2099)
- Validates month (1-12) and day (1-31)
- Returns `null` for invalid dates (e.g., Feb 30)

## Hardware Scanner Support

### `handleBarcodeScanned(barcode)` - Global Hardware Scanner

**Purpose:** Handle infrared/Bluetooth scanners via keyboard emulation

**Behavior difference from camera scanner:**
- If medication found → Opens stock adjustment modal (quick workflow)
- If medication not found → Opens new medication modal
- GS1 data still parsed and pre-filled

**Rationale:** Hardware scanner is typically used by staff who know the medication exists, so the "quick stock adjustment" flow is more appropriate.

**Location:** `index.html:2017`

## Database Schema

### `batches` Table

```sql
CREATE TABLE batches (
  id integer NOT NULL,
  medication_id text NOT NULL,
  batch_code text NOT NULL,
  expiry_date date,
  brand text,
  items_per_box integer,
  serial text  -- NEW: GS1 serial number (AI 21)
);
```

### Migration

See `database/add-serial-to-batches.sql` for the migration script to add the `serial` column.

**Index created:** `idx_batches_serial` for fast serial number lookups (useful for recalls)

## Data Flow: GS1 Medicine Pack Scan

### Example: Scanning a 2D medicine pack

**Input barcode:**
```
(01)05012345678901(17)260430(10)LOT12345(21)SN987654
```

**Flow:**

1. **Scanner library** decodes → returns raw string
2. **handleBarcodeDetected** → stops camera, calls handleScanDetected
3. **handleScanDetected** → calls parseGs1Data
4. **parseGs1Data** returns:
   ```javascript
   {
     isGs1: true,
     gtin: "05012345678901",
     batch: "LOT12345",
     serial: "SN987654",
     expiryDateRaw: "260430",
     expiryDate: Date(2026-04-30),
     raw: "..."
   }
   ```
5. **handleScanDetected** → detects batch + expiry → calls handleMedicinePackScan
6. **handleMedicinePackScan** → pre-fills form:
   ```javascript
   {
     barcode: "05012345678901",  // GTIN for lookup
     batchNumber: "LOT12345",
     serial: "SN987654",
     expiryMonth: "04",
     expiryYear: "2026"
   }
   ```
7. **handleBarcodeLookup** → searches by GTIN
8. If found: medication fields locked, batch fields editable
9. User confirms → **window.api.addBatch** called with:
   ```javascript
   {
     medicationId: "...",
     batchCode: "LOT12345",
     serial: "SN987654",  // Saved to database
     expiryMonth: 4,
     expiryYear: 2026,
     // ... other fields
   }
   ```
10. **Backend** → creates/updates batch with serial number

## Backwards Compatibility

### Standard 1D Barcodes (e.g., EAN-13)

**Input:** `5012345678900`

**Flow:**
1. parseGs1Data → returns `{ isGs1: false, raw: "5012345678900" }`
2. handleScanDetected → calls handleGenericBarcodeScan
3. handleGenericBarcodeScan → uses raw barcode for lookup
4. User manually enters batch/expiry data

**Result:** Identical behavior to previous implementation

### Manual Barcode Entry

All existing manual entry flows are unchanged:
- Typing into barcode field
- Using hardware scanner
- Quick search bar with fast typing detection

## Testing

### Test Scenarios

1. **Full GS1 with all fields**
   - Input: `(01)05012345678901(17)260430(10)LOT123(21)SN999`
   - Expected: All fields pre-filled

2. **GS1 without serial**
   - Input: `(01)05012345678901(17)260430(10)LOT123`
   - Expected: Batch and expiry pre-filled, serial empty

3. **Standard 1D barcode**
   - Input: `5012345678900`
   - Expected: Generic flow, no pre-filling

4. **GS1 with only GTIN (no batch/expiry)**
   - Input: `(01)05012345678901`
   - Expected: Generic flow (treated as 1D)

5. **Invalid GS1 expiry date**
   - Input: `(01)05012345678901(17)991332`
   - Expected: Expiry fields empty, other GS1 data still used

### Console Logging

Detailed logging for debugging:

```javascript
console.log('[Scan Detected] Raw value:', rawValue);
console.log('[Scan Detected] Parse result:', parsed);
console.log('[GS1 Pack Scan] Processing 2D medicine pack:', parsedGs1);
console.log('[Generic Scan] Processing 1D barcode:', barcode);
```

## Future Enhancements

### Additional GS1 Application Identifiers

The parser can be extended to support:

| AI | Description | Format | Use Case |
|----|-------------|--------|----------|
| 30 | Variable count | Variable | Pre-fill quantity field |
| 310n | Net weight (kg) | 6 digits | Bulk medications |
| 392n | Price | Variable | Automated pricing |
| 400 | Customer PO | Variable | Order tracking |

**To add new AI:**

1. Update `parseGs1Data.ts`:
   ```javascript
   result.quantity = extractAI(normalized, '30');
   ```

2. Update form pre-filling:
   ```javascript
   setBarcodeNewMedForm(prev => ({
     ...prev,
     boxQuantity: parsedGs1.quantity || ''
   }));
   ```

3. Add to documentation

### Scan Intent Support

For different workflows (e.g., "identify medication" vs "add stock to known medication"), add an intent parameter:

```javascript
type ScanIntent = 'identifyMedication' | 'addBatchToKnownMedication';

const handleScanDetected = (rawValue, intent = 'identifyMedication') => {
  const parsed = parseGs1Data(rawValue);

  if (parsed.isGs1 && (parsed.batch || parsed.expiryDateRaw)) {
    handleMedicinePackScan(parsed, intent);
  } else {
    handleGenericBarcodeScan(rawValue, intent);
  }
};
```

## Summary

This architecture achieves:

✅ **Single "Scan" button** - No mode selection required
✅ **Automatic GS1 detection** - Transparent to user
✅ **Smart field pre-filling** - Batch + expiry from 2D codes
✅ **Clean separation of concerns** - Scanner is dumb, logic is centralized
✅ **Backwards compatible** - 1D barcodes work as before
✅ **Serial number tracking** - Stored for traceability
✅ **Extensible** - Easy to add more GS1 AIs
✅ **Well documented** - Clear code comments and architecture docs

The system is production-ready and provides a seamless scanning experience for both 1D and 2D medicine barcodes.
