import { buildAnalyzeStatement } from "@/core/services/sqlStatements";
import { q } from "../../shared/sqlFragments";
import {
  ACCESS_POINT_COLUMN,
  ADDRESS_COLUMN,
  ADDRESS_MASTER_COLUMN,
  CIRCULATION_WAY_COLUMN,
  DISTANCE_DECIMALS,
  EJES_LOAD_ROLES,
  EJES_TABLE_ROLE,
  LOAD_LOCK_TIMEOUT_MS,
  MASTER_URN_PREFIX,
  PADRON_COLUMN,
  ROAD_SECTION_COLUMN,
} from "../constants";
import type { EjesLoadContext, EjesLoadRole } from "../types";
import { accessPointRefMatchSql } from "./analysisSql";
import { physicalOf, qualifiedOf, typedAs } from "./loadContext";
import { col, table } from "./layoutSql";
import { LOAD_TEMP, tmp } from "./loadSelectionSql";

export const WRITTEN_ALIAS = "written";

export const buildLockTimeoutSql = (): string => `SET LOCAL lock_timeout = ${LOAD_LOCK_TIMEOUT_MS}`;

export const buildLockSql = (context: EjesLoadContext): string =>
  `LOCK TABLE ${EJES_LOAD_ROLES.map((role) => qualifiedOf(context, role)).join(", ")} IN SHARE ROW EXCLUSIVE MODE`;

export const counted = (statement: string): string =>
  `WITH ${q(WRITTEN_ALIAS)} AS (${statement} RETURNING 1) SELECT count(*) AS ${q(WRITTEN_ALIAS)} FROM ${q(WRITTEN_ALIAS)}`;

const columnsOf = (context: EjesLoadContext, role: EjesLoadRole, logicals: readonly string[]): string =>
  logicals.map((logical) => physicalOf(context, role, logical)).join(", ");

export function buildInsertWaysSql(context: EjesLoadContext): string {
  const way = EJES_TABLE_ROLE.CIRCULATION_WAY;
  const typed = (logical: string, expression: string): string => typedAs(context, way, logical, expression);
  const logicals = [
    CIRCULATION_WAY_COLUMN.ID,
    CIRCULATION_WAY_COLUMN.NAME,
    CIRCULATION_WAY_COLUMN.SHORT_NAME,
    CIRCULATION_WAY_COLUMN.ROAD_TYPE,
    CIRCULATION_WAY_COLUMN.FONT,
    CIRCULATION_WAY_COLUMN.CALLE,
  ];
  return counted(
    [
      `INSERT INTO ${qualifiedOf(context, way)} (${columnsOf(context, way, logicals)}) OVERRIDING SYSTEM VALUE`,
      `SELECT ${typed(CIRCULATION_WAY_COLUMN.ID, "w.way_id")}, ${typed(CIRCULATION_WAY_COLUMN.NAME, "w.name")}, ${typed(CIRCULATION_WAY_COLUMN.SHORT_NAME, "w.short_name")},`,
      `${typed(CIRCULATION_WAY_COLUMN.ROAD_TYPE, "w.type_id")}, ${typed(CIRCULATION_WAY_COLUMN.FONT, "w.font_id")}, ${typed(CIRCULATION_WAY_COLUMN.CALLE, "w.idcalle")}`,
      `FROM ${tmp(LOAD_TEMP.WAY)} AS w ORDER BY w.way_id`,
    ].join(" ")
  );
}

export function buildInsertMastersSql(context: EjesLoadContext): string {
  const master = EJES_TABLE_ROLE.ADDRESS_MASTER;
  const typed = (logical: string, expression: string): string => typedAs(context, master, logical, expression);
  const logicals = [ADDRESS_MASTER_COLUMN.ID, ADDRESS_MASTER_COLUMN.URN, ADDRESS_MASTER_COLUMN.LATITUDE, ADDRESS_MASTER_COLUMN.LONGITUDE];
  return counted(
    [
      `INSERT INTO ${qualifiedOf(context, master)} (${columnsOf(context, master, logicals)}) OVERRIDING SYSTEM VALUE`,
      `SELECT ${typed(ADDRESS_MASTER_COLUMN.ID, "n.master_id")}, ${typed(ADDRESS_MASTER_COLUMN.URN, `'${MASTER_URN_PREFIX}' || n.section_id::text`)},`,
      `${typed(ADDRESS_MASTER_COLUMN.LATITUDE, "0")}, ${typed(ADDRESS_MASTER_COLUMN.LONGITUDE, "0")}`,
      `FROM ${tmp(LOAD_TEMP.NEW)} AS n ORDER BY n.section_id`,
    ].join(" ")
  );
}

