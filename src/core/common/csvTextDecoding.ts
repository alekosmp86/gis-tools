export type CsvTextEncoding = "utf-8" | "windows-1252";

const UTF8_BOM = /^﻿/;

export function isValidUtf8(bytes: Uint8Array): boolean {
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return true;
  } catch {
    return false;
  }
}

export function detectCsvEncoding(bytes: Uint8Array): CsvTextEncoding {
  return isValidUtf8(bytes) ? "utf-8" : "windows-1252";
}

export function decodeCsvBytes(bytes: Uint8Array): string {
  const text = new TextDecoder(detectCsvEncoding(bytes), { ignoreBOM: true }).decode(bytes);
  return text.replace(UTF8_BOM, "");
}
