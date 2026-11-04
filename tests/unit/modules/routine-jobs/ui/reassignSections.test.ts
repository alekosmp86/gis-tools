import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { ActualizarPadronBackup } from "@/modules/routine-jobs/jobs/actualizar-padron/types";
import { ActualizarBackupSection } from "@/modules/routine-jobs/ui/ActualizarBackupSection";
import { RemovalSection } from "@/modules/routine-jobs/ui/RemovalSection";
import type { RemovalView } from "@/modules/routine-jobs/ui/removalReportView";

vi.mock("@/modules/routine-jobs/ui/padronBackupAutoDownload", () => ({ claimAutomaticBackupDownload: vi.fn(() => false) }));
vi.mock("@/modules/routine-jobs/ui/padronBackupDownload", () => ({ downloadPadronBackup: vi.fn(async () => undefined) }));

const backupOf = (counts: Partial<ActualizarPadronBackup["counts"]> = {}): ActualizarPadronBackup => ({
  token: "00000000-0000-4000-8000-000000000000",
  fileName: "padron-revert-carto-padron-20261030-120000.sql.gz",
  bytes: 2048,
  counts: { updated: 1, paired: 2, inserted: 3, addressMasterRows: 4, deleted: 0, ...counts },
});

const renderBackup = (backup: ActualizarPadronBackup): string => renderToStaticMarkup(React.createElement(ActualizarBackupSection, { backup }));

describe("ActualizarBackupSection count rows (AP-115)", () => {
  it("should list the reassigned addresses and the deleted address master entries when they are above zero", () => {
    const html = renderBackup(backupOf({ deleted: 2, reassigned: 6, masterDeleted: 2 }));

    expect(html).toContain("Direcciones reasignadas");
    expect(html).toContain("Entradas de direcciones maestras eliminadas");
    expect(html.indexOf("Padrones eliminados")).toBeLessThan(html.indexOf("Direcciones reasignadas"));
    expect(html.indexOf("Direcciones reasignadas")).toBeLessThan(html.indexOf("Entradas de direcciones maestras eliminadas"));
    expect(html.indexOf("Entradas de direcciones maestras eliminadas")).toBeLessThan(html.indexOf("Padrones sin dirección maestra antes del enlace"));
  });

  it("should leave both rows out when the counts are zero", () => {
    const html = renderBackup(backupOf({ reassigned: 0, masterDeleted: 0 }));

    expect(html).not.toContain("Direcciones reasignadas");
    expect(html).not.toContain("Entradas de direcciones maestras eliminadas");
  });

  it("should leave both rows out for the backup of an older run that lacks the fields", () => {
    const html = renderBackup(backupOf());

    expect(html).not.toContain("Direcciones reasignadas");
    expect(html).not.toContain("Entradas de direcciones maestras eliminadas");
    expect(html).toContain("Geometrías actualizadas");
  });

  it("should show one row without the other when only one count is above zero", () => {
    const html = renderBackup(backupOf({ reassigned: 3 }));

    expect(html).toContain("Direcciones reasignadas");
    expect(html).not.toContain("Entradas de direcciones maestras eliminadas");
  });
});

const viewOf = (overrides: Partial<RemovalView> = {}): RemovalView => ({
  headline: "Padrones que se eliminarán: 1 (sin direcciones asociadas o con direcciones reasignadas a sus partes)",
  reassignedNote: null,
  reassignedChangedNote: null,
  notRemoved: [],
  blockedReason: null,
  listSummary: "Padrones eliminados (0)",
  rows: [],
  statusLabel: "Se eliminará",
  ...overrides,
});

describe("RemovalSection reassigned note (AP-115)", () => {
  it("should render the reassigned note when the view has one", () => {
    const html = renderToStaticMarkup(
      React.createElement(RemovalSection, { view: viewOf({ reassignedNote: "Direcciones que pasan a la parte más cercana de su padrón subdividido: 5 (carto.a: 5)" }) })
    );

    expect(html).toContain("Direcciones que pasan a la parte más cercana de su padrón subdividido: 5 (carto.a: 5)");
  });

  it("should render the changed-padrones note when the view has one", () => {
    const html = renderToStaticMarkup(
      React.createElement(RemovalSection, { view: viewOf({ reassignedChangedNote: "2 direcciones cambian de padrón porque su padrón cambió de forma (se reasigna su id_padron)" }) })
    );

    expect(html).toContain("2 direcciones cambian de padrón porque su padrón cambió de forma");
  });

  it("should render no note when the view has none", () => {
    const html = renderToStaticMarkup(React.createElement(RemovalSection, { view: viewOf() }));

    expect(html).not.toContain("Direcciones");
    expect(html).toContain("Padrones que se eliminarán: 1");
  });
});
