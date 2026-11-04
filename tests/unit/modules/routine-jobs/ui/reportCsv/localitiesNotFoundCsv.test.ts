import { describe, expect, it } from "vitest";
import { LOCALITY_REASON_GROUP_LIMIT } from "@/modules/routine-jobs/jobs/actualizar-padron/constants";
import type { LocalityRow } from "@/modules/routine-jobs/ui/actualizarPadronReportView";
import { buildLocalitiesNotFoundCsv } from "@/modules/routine-jobs/ui/reportCsv/localitiesNotFoundCsv";
import { BOM, parseCsv } from "./reportCsvFixtures";

const HEADER = ["Departamento", "Localidad", "Padrones afectados", "Motivo"];
const MARKER = "Lista incompleta: se muestran las primeras 20 localidades no encontradas";
const NOWHERE = "La localidad no existe en el departamento.";

const rowOf = (overrides: Partial<LocalityRow> = {}): LocalityRow => ({
  department: "CANELONES",
  locality: "NUEVA HELVECIA",
  count: 12,
  otherDepartments: ["COLONIA"],
  ...overrides,
});

const rowsOf = (count: number): LocalityRow[] =>
  Array.from({ length: count }, (_, index) => rowOf({ locality: `LOCALIDAD ${index}`, count: index + 1 }));

describe("buildLocalitiesNotFoundCsv (AP-120)", () => {
  it("should start with the BOM and the four column header", () => {
    const csv = buildLocalitiesNotFoundCsv([rowOf()]);

    expect(csv.startsWith(BOM)).toBe(true);
    expect(parseCsv(csv)[0]).toEqual(HEADER);
  });

  it("should write only the header for an empty list", () => {
    const csv = buildLocalitiesNotFoundCsv([]);

    expect(parseCsv(csv)).toEqual([HEADER]);
  });

  it("should tell to review the department code when the locality exists in one other department", () => {
    const csv = buildLocalitiesNotFoundCsv([rowOf()]);

    expect(parseCsv(csv)[1]).toEqual([
      "CANELONES",
      "NUEVA HELVECIA",
      "12",
      "No existe en CANELONES; existe en COLONIA. Revise el código de departamento.",
    ]);
  });

  it("should list every other department separated by comma space", () => {
    const csv = buildLocalitiesNotFoundCsv([rowOf({ otherDepartments: ["COLONIA", "ROCHA"] })]);

    expect(parseCsv(csv)[1][3]).toBe("No existe en CANELONES; existe en COLONIA, ROCHA. Revise el código de departamento.");
  });

  it("should say the locality does not exist when it is in no other department", () => {
    const csv = buildLocalitiesNotFoundCsv([rowOf({ otherDepartments: [] })]);

    expect(parseCsv(csv)[1][3]).toBe(NOWHERE);
  });

  it("should add no marker row below the cap", () => {
    const rows = parseCsv(buildLocalitiesNotFoundCsv(rowsOf(LOCALITY_REASON_GROUP_LIMIT - 1)));

    expect(rows).toHaveLength(LOCALITY_REASON_GROUP_LIMIT);
    expect(rows.flat()).not.toContain(MARKER);
  });

  it("should end with the marker row when the list reaches the cap of 20", () => {
    const rows = parseCsv(buildLocalitiesNotFoundCsv(rowsOf(LOCALITY_REASON_GROUP_LIMIT)));

    expect(rows).toHaveLength(LOCALITY_REASON_GROUP_LIMIT + 2);
    expect(rows[rows.length - 1]).toEqual([MARKER, "", "", ""]);
  });

  it("should escape names that hold commas and quotes", () => {
    const csv = buildLocalitiesNotFoundCsv([rowOf({ department: 'DEP "X", Y', locality: 'VILLA, "LA" ESTRELLA', otherDepartments: [] })]);

    expect(csv).toContain('"DEP ""X"", Y","VILLA, ""LA"" ESTRELLA",12');
    expect(parseCsv(csv)[1].slice(0, 2)).toEqual(['DEP "X", Y', 'VILLA, "LA" ESTRELLA']);
  });
});
