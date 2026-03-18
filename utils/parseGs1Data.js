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
 */

// Set to true for detailed parse logging (useful during development/debugging)
const GS1_DEBUG = false;

function gs1Log(...args) {
  if (GS1_DEBUG) console.log('[GS1 Parser]', ...args);
}

/**
 * GS1 Application Identifier definitions
 * Maps AI codes to their properties (fixed vs variable length)
 */
const GS1_AI_DEFINITIONS = {
  '01': { fixedLength: 14, name: 'GTIN' },
  '17': { fixedLength: 6, name: 'Expiry Date' },
  '10': { name: 'Batch/Lot' },
  '21': { name: 'Serial Number' },
  '11': { fixedLength: 6, name: 'Production Date' },
  '30': { name: 'Variable Count' },
};

/**
 * Parse non-parenthesized GS1 string (raw DataMatrix format)
 *
 * Sequentially reads through the string, identifying AIs and extracting
 * their values based on fixed-length or separator-delimited rules.
 *
 * @param {string} input - Normalized GS1 string (with | instead of GS character)
 * @returns {Object} Extracted GS1 fields
 */
function parseNonParenthesizedGs1(input) {
  const result = {};
  let pos = 0;

  const isKnownAI = (str, position) => {
    for (const len of [2, 3, 4]) {
      const candidate = str.substring(position, position + len);
      if (GS1_AI_DEFINITIONS[candidate]) return candidate;
    }
    return null;
  };

  gs1Log('Parsing non-parenthesized GS1:', input);

  while (pos < input.length) {
    const ai = isKnownAI(input, pos);
    if (!ai) {
      gs1Log('Unknown AI at position', pos, '- stopping');
      break;
    }

    const aiDef = GS1_AI_DEFINITIONS[ai];
    pos += ai.length;

    gs1Log('Found AI', ai, '(' + aiDef.name + ') at position', pos);

    let value;
    if (aiDef.fixedLength) {
      value = input.substring(pos, pos + aiDef.fixedLength);
      pos += aiDef.fixedLength;
    } else {
      // Variable-length: read until separator (|) or end of string
      let endPos = pos;
      let foundSeparator = false;
      while (endPos < input.length) {
        if (input[endPos] === '|') { foundSeparator = true; break; }
        endPos++;
      }
      value = input.substring(pos, endPos);
      pos = foundSeparator ? endPos + 1 : endPos;
    }

    if (ai === '01') result.gtin = value;
    else if (ai === '17') result.expiryDateRaw = value;
    else if (ai === '10') result.batch = value.trim();
    else if (ai === '21') result.serial = value.trim();
  }

  gs1Log('Parsing complete:', result);
  return result;
}

/**
 * Normalizes raw GS1 barcode strings by replacing control characters
 * (ASCII 0x00-0x1F, 0x7F) with a standard separator (|).
 *
 * @param {string} raw - Raw barcode string from scanner
 * @returns {string} Normalized string with control characters replaced
 */
function normalizeGs1Raw(raw) {
  return raw
    .replace(/[\x00-\x1F\x7F]/g, '|')
    .trim()
    .replace(/^\|+|\|+$/g, '');
}

/**
 * Parses a GS1-encoded barcode string and extracts common Application Identifiers.
 *
 * @param {string} raw - The raw decoded barcode string
 * @returns {Object} ParsedGs1Data with extracted fields (gtin, batch, serial, expiryDate, etc.)
 */
