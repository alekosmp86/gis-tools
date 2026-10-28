// fallow-ignore-file duplicate-export
import type { SourceTablesSpec, WriteTargetsSpec } from "../../shared/preflightAsserts";
import { STAGING_LOCALITY_COLUMN, TARGET_TITLE, TARGET_WRITTEN_COLUMNS } from "../constants";
import type { LocalityLayouts } from "../types";

export const CONFIRM_REQUIRED_MESSAGE =
  "Confirme la carga de localidades para escribir en las tablas de destino. Sin confirmación solo se permite el análisis sin cargar.";

export const writeTargetsSpecOf = (layouts: LocalityLayouts): WriteTargetsSpec => ({
  targets: layouts.targets,
  writtenColumns: TARGET_WRITTEN_COLUMNS,
  title: TARGET_TITLE,
  readTables: [layouts.padron, layouts.localities, layouts.province],
});

export const sourceTablesSpecOf = (layouts: LocalityLayouts): SourceTablesSpec => ({
  withRows: [
    { layout: layouts.padron, description: "padrones" },
    { layout: layouts.localities, description: "localidades" },
  ],
  geometry: { layout: layouts.localities, column: STAGING_LOCALITY_COLUMN.GEOM },
});
