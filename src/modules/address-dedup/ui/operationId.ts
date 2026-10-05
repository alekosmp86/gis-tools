const UUID_VERSION_4 = 0x40;
const UUID_VARIANT = 0x80;
const BYTE_COUNT = 16;

function toHex(byte: number): string {
  return byte.toString(16).padStart(2, "0");
}

function randomUuidFromBytes(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(BYTE_COUNT));
  bytes[6] = (bytes[6] & 0x0f) | UUID_VERSION_4;
  bytes[8] = (bytes[8] & 0x3f) | UUID_VARIANT;
  const hex = Array.from(bytes, toHex).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** `crypto.randomUUID` only exists in secure contexts; the app can be served over plain http on a LAN. */
export function generateOperationId(): string {
  return typeof crypto.randomUUID === "function" ? crypto.randomUUID() : randomUuidFromBytes();
}
