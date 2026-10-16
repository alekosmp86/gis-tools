import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));

import { SqlPatchDrawer } from "@/components/tools/db-sync-common/sql-patch-drawer/SqlPatchDrawer";
import type { DbConfig } from "@/core/types/db";

const EMPTY_MESSAGE =
  "No hay registros seleccionados. Seleccione registros en la tabla de discrepancias para generar el script.";

const dbConfig = { schema_name: "s", table_name: "t" } as unknown as DbConfig;

type DrawerProps = React.ComponentProps<typeof SqlPatchDrawer>;

function render(overrides: Partial<DrawerProps> = {}): string {
  const props: DrawerProps = {
    tableName: "t",
    dbConfig,
    selectedCount: 0,
    selectionVersion: 0,
    sqlUpdatePreview: "",
    sqlInsertPreview: "",
    sqlUpdateCount: 0,
    sqlInsertCount: 0,
    ...overrides,
  };
  return renderToStaticMarkup(React.createElement(SqlPatchDrawer, props));
}

/** Returns disabled flags for the header buttons in order: copy, download, execute. */
function headerDisabled(html: string): boolean[] {
  return html
    .split("<button")
    .slice(1, 4)
    .map((segment) => segment.slice(0, segment.indexOf(">")).includes("disabled"));
}

describe("SqlPatchDrawer selection-driven state", () => {
  it("should show the empty-selection message when nothing is selected", () => {
    expect(render()).toContain(EMPTY_MESSAGE);
  });

  it("should disable Copy, Download and Execute at 0 selected", () => {
    const html = render();
    expect(html).toContain("Copiar SQL");
    expect(html).toContain("Descargar .sql");
    expect(html).toContain("Ejecutar en BD");
    expect(headerDisabled(html)).toEqual([true, true, true]);
  });

  it("should hide the empty-selection message and enable the actions with 1 selected", () => {
    const html = render({
      selectedCount: 1,
      sqlUpdateCount: 1,
      sqlUpdatePreview: "UPDATE a;",
    });
    expect(html).not.toContain(EMPTY_MESSAGE);
    expect(headerDisabled(html)).toEqual([false, false, false]);
  });

  it("should keep Execute disabled when selection exists but the active tab has no statements", () => {
    const html = render({
      selectedCount: 3,
      sqlUpdateCount: 0,
      sqlUpdatePreview: "",
      sqlInsertCount: 3,
      sqlInsertPreview: "INSERT x;",
    });
    expect(headerDisabled(html)).toEqual([false, false, true]);
  });

  it("should render the precomputed preview text", () => {
    const html = render({
      selectedCount: 2,
      sqlUpdateCount: 2,
      sqlUpdatePreview: "UPDATE unique_marker_1;",
    });
    expect(html).toContain("unique_marker_1");
  });

  it("should not show the empty-selection message regardless of selectionVersion when selected", () => {
    const html = render({ selectedCount: 5, selectionVersion: 99, sqlUpdateCount: 5, sqlUpdatePreview: "U;" });
    expect(html).not.toContain(EMPTY_MESSAGE);
  });
});
