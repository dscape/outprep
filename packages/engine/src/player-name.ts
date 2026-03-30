/** Simple CRC32 for generating stable game IDs from move strings */
export function crc32(str: string): string {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < str.length; i++) {
    crc ^= str.charCodeAt(i);
    for (let j = 0; j < 8; j++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xEDB88320 : 0);
    }
  }
  return ((crc ^ 0xFFFFFFFF) >>> 0).toString(16).padStart(8, "0");
}

/**
 * Check if a PGN player name matches a given player name.
 * Handles variations: "Firouzja, Alireza", "Firouzja,A", "Firouzja A.", slug formats, etc.
 */
export function matchesPlayerName(pgnName: string, playerName: string): boolean {
  const pgnLower = pgnName.toLowerCase();
  const lower = playerName.toLowerCase();
  // Direct substring match
  if (pgnLower.includes(lower)) return true;
  // Reverse alphanumeric substring match — handles abbreviated FIDE names
  // e.g. PGN "Caruana,F" → "caruanaf", player "Caruana, Fabiano" → "caruanafabiano"
  const pgnAlpha = pgnLower.replace(/[^a-z0-9]/g, "");
  const playerAlpha = lower.replace(/[^a-z0-9]/g, "");
  if (pgnAlpha.length >= 4 && playerAlpha.includes(pgnAlpha)) return true;
  // Extract name words (handles slug format with trailing FIDE ID)
  const slugParts = lower.split(/[-\s,]+/).filter(Boolean);
  const nameWords = slugParts.filter(p => !/^\d{4,}$/.test(p));
  // Word-based match: all name words appear in the PGN name
  if (nameWords.length >= 2) {
    const pgnNormalized = pgnLower.replace(/[^a-z\s]/g, " ");
    return nameWords.every(w => pgnNormalized.includes(w));
  }
  return false;
}
