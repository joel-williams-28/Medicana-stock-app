/**
 * GS1 DataMatrix Parser for Medicine Packaging
 *
 * Parses GS1-encoded barcodes commonly found on medication packaging.
 * These barcodes use Application Identifiers (AIs) to encode multiple fields:
 *
 * Supported AIs:
 * - (01): GTIN - 14-digit Global Trade Item Number (product code)
 * - (17): Expiry date in YYMMDD format
 * - (10): Batch/lot number (variable length)
 * - (21): Serial number (variable length)
 *
 * Future expansion: Add support for AI (30) quantity, (310n) net weight, etc.
 */

/**
 * Parses a GS1-encoded barcode string and extracts common Application Identifiers.
 *
 * Handles multiple GS1 formats:
 * - Parenthesized: (01)05012345678901(17)260430(10)B123(21)X999
 * - Non-parenthesized with group separator (ASCII 29/0x1D)
 * - Mixed formats with various separators
 *
 * @param {string} raw - The raw decoded barcode string
 * @returns {Object} ParsedGs1Data object with extracted fields
 * @property {string} [gtin] - 14-digit GTIN product code
 * @property {string} [expiryDateRaw] - Raw expiry date (YYMMDD format)
 * @property {Date|null} [expiryDate] - Parsed JavaScript Date object
 * @property {string} [batch] - Batch/lot number
 * @property {string} [serial] - Serial number
 * @property {string} raw - Original input string
 * @property {boolean} isGs1 - Whether the string appears to be GS1-encoded
 *
 * @example
 * const result = parseGs1Data("(01)05012345678901(17)260430(10)LOT123");
 * // Returns: { gtin: "05012345678901", expiryDateRaw: "260430",
 * //           expiryDate: Date(2026-04-30), batch: "LOT123", isGs1: true }
 */
/**
 * GS1 Application Identifier definitions
 * Maps AI codes to their properties (fixed vs variable length)
 */
const GS1_AI_DEFINITIONS = {
  '01': { fixedLength: 14, name: 'GTIN' },
  '17': { fixedLength: 6, name: 'Expiry Date' },
  '10': { name: 'Batch/Lot' }, // Variable length
  '21': { name: 'Serial Number' }, // Variable length
  '11': { fixedLength: 6, name: 'Production Date' },
  '30': { name: 'Variable Count' }, // Variable length (up to 8)
};

/**
 * Parse non-parenthesized GS1 string (raw DataMatrix format)
 *
 * This parser sequentially reads through the string, identifying AIs
 * and extracting their values based on fixed-length or separator-delimited rules.
 *
 * @param {string} input - Normalized GS1 string (with | instead of GS character)
 * @returns {Object} Extracted GS1 fields
 */
function parseNonParenthesizedGs1(input) {
  const result = {};
  let pos = 0;

  // Helper to check if we're at a known AI
  const isKnownAI = (str, position) => {
    // Check 2-digit AIs (most common)
    const twoDigit = str.substring(position, position + 2);
    if (GS1_AI_DEFINITIONS[twoDigit]) {
      return twoDigit;
    }
    // Check 3-digit AIs (like 310, 392, etc.) - not common for medicines
    const threeDigit = str.substring(position, position + 3);
    if (GS1_AI_DEFINITIONS[threeDigit]) {
      return threeDigit;
    }
    // Check 4-digit AIs
    const fourDigit = str.substring(position, position + 4);
    if (GS1_AI_DEFINITIONS[fourDigit]) {
      return fourDigit;
    }
    return null;
  };

  console.log('[GS1 Parser] Parsing non-parenthesized GS1:', input);

  while (pos < input.length) {
    const ai = isKnownAI(input, pos);

    if (!ai) {
      // Unknown AI or end of recognized data - stop parsing
      console.log('[GS1 Parser] Unknown AI at position', pos, '- stopping');
      break;
    }

    const aiDef = GS1_AI_DEFINITIONS[ai];
    pos += ai.length; // Move past the AI code

    console.log('[GS1 Parser] Found AI', ai, '(' + aiDef.name + ') at position', pos);

    // Extract value based on fixed-length or separator-delimited
    let value;

    if (aiDef.fixedLength) {
      // Fixed-length AI: extract exact number of characters
      value = input.substring(pos, pos + aiDef.fixedLength);
      pos += aiDef.fixedLength;
      console.log('[GS1 Parser] Fixed-length value:', value);
    } else {
      // Variable-length AI: read until separator (|) or next known AI
      let endPos = pos;
      let foundSeparator = false;

      while (endPos < input.length) {
        if (input[endPos] === '|') {
          // Found separator
          foundSeparator = true;
          break;
        }
        // Only check for next AI if we've moved at least 1 character forward
        // This prevents false positives when data contains digits that look like AIs
        if (endPos > pos && isKnownAI(input, endPos)) {
          break;
        }
        endPos++;
      }

      value = input.substring(pos, endPos);
      pos = foundSeparator ? endPos + 1 : endPos; // Skip separator if found
      console.log('[GS1 Parser] Variable-length value:', value, '(separator found:', foundSeparator + ')');
    }

    // Store the value
    if (ai === '01') {
      result.gtin = value;
    } else if (ai === '17') {
      result.expiryDateRaw = value;
    } else if (ai === '10') {
      result.batch = value.trim();
    } else if (ai === '21') {
      result.serial = value.trim();
    }
  }

  console.log('[GS1 Parser] Parsing complete:', result);
  return result;
}

