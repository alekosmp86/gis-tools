const LATIN1_LIMIT = 0x100;
const DECODE_CHUNK_SIZE = 8192;
const REPLACEMENT_CODE = 0x3f;

/** Every byte is the code point of the same value, as ISO-8859-1 defines (unlike the WHATWG "latin1" label). */
export function decodeLatin1(bytes: Uint8Array): string {
  const chunks: string[] = [];
  for (let start = 0; start < bytes.length; start += DECODE_CHUNK_SIZE) {
    chunks.push(String.fromCharCode(...bytes.subarray(start, start + DECODE_CHUNK_SIZE)));
  }
  return chunks.join("");
}

/** Characters outside ISO-8859-1 become `?`, as the legacy writer did. */
export function encodeLatin1(text: string): Uint8Array {
  const bytes = new Uint8Array(text.length);
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    bytes[index] = code < LATIN1_LIMIT ? code : REPLACEMENT_CODE;
  }
  return bytes;
}
