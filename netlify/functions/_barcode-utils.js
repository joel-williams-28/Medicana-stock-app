// Shared barcode normalization utilities

/**
 * Normalizes a barcode to a consistent format.
 * GTIN-14 barcodes with a leading '0' indicator digit are stripped to EAN-13,
 * since QR/DataMatrix codes encode 14-digit GTINs while linear barcodes
 * encode the same product as 13-digit EAN-13.
 *
 * @param {string} barcode - Raw barcode string
 * @returns {string} Normalized barcode
 */
function normalizeBarcode(barcode) {
  if (!barcode) return barcode;
  const trimmed = barcode.trim();
  if (trimmed.length === 14 && trimmed.startsWith('0') && /^\d+$/.test(trimmed)) {
    return trimmed.substring(1);
  }
  return trimmed;
}

module.exports = { normalizeBarcode };