export const distanceSql = (geometry: string): string => `round(ST_Length(${geometry})::numeric, ${DISTANCE_DECIMALS})::text`;

export function buildInsertSectionsSql(context: EjesLoadContext): string {
  const section = EJES_TABLE_ROLE.ROAD_SECTION;
  const typed = (logical: string, expression: string): string => typedAs(context, section, logical, expression);
  const logicals = [
    ROAD_SECTION_COLUMN.ID,
    ROAD_SECTION_COLUMN.REFTRAMO,
    ROAD_SECTION_COLUMN.CIRCULATION_WAY,
    ROAD_SECTION_COLUMN.TYPE,
    ROAD_SECTION_COLUMN.FONT,
    ROAD_SECTION_COLUMN.ADDRESS_MASTER,
    ROAD_SECTION_COLUMN.SOURCE,
    ROAD_SECTION_COLUMN.TARGET,
    ROAD_SECTION_COLUMN.DISTANCE,
    ROAD_SECTION_COLUMN.GEOMETRY,
  ];
  return counted(
    [
      `INSERT INTO ${qualifiedOf(context, section)} (${columnsOf(context, section, logicals)}) OVERRIDING SYSTEM VALUE`,
      `SELECT ${typed(ROAD_SECTION_COLUMN.ID, "n.section_id")}, ${typed(ROAD_SECTION_COLUMN.REFTRAMO, "c.ref")}, ${typed(ROAD_SECTION_COLUMN.CIRCULATION_WAY, "c.idcalle")},`,
      `${typed(ROAD_SECTION_COLUMN.TYPE, "c.type_id")}, ${typed(ROAD_SECTION_COLUMN.FONT, "c.font_id")}, ${typed(ROAD_SECTION_COLUMN.ADDRESS_MASTER, "n.master_id")},`,
      `${typed(ROAD_SECTION_COLUMN.SOURCE, "NULL")}, ${typed(ROAD_SECTION_COLUMN.TARGET, "NULL")}, ${typed(ROAD_SECTION_COLUMN.DISTANCE, distanceSql("c.geom"))}, c.geom`,
      `FROM ${tmp(LOAD_TEMP.NEW)} AS n JOIN ${tmp(LOAD_TEMP.COPY)} AS c ON c.copy_id = n.copy_id ORDER BY n.section_id`,
    ].join(" ")
  );
}

const sectionUpdate = (context: EjesLoadContext, assignments: string, copyJoin: boolean, condition: string): string =>
  counted(
    [
      `UPDATE ${qualifiedOf(context, EJES_TABLE_ROLE.ROAD_SECTION)} AS r SET ${assignments}`,
      `FROM ${tmp(LOAD_TEMP.STATE)} AS s${copyJoin ? ` JOIN ${tmp(LOAD_TEMP.COPY)} AS c ON c.copy_id = s.copy_id` : ""}`,
      `WHERE r.${physicalOf(context, EJES_TABLE_ROLE.ROAD_SECTION, ROAD_SECTION_COLUMN.ID)} = s.road_id AND ${condition}`,
    ].join(" ")
  );

const setOf = (context: EjesLoadContext, logical: string, expression: string): string =>
  `${physicalOf(context, EJES_TABLE_ROLE.ROAD_SECTION, logical)} = ${typedAs(context, EJES_TABLE_ROLE.ROAD_SECTION, logical, expression)}`;

export const buildUpdateIdcalleSql = (context: EjesLoadContext): string =>
  sectionUpdate(context, setOf(context, ROAD_SECTION_COLUMN.CIRCULATION_WAY, "c.idcalle"), true, "s.idcalle_changed");

export const buildUpdateTypeSql = (context: EjesLoadContext): string =>
  sectionUpdate(context, setOf(context, ROAD_SECTION_COLUMN.TYPE, "c.type_id"), true, "s.type_changed");

export const buildUpdateFontSql = (context: EjesLoadContext): string =>
  sectionUpdate(context, setOf(context, ROAD_SECTION_COLUMN.FONT, "c.font_id"), true, "s.font_changed");