function parseGs1Data(raw) {
  const result = { raw, isGs1: false, expiryDate: null };

  if (!raw || raw.length === 0) return result;

  const normalized = normalizeGs1Raw(raw);

  gs1Log('Raw input:', raw);
  gs1Log('Normalized:', normalized);

  // Detect format
  const hasParentheses = /\(0[0-9]\)|\(1[0-7]\)|\(2[0-1]\)|\(3[0-9]\)/.test(normalized);
  const hasGtinPrefix = /^01\d{14}/.test(normalized);
  const mmyyyyMatch = normalized.match(/(\d{1,2})\s+(\d{4})/);
  const hasMMYYYY = !!mmyyyyMatch;

  if (!hasParentheses && !hasGtinPrefix && !hasMMYYYY) {
    gs1Log('Not recognized as GS1 or alternative barcode format');
    return result;
  }

  result.isGs1 = true;

  try {
    if (hasParentheses) {
      result.gtin = extractAI(normalized, '01', 14);
      result.expiryDateRaw = extractAI(normalized, '17', 6);
      result.batch = extractAI(normalized, '10');
      result.serial = extractAI(normalized, '21');
    } else if (hasGtinPrefix) {
      const parsed = parseNonParenthesizedGs1(normalized);
      result.gtin = parsed.gtin;
      result.expiryDateRaw = parsed.expiryDateRaw;
      result.batch = parsed.batch;
      result.serial = parsed.serial;
    } else if (hasMMYYYY) {
      gs1Log('Parsing alternative format with MM YYYY date');
      result.expiryDate = parseMMYYYY(mmyyyyMatch[0]);
      result.expiryDateRaw = mmyyyyMatch[0];

      const beforeDate = normalized.substring(0, mmyyyyMatch.index).trim();
      const parts = beforeDate.split('|').filter(p => p.trim().length > 0);

      if (parts.length > 0) result.batch = parts[0].trim();
      if (parts.length > 1) result.serial = parts.slice(1).join(' ').trim();

      // Clear raw field - no actual barcode identifier in alternative format
      result.raw = '';
    }

    // Parse expiry date from YYMMDD format if not already parsed
    if (!result.expiryDate && result.expiryDateRaw && result.expiryDateRaw.length === 6) {
      result.expiryDate = parseYYMMDD(result.expiryDateRaw);
    }

    gs1Log('Extracted fields:', {
      gtin: result.gtin,
      batch: result.batch,
      expiryDateRaw: result.expiryDateRaw,
      expiryDate: result.expiryDate,
      serial: result.serial
    });
  } catch (error) {
    console.warn('GS1 parsing encountered an error:', error);
  }

  return result;
}

/**
 * Extracts an Application Identifier value from a parenthesized GS1 string.
 *
 * @param {string} input - The GS1 string to parse
 * @param {string} ai - The Application Identifier (e.g., "01", "17", "10")
 * @param {number} [fixedLength] - Fixed length for this AI (optional)
 * @returns {string|undefined} The extracted value, or undefined if not found
 */
function extractAI(input, ai, fixedLength) {
  const regex = new RegExp(`\\(${ai}\\)([^(|]+)`);
  const match = input.match(regex);
  if (!match) return undefined;

  let value = match[1];
  if (fixedLength !== undefined) {
    value = value.substring(0, fixedLength);
  } else {
    value = value.replace(/\|+$/, '').trim();
  }
  return value || undefined;
}

/**
 * Parses a GS1 expiry date in YYMMDD format to a JavaScript Date.
 * Assumes 20xx for the year.
 *
 * @param {string} yymmdd - 6-digit date string (e.g., "260430" for April 30, 2026)
 * @returns {Date|null} Date object, or null if parsing fails
 */
function parseYYMMDD(yymmdd) {
  if (yymmdd.length !== 6) return null;

  const yy = parseInt(yymmdd.substring(0, 2), 10);
  const mm = parseInt(yymmdd.substring(2, 4), 10);
  const dd = parseInt(yymmdd.substring(4, 6), 10);

  if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return null;

  const year = 2000 + yy;
  const date = new Date(year, mm - 1, dd);

  // Verify the date is valid (handles Feb 30, etc.)
  if (date.getFullYear() !== year || date.getMonth() !== mm - 1 || date.getDate() !== dd) {
    return null;
  }

  return date;
}

/**
 * Parses alternative date formats like "MM YYYY" (e.g., "04 2026").
 * Returns last day of the month (standard for expiry dates without a day).
 *
 * @param {string} dateStr - Date string in MM YYYY format
 * @returns {Date|null} Date object set to last day of the month, or null if parsing fails
 */
function parseMMYYYY(dateStr) {
  const match = dateStr.match(/^(\d{1,2})\s*(\d{4})$/);
  if (!match) return null;

  const mm = parseInt(match[1], 10);
  const yyyy = parseInt(match[2], 10);

  if (mm < 1 || mm > 12 || yyyy < 2000 || yyyy > 2099) return null;

  // Day 0 of next month = last day of this month
  return new Date(yyyy, mm, 0);
}

/**
 * Formats a Date object to YYYY-MM-DD string for HTML date inputs.
 */
function formatDateForInput(date) {
  if (!date || !(date instanceof Date) || isNaN(date.getTime())) return '';

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Formats a Date object to separate month and year strings.
 */
function formatDateForMonthYear(date) {
  if (!date || !(date instanceof Date) || isNaN(date.getTime())) {
    return { month: '', year: '' };
  }
  return {
    month: String(date.getMonth() + 1).padStart(2, '0'),
    year: date.getFullYear()
  };
}

// Make functions available globally for use in the HTML file
window.parseGs1Data = parseGs1Data;
window.formatDateForInput = formatDateForInput;
window.formatDateForMonthYear = formatDateForMonthYear;
