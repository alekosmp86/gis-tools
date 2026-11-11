import { describe, expect, it } from "vitest";
import { shortNameOf } from "@/modules/routine-jobs/jobs/ejes-calles/domain/shortName";

describe("shortNameOf", () => {
  it.each([
    ["CALLE DOCTOR JOSE PEREZ", "CL DR JOSE PEREZ"],
    ["CONTINUACION CONSEJAL ANDRES NAPPA", "CONT CONSEJAL ANDRES NAPPA"],
    ["INGENIERO AGRIMENSOR JOSE OTAMENDI", "ING AGRIM JOSE OTAMENDI"],
    ["RUTA 30 - PERIMETRAL INGENIERO ELADIO DIESTE", "RUTA 30 - PERIMETRAL ING ELADIO DIESTE"],
  ])("should abbreviate %s as %s", (name, expected) => {
    expect(shortNameOf(name)).toBe(expected);
  });

  it("should keep only the part before the dash for a route name", () => {
    expect(shortNameOf("RUTA 8 - BRIGADIER GENERAL JUAN A. LAVALLEJA")).toBe("RUTA 8");
  });

  it("should apply a length-conditional rule only while the short name is longer than its limit", () => {
    expect(shortNameOf("CAMINO A LA ESTACION CENTRAL")).toBe("CNO A LA EST CENTRAL");
    expect(shortNameOf("CALLE ESTACION")).toBe("CL ESTACION");
  });

  it("should leave a name without any abbreviable word as it is", () => {
    expect(shortNameOf("LAS ACACIAS")).toBe("LAS ACACIAS");
  });
});
