import { describe, it, expect } from "vitest";
import { localityReferenceVerdict } from "@/modules/routine-jobs/jobs/actualizar-padron/domain/localityReference";

const TARGET = "carto.padron";
const LOCALITY = "carto.cadastral_locality";

describe("localityReferenceVerdict (AP-63)", () => {
  it("should return ok when there are no destination rows with a locality id (AP-63)", () => {
    const act = localityReferenceVerdict({ total: 0, unresolved: 0 }, TARGET, LOCALITY);

    expect(act).toEqual({ kind: "ok" });
  });

  it("should return ok when every referenced locality id resolves (AP-63)", () => {
    const act = localityReferenceVerdict({ total: 4, unresolved: 0 }, TARGET, LOCALITY);

    expect(act).toEqual({ kind: "ok" });
  });

  it("should return a warning naming the single padron, target and locality when unresolved is below half (AP-63)", () => {
    const act = localityReferenceVerdict({ total: 4, unresolved: 1 }, TARGET, LOCALITY);

    expect(act.kind).toBe("warn");
    if (act.kind !== "warn") return;
    expect(act.warning).toContain("1 padrón");
    expect(act.warning).toContain(TARGET);
    expect(act.warning).toContain(LOCALITY);
  });

  it("should refuse and ask for territorial_unit when unresolved is exactly half of total (AP-63)", () => {
    const act = localityReferenceVerdict({ total: 4, unresolved: 2 }, TARGET, LOCALITY);

    expect(act.kind).toBe("refuse");
    if (act.kind !== "refuse") return;
    expect(act.message).toContain("2 de 4");
    expect(act.message).toContain("territorial_unit");
  });

  it("should return a warning with plural wording when several padrones are unresolved below half (AP-63)", () => {
    const act = localityReferenceVerdict({ total: 10, unresolved: 4 }, TARGET, LOCALITY);

    expect(act.kind).toBe("warn");
    if (act.kind !== "warn") return;
    expect(act.warning).toContain("4 padrones");
  });
});
