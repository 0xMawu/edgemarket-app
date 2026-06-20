/**
 * Validates whether a string is a valid Ethereum private key.
 *
 * Accepts exactly 64 hexadecimal characters, optionally preceded by the
 * case-insensitive prefix "0x" or "0X". Rejects everything else: wrong
 * length, non-hex characters, whitespace, and empty strings.
 *
 * This is a pure function with no side effects and no imports.
 */
export function isValidPrivateKey(input: string): boolean {
  // Optional "0x"/"0X" prefix followed by exactly 64 hex characters.
  // ^ and $ anchor the match so whitespace or extra characters cause rejection.
  return /^(?:0[xX])?[0-9a-fA-F]{64}$/.test(input);
}