/**
 * Normalizes raw GS1 barcode strings by handling control characters.
 *
 * Real-world barcode scanners may include:
 * - ASCII 29 (0x1D): GS1 Group Separator
 * - Other control characters (0x00-0x1F, 0x7F)
 * - Leading/trailing whitespace
 *
 * This function replaces all control characters with a standard separator (|)
 * for consistent parsing.
 *
 * @param {string} raw - Raw barcode string from scanner
 * @returns {string} Normalized string with control characters replaced
 */
function normalizeGs1Raw(raw) {
  // Replace all control characters (ASCII 0x00-0x1F and 0x7F) with separator
  // This includes ASCII 29 (GS1 group separator) and any other non-printable characters
  const CONTROL_CHARS = /[\x00-\x1F\x7F]/g;

  // Replace control chars with | and trim whitespace
  let normalized = raw.replace(CONTROL_CHARS, '|').trim();

  // Remove leading and trailing | characters (can occur if barcode starts/ends with control char)
  normalized = normalized.replace(/^\|+|\|+$/g, '');

  return normalized;
}

function parseGs1Data(raw) {
  const result = {
    raw,
    isGs1: false,
    expiryDate: null
  };

  if (!raw || raw.length === 0) {
    return result;
  }

  // Normalize the input: replace all control characters with separator
  let normalized = normalizeGs1Raw(raw);

  console.log('[GS1 Parser] Raw input:', raw);
  console.log('[GS1 Parser] Normalized:', normalized);
  console.log('[GS1 Parser] Normalized char codes:', Array.from(normalized).map(ch => ch.charCodeAt(0)));

  // Check if this looks like a GS1 barcode
  // Look for common AI patterns: (01), (10), (17), (21), (30), etc.
  const hasParentheses = /\(0[0-9]\)|\(1[0-7]\)|\(2[0-1]\)|\(3[0-9]\)/.test(normalized);

  // Non-parenthesized format: starts with 01 followed by 14 digits
  const hasGtinPrefix = /^01\d{14}/.test(normalized);

  console.log('[GS1 Parser] Has parentheses?', hasParentheses);
  console.log('[GS1 Parser] Has GTIN prefix?', hasGtinPrefix);

  if (!hasParentheses && !hasGtinPrefix) {
    // Doesn't look like GS1 - treat as regular barcode
    console.log('[GS1 Parser] Not recognized as GS1 format');
    return result;
  }

  result.isGs1 = true;
  console.log('[GS1 Parser] Recognized as GS1 format');

  try {
    // Parse parenthesized format: (01)12345...(17)260430(10)BATCH
    if (hasParentheses) {
      result.gtin = extractAI(normalized, '01', 14);
      result.expiryDateRaw = extractAI(normalized, '17', 6);
      result.batch = extractAI(normalized, '10');
      result.serial = extractAI(normalized, '21');
    }
    // Parse non-parenthesized format (raw GS1 DataMatrix)
    else if (hasGtinPrefix) {
      // Use sequential parser for non-parenthesized format
      const parsed = parseNonParenthesizedGs1(normalized);
      result.gtin = parsed.gtin;
      result.expiryDateRaw = parsed.expiryDateRaw;
      result.batch = parsed.batch;
      result.serial = parsed.serial;
    }

    // Parse expiry date from YYMMDD format
    if (result.expiryDateRaw && result.expiryDateRaw.length === 6) {
      result.expiryDate = parseYYMMDD(result.expiryDateRaw);
    }

    console.log('[GS1 Parser] Extracted fields:', {
      gtin: result.gtin,
      batch: result.batch,
      expiryDateRaw: result.expiryDateRaw,
      expiryDate: result.expiryDate,
      serial: result.serial
    });

  } catch (error) {
    // If parsing fails, we still return isGs1: true but with partial data
    console.warn('GS1 parsing encountered an error:', error);
  }

  return result;
}