export function buildUpdateGeometrySql(context: EjesLoadContext): string {
  const geometry = physicalOf(context, EJES_TABLE_ROLE.ROAD_SECTION, ROAD_SECTION_COLUMN.GEOMETRY);
  const assignments = [
    `${geometry} = c.geom`,
    setOf(context, ROAD_SECTION_COLUMN.DISTANCE, distanceSql("c.geom")),
    setOf(context, ROAD_SECTION_COLUMN.SOURCE, "NULL"),
    setOf(context, ROAD_SECTION_COLUMN.TARGET, "NULL"),
  ].join(", ");
  return sectionUpdate(context, assignments, true, "s.geom_changed");
}

export const buildRenumberSectionsSql = (context: EjesLoadContext): string =>
  sectionUpdate(context, setOf(context, ROAD_SECTION_COLUMN.REFTRAMO, "s.renum_new"), false, "s.renum_new IS NOT NULL");

/** The only write on `access_point`: the points of an old `reftramo` follow their section to the new one. */
export function buildMovePointsSql(context: EjesLoadContext): string {
  const reference = physicalOf(context, EJES_TABLE_ROLE.ACCESS_POINT, ACCESS_POINT_COLUMN.ROAD_SECTION);
  return counted(
    [
      `UPDATE ${qualifiedOf(context, EJES_TABLE_ROLE.ACCESS_POINT)} AS a SET ${reference} = ${typedAs(context, EJES_TABLE_ROLE.ACCESS_POINT, ACCESS_POINT_COLUMN.ROAD_SECTION, "n.new_ref")}`,
      `FROM ${tmp(LOAD_TEMP.MOVE)} AS n WHERE ${accessPointRefMatchSql(context, "n.old_ref")}`,
    ].join(" ")
  );
}

/** Applied removals and merged old sections, deleted only while no access point holds their `reftramo` or their `road_section.id` (the guard aborts the load otherwise). */
export function buildDeleteSectionsSql(context: EjesLoadContext): string {
  const section = EJES_TABLE_ROLE.ROAD_SECTION;
  return counted(
    [
      `DELETE FROM ${qualifiedOf(context, section)} AS r USING ${tmp(LOAD_TEMP.DEL)} AS d`,
      `WHERE r.${physicalOf(context, section, ROAD_SECTION_COLUMN.ID)} = d.road_id`,
      `AND NOT EXISTS (SELECT 1 FROM ${qualifiedOf(context, EJES_TABLE_ROLE.ACCESS_POINT)} AS a WHERE ${accessPointRefMatchSql(context, "d.ref")})`,
      `AND NOT EXISTS (SELECT 1 FROM ${qualifiedOf(context, EJES_TABLE_ROLE.ACCESS_POINT)} AS a WHERE ${accessPointRefMatchSql(context, "d.road_id::text")})`,
    ].join(" ")
  );
}

/** The address masters of the deleted sections that no section holds any more. Runs after the section deletes. */
export function buildDeleteMastersSql(context: EjesLoadContext): string {
  const master = EJES_TABLE_ROLE.ADDRESS_MASTER;
  const masterId = physicalOf(context, master, ADDRESS_MASTER_COLUMN.ID);
  const sectionMaster = physicalOf(context, EJES_TABLE_ROLE.ROAD_SECTION, ROAD_SECTION_COLUMN.ADDRESS_MASTER);
  return counted(
    [
      `DELETE FROM ${qualifiedOf(context, master)} AS m USING (SELECT DISTINCT d.master_id FROM ${tmp(LOAD_TEMP.DEL)} AS d WHERE d.master_deleted) AS d`,
      `WHERE m.${masterId} = d.master_id AND NOT EXISTS (SELECT 1 FROM ${qualifiedOf(context, EJES_TABLE_ROLE.ROAD_SECTION)} AS r WHERE r.${sectionMaster} = m.${masterId})`,
      `AND NOT EXISTS (SELECT 1 FROM ${table(context.layouts, "ADDRESS")} AS h WHERE h.${col(context.layouts, "ADDRESS", ADDRESS_COLUMN.ADDRESS_MASTER)} = m.${masterId})`,
      `AND NOT EXISTS (SELECT 1 FROM ${table(context.layouts, "PADRONES")} AS h WHERE h.${col(context.layouts, "PADRONES", PADRON_COLUMN.ADDRESS_MASTER)} = m.${masterId})`,
    ].join(" ")
  );
}

export const buildAnalyzeLoadedSql = (context: EjesLoadContext, role: EjesLoadRole): string => {
  const target = context.targets[role];
  return buildAnalyzeStatement(target.schema, target.table);
};
