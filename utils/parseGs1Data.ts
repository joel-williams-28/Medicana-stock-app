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

export interface ParsedGs1Data {
  gtin?: string;
  expiryDateRaw?: string;    // e.g. "260430" (YYMMDD)
  expiryDate?: Date | null;  // Parsed JavaScript Date object
  batch?: string;
  serial?: string;
  raw: string;               // Original input string
  isGs1: boolean;            // Whether the string appears to be GS1-encoded
}

/**
 * Parses a GS1-encoded barcode string and extracts common Application Identifiers.
 *
 * Handles multiple GS1 formats:
 * - Parenthesized: (01)05012345678901(17)260430(10)B123(21)X999
 * - Non-parenthesized with group separator (ASCII 29/0x1D)
 * - Mixed formats with various separators
 *
 * @param raw - The raw decoded barcode string
 * @returns ParsedGs1Data object with extracted fields
 *
 * @example
 * const result = parseGs1Data("(01)05012345678901(17)260430(10)LOT123");
 * // Returns: { gtin: "05012345678901", expiryDateRaw: "260430",
 * //           expiryDate: Date(2026-04-30), batch: "LOT123", isGs1: true }
 */
export function parseGs1Data(raw: string): ParsedGs1Data {
  const result: ParsedGs1Data = {
    raw,
    isGs1: false,
    expiryDate: null
  };

  if (!raw || raw.length === 0) {
    return result;
  }

  // GS1 Group Separator character (ASCII 29)
  const GS = String.fromCharCode(29);

  // Normalize the input: replace GS with a temporary marker for easier parsing
  let normalized = raw.replace(new RegExp(GS, 'g'), '|');

  // Check if this looks like a GS1 barcode
  // Look for common AI patterns: (01), (10), (17), (21), (30), etc.
  const hasParentheses = /\(0[0-9]\)|\(1[0-7]\)|\(2[0-1]\)|\(3[0-9]\)/.test(normalized);

  // Non-parenthesized format: starts with 01 followed by 14 digits
  const hasGtinPrefix = /^01\d{14}/.test(normalized);

  if (!hasParentheses && !hasGtinPrefix) {
    // Doesn't look like GS1 - treat as regular barcode
    return result;
  }

  result.isGs1 = true;

  try {
    // Parse parenthesized format: (01)12345...(17)260430(10)BATCH
    if (hasParentheses) {
      result.gtin = extractAI(normalized, '01', 14);
      result.expiryDateRaw = extractAI(normalized, '17', 6);
      result.batch = extractAI(normalized, '10');
      result.serial = extractAI(normalized, '21');
    }
    // Parse non-parenthesized format with separators
    else if (hasGtinPrefix) {
      // GTIN is always first, 14 digits after AI '01'
      result.gtin = normalized.substring(2, 16);

      // Find other AIs after GTIN
      let remaining = normalized.substring(16);

      // Look for AI 17 (expiry) - 6 digits
      const expiryMatch = remaining.match(/17(\d{6})/);
      if (expiryMatch) {
        result.expiryDateRaw = expiryMatch[1];
      }

      // Look for AI 10 (batch) - variable length, terminated by | or next AI
      const batchMatch = remaining.match(/10([^|]*?)(?:\||$|(?=\d{2}))/);
      if (batchMatch) {
        result.batch = batchMatch[1].trim();
      }

      // Look for AI 21 (serial) - variable length, terminated by | or end
      const serialMatch = remaining.match(/21([^|]*?)(?:\||$)/);
      if (serialMatch) {
        result.serial = serialMatch[1].trim();
      }
    }

    // Parse expiry date from YYMMDD format
    if (result.expiryDateRaw && result.expiryDateRaw.length === 6) {
      result.expiryDate = parseYYMMDD(result.expiryDateRaw);
    }

  } catch (error) {
    // If parsing fails, we still return isGs1: true but with partial data
    console.warn('GS1 parsing encountered an error:', error);
  }

  return result;
}

/**
 * Extracts an Application Identifier value from a parenthesized GS1 string.
 *
 * @param input - The GS1 string to parse
 * @param ai - The Application Identifier (e.g., "01", "17", "10")
 * @param fixedLength - Fixed length for this AI (optional). If not provided, extracts until next AI or separator.
 * @returns The extracted value, or undefined if not found
 */
function extractAI(input: string, ai: string, fixedLength?: number): string | undefined {
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
 * @param yymmdd - 6-digit date string (e.g., "260430" for April 30, 2026)
 * @returns Date object, or null if parsing fails
 */
function parseYYMMDD(yymmdd: string): Date | null {
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
 * @param date - JavaScript Date object
 * @returns ISO date string (YYYY-MM-DD) or empty string if invalid
 */
export function formatDateForInput(date: Date | null | undefined): string {
  if (!date || !(date instanceof Date) || isNaN(date.getTime())) {
    return '';
  }

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');

  return `${year}-${month}-${day}`;
}
