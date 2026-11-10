import { quoteIdentifier } from "@/core/services/sqlStatements";
import {
  buildTextGeometryParse,
  GEOMETRY_STAGE_COLUMN,
  STAGE_RECORD_COLUMN,
  STAGE_TABLE,
} from "@/core/services/server/shpReplace/replaceSql";
import type { ShpQuerySession } from "@/core/services/server/shpReplace/shpReplaceTypes";

const CHECK_FUNCTION = "pg_temp.gis_tools_geometry_text_ok";

const buildCreateGeometryCheckSql = (): string =>
  `CREATE FUNCTION ${CHECK_FUNCTION}(${quoteIdentifier(GEOMETRY_STAGE_COLUMN)} text) RETURNS boolean LANGUAGE plpgsql AS $check$ BEGIN PERFORM ${buildTextGeometryParse()}; RETURN true; EXCEPTION WHEN OTHERS THEN RETURN false; END $check$`;

const buildFindInvalidGeometrySql = (): string =>
  `SELECT ${quoteIdentifier(STAGE_RECORD_COLUMN)} AS rec FROM ${quoteIdentifier(STAGE_TABLE)} WHERE ${quoteIdentifier(GEOMETRY_STAGE_COLUMN)} IS NOT NULL AND NOT ${CHECK_FUNCTION}(${quoteIdentifier(GEOMETRY_STAGE_COLUMN)}) ORDER BY ${quoteIdentifier(STAGE_RECORD_COLUMN)} LIMIT 1`;

export async function assertStagedGeometriesParse(session: ShpQuerySession): Promise<void> {
  await session.query(buildCreateGeometryCheckSql());
  const result = await session.query(buildFindInvalidGeometrySql());
  const invalid = result.rows[0];
  if (invalid) {
    throw new Error(`La geometría de la fila ${Number(invalid.rec)} no se pudo interpretar (se esperaba EWKB hexadecimal, WKT o EWKT).`);
  }
}