/**
 * Extracts an Application Identifier value from a parenthesized GS1 string.
 *
 * @param {string} input - The GS1 string to parse
 * @param {string} ai - The Application Identifier (e.g., "01", "17", "10")
 * @param {number} [fixedLength] - Fixed length for this AI (optional). If not provided, extracts until next AI or separator.
 * @returns {string|undefined} The extracted value, or undefined if not found
 */
function extractAI(input, ai, fixedLength) {
  // Match (AI) followed by the value
  const aiPattern = `\\(${ai}\\)`;
  const regex = new RegExp(aiPattern + '([^(|]+)');
  const match = input.match(regex);

  if (!match) {
    return undefined;
  }

  let value = match[1];

  // If fixed length is specified, extract exactly that many characters
  if (fixedLength !== undefined) {
    value = value.substring(0, fixedLength);
  } else {
    // Variable length: trim and remove trailing separators
    value = value.replace(/\|+$/, '').trim();
  }

  return value || undefined;
}

/**
 * Parses a GS1 expiry date in YYMMDD format to a JavaScript Date.
 *
 * Assumes 20xx for the year (e.g., 26 -> 2026, 99 -> 2099).
 * Performs basic validation on month and day values.
 *
 * @param {string} yymmdd - 6-digit date string (e.g., "260430" for April 30, 2026)
 * @returns {Date|null} Date object, or null if parsing fails
 */
function parseYYMMDD(yymmdd) {
  if (yymmdd.length !== 6) {
    return null;
  }

  const yy = parseInt(yymmdd.substring(0, 2), 10);
  const mm = parseInt(yymmdd.substring(2, 4), 10);
  const dd = parseInt(yymmdd.substring(4, 6), 10);

  // Basic validation
  if (mm < 1 || mm > 12) {
    console.warn(`Invalid month in GS1 expiry date: ${mm}`);
    return null;
  }

  if (dd < 1 || dd > 31) {
    console.warn(`Invalid day in GS1 expiry date: ${dd}`);
    return null;
  }

  // Assume 20xx for year (2000-2099)
  const year = 2000 + yy;

  // Create date object
  // Note: JavaScript Date month is 0-indexed
  const date = new Date(year, mm - 1, dd);

  // Verify the date is valid (handles Feb 30, etc.)
  if (date.getFullYear() !== year || date.getMonth() !== mm - 1 || date.getDate() !== dd) {
    console.warn(`Invalid date constructed from YYMMDD: ${yymmdd}`);
    return null;
  }

  return date;
}

/**
 * Formats a Date object to YYYY-MM-DD string for HTML date inputs.
 *
 * @param {Date|null|undefined} date - JavaScript Date object
 * @returns {string} ISO date string (YYYY-MM-DD) or empty string if invalid
 */
function formatDateForInput(date) {
  if (!date || !(date instanceof Date) || isNaN(date.getTime())) {
    return '';
  }

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');

  return `${year}-${month}-${day}`;
}

/**
 * Formats a Date object to separate month and year strings.
 *
 * @param {Date|null|undefined} date - JavaScript Date object
 * @returns {Object} Object with month (MM) and year (YYYY) strings
 */
function formatDateForMonthYear(date) {
  if (!date || !(date instanceof Date) || isNaN(date.getTime())) {
    return { month: '', year: '' };
  }

  const month = String(date.getMonth() + 1).padStart(2, '0');
  const year = date.getFullYear();

  return { month, year };
}

// Make functions available globally for use in the HTML file
window.parseGs1Data = parseGs1Data;
window.formatDateForInput = formatDateForInput;
window.formatDateForMonthYear = formatDateForMonthYear;
