import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { ActualizarPadronBackup } from "@/modules/routine-jobs/jobs/actualizar-padron/types";
import type { CentrosResult } from "@/modules/routine-jobs/jobs/centros-anep/types";
import { ActualizarBackupSection } from "@/modules/routine-jobs/ui/ActualizarBackupSection";
import { CentrosAnepReport } from "@/modules/routine-jobs/ui/CentrosAnepReport";
import { RevertBackupSection } from "@/modules/routine-jobs/ui/RevertBackupSection";
import { cleanStaging } from "../centros-anep/centrosFixtures";

const TITLE = "Respaldo para revertir";
const BUTTON = "Descargar respaldo";

describe("RevertBackupSection shared by actualizar-padron and centros-anep (CA-12)", () => {
  it("should render the title, the file name, the size, the rows, the instructions and the download button", () => {
    const html = renderToStaticMarkup(
      React.createElement(RevertBackupSection, {
        backup: { token: "tok-shared", fileName: "x-revert.sql.gz", bytes: 1048576 },
        rows: [{ label: "Filas", value: 7 }],
        instructions: ["Primera instrucción.", "Segunda instrucción."],
      })
    );

    expect(html).toContain(TITLE);
    expect(html).toContain("x-revert.sql.gz");
    expect(html).toContain("Filas");
    expect(html).toContain("Primera instrucción.");
    expect(html).toContain("Segunda instrucción.");
    expect(html).toContain(BUTTON);
    expect(html).not.toContain("No se pudo descargar el respaldo.");
  });

  it("should still render the actualizar-padron backup with its counts and the seven day note", () => {
    const backup = {
      token: "tok-actualizar",
      fileName: "padron-revert-carto-padron-20261030-120000.sql.gz",
      bytes: 2048,
      counts: { updated: 3, paired: 1, inserted: 5, addressMasterRows: 2, deleted: 0 },
    } as unknown as ActualizarPadronBackup;

    const html = renderToStaticMarkup(React.createElement(ActualizarBackupSection, { backup }));

    expect(html).toContain(TITLE);
    expect(html).toContain("padron-revert-carto-padron-20261030-120000.sql.gz");
    expect(html).toContain("Geometrías actualizadas");
    expect(html).toContain("Padrones insertados");
    expect(html).not.toContain("Padrones eliminados");
    expect(html).toContain("7 días");
    expect(html).toContain(BUTTON);
  });
});

describe("CentrosAnepReport backup block (CA-12)", () => {
  const resultOf = (overrides: Partial<CentrosResult>): CentrosResult =>
    ({
      dryRun: false,
      targetModified: true,
      outcomeUnknown: false,
      staging: cleanStaging(),
      comparison: { currentRows: 3, afterRows: 2902, bySubsistema: [] },
      blockers: [],
      privilegeInfo: [],
      columnInfo: [],
      copiedColumns: [],
      finalSrid: 32721,
      deleted: 3,
      inserted: 2902,
      warnings: [],
      tables: { "centros-anep-staging": "a.b", "centros-anep-final": "c.d" },
      stepTimings: [],
      ...overrides,
    }) as CentrosResult;

  it("should show the revert backup with its file name and the download button after a real run", () => {
    const backup = { token: "tok-centros", fileName: "centros-anep-revert-carto-ine_centros_anep-20261030-120000.sql.gz", bytes: 500, rows: 3 };

    const html = renderToStaticMarkup(React.createElement(CentrosAnepReport, { result: resultOf({ backup }) }));

    expect(html).toContain(TITLE);
    expect(html).toContain(backup.fileName);
    expect(html).toContain(BUTTON);
  });

  it("should not show a backup section when the run wrote none", () => {
    const html = renderToStaticMarkup(
      React.createElement(CentrosAnepReport, { result: resultOf({ dryRun: true, targetModified: false }) })
    );

    expect(html).not.toContain(TITLE);
  });
});
