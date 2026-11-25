import { describe, expect, it } from "vitest";
import { BinaryDbfReader } from "@/core/binary/BinaryDbfReader";
import { buildDbfBuffer } from "./support/dbfBuilder";

describe("BinaryDbfReader date fields", () => {
  it("reads an all-zero date as null and a real date as ISO text", () => {
    const dbf = buildDbfBuffer({
      fields: [{ name: "FECHA", type: "D", length: 8 }],
      records: [{ values: { FECHA: "00000000" } }, { values: { FECHA: "20261030" } }],
    });
    const reader = new BinaryDbfReader(dbf);

    expect(reader.readRecord(0)).toEqual({ FECHA: null });
    expect(reader.readRecord(1)).toEqual({ FECHA: "2026-10-30" });
  });
});
