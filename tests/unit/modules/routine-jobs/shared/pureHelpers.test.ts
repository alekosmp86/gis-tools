import { describe, expect, it } from "vitest";
import { plural } from "@/modules/routine-jobs/jobs/shared/text";
import { listOf, nullableNumber, numberOf, textOf } from "@/modules/routine-jobs/jobs/shared/rowMapping";
import { assertTablesDistinct, RequestInvalidError } from "@/modules/routine-jobs/api/requestParsing";
import { outcomeBannersOf, timingsViewOf } from "@/modules/routine-jobs/ui/reportViewParts";

describe("plural", () => {
  it("should use the singular form for exactly one", () => {
    expect(plural(1, "unidad", "unidades")).toBe("1 unidad");
  });

  it.each([0, 2, 500])("should use the plural form for %i", (count) => {
    expect(plural(count, "unidad", "unidades")).toBe(`${count} unidades`);
  });
});

describe("row mapping helpers", () => {
  describe("numberOf", () => {
    it("should read a numeric value and numeric text as numbers", () => {
      expect(numberOf(7)).toBe(7);
      expect(numberOf("12")).toBe(12);
    });

    it("should read null and undefined as zero", () => {
      expect(numberOf(null)).toBe(0);
      expect(numberOf(undefined)).toBe(0);
    });
  });

  describe("nullableNumber", () => {
    it("should keep zero as zero, not as null", () => {
      expect(nullableNumber(0)).toBe(0);
    });

    it("should read numeric text as a number", () => {
      expect(nullableNumber("3.5")).toBe(3.5);
    });

    it.each([null, undefined])("should read %s as null", (value) => {
      expect(nullableNumber(value)).toBeNull();
    });
  });

  describe("textOf", () => {
    it("should read a number as its text form and keep an empty string", () => {
      expect(textOf(5)).toBe("5");
      expect(textOf("")).toBe("");
    });

    it.each([null, undefined])("should read %s as null", (value) => {
      expect(textOf(value)).toBeNull();
    });
  });

  describe("listOf", () => {
    it("should pass an array through unchanged", () => {
      const rows = [{ id: 1 }];

      expect(listOf(rows)).toBe(rows);
    });

    it.each([null, undefined, "texto", 3, { id: 1 }])("should read %j as an empty list", (value) => {
      expect(listOf(value)).toEqual([]);
    });
  });
});

describe("assertTablesDistinct", () => {
  it("should return without error when the check passes", () => {
    expect(() => assertTablesDistinct({ a: 1 }, () => undefined)).not.toThrow();
  });

  it("should rethrow the check failure as a RequestInvalidError with the same message", () => {
    expect(() =>
      assertTablesDistinct({ a: 1 }, () => {
        throw new Error("Las tablas deben ser distintas.");
      }),
    ).toThrow(RequestInvalidError);

    try {
      assertTablesDistinct({ a: 1 }, () => {
        throw new Error("Las tablas deben ser distintas.");
      });
    } catch (error: unknown) {
      expect((error as Error).message).toBe("Las tablas deben ser distintas.");
    }
  });

  it("should use the text of a non-Error failure as the message", () => {
    expect(() =>
      assertTablesDistinct({}, () => {
        throw "fallo textual";
      }),
    ).toThrow(new RequestInvalidError("fallo textual"));
  });

  it("should hand the parsed params to the check", () => {
    const params = { unitTable: "t" };
    let received: unknown;

    assertTablesDistinct(params, (value) => {
      received = value;
    });

    expect(received).toBe(params);
  });
});

describe("outcomeBannersOf", () => {
  const texts = { unknown: "desconocido", dryRun: "simulación", done: "terminado" };

  it("should show the done banner after a real run that modified the tables", () => {
    expect(outcomeBannersOf({ dryRun: false, outcomeUnknown: false, modified: true }, texts)).toEqual([
      { kind: "done", text: "terminado" },
    ]);
  });

  it("should show the dry-run banner and never the done banner on a dry run, even when modified is true", () => {
    expect(outcomeBannersOf({ dryRun: true, outcomeUnknown: false, modified: true }, texts)).toEqual([
      { kind: "dryRun", text: "simulación" },
    ]);
  });

  it("should show the unknown banner first, before the dry-run banner, when the outcome is unknown", () => {
    expect(outcomeBannersOf({ dryRun: true, outcomeUnknown: true, modified: false }, texts)).toEqual([
      { kind: "unknown", text: "desconocido" },
      { kind: "dryRun", text: "simulación" },
    ]);
  });

  it("should show no banner on a real run that modified nothing and has no unknown outcome", () => {
    expect(outcomeBannersOf({ dryRun: false, outcomeUnknown: false, modified: false }, texts)).toEqual([]);
  });
});

describe("timingsViewOf", () => {
  it("should convert milliseconds to seconds and sum them", () => {
    expect(
      timingsViewOf([
        { label: "Leer", ms: 1500 },
        { label: "Confirmar", ms: 250 },
      ]),
    ).toEqual({
      timings: [
        { label: "Leer", seconds: 1.5 },
        { label: "Confirmar", seconds: 0.25 },
      ],
      totalSeconds: 1.75,
    });
  });

  it("should return no timings and a zero total for an empty list", () => {
    expect(timingsViewOf([])).toEqual({ timings: [], totalSeconds: 0 });
  });
});
