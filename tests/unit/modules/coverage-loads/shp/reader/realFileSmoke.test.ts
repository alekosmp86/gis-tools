import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { iterateRecordEwkb, scanShapefile } from "@/modules/coverage-loads/shp/job/reader/index.ts";

const REAL_NR = process.env.SHP_REAL_FILE ?? "";
const enabled = REAL_NR !== "" && existsSync(REAL_NR);

describe.skipIf(!enabled)("real NRUruguay shapefile smoke", () => {
  it("should match the known counts, net area and EWKB stream hash", async () => {
    const scan = await scanShapefile(REAL_NR);
    expect(scan.recordCount).toBe(2581);
    expect(scan.holeCount).toBe(245167);
    expect(Math.abs(scan.netArea - 20_860_298_118.465)).toBeLessThanOrEqual(1);

    const hash = createHash("sha1");
    let bytes = 0;
    const gen = iterateRecordEwkb(REAL_NR);
    for (;;) {
      const r = await gen.next();
      if (r.done) break;
      for await (const chunk of r.value.chunks()) {
        hash.update(chunk);
        bytes += chunk.length;
      }
    }

    expect(bytes).toBe(122_270_622);
    expect(hash.digest("hex")).toBe("c7c17c9f19dfd8a6ebc1956935730790dc8fe47f");
  }, 600_000);
});
