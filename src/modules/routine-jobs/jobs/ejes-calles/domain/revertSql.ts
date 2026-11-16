import { literal, q } from "../../shared/sqlFragments";
import {
  ACCESS_POINT_COLUMN,
  CIRCULATION_WAY_COLUMN,
  EJES_TABLE_ROLE,
  LOAD_CHUNK_SIZE,
  ADDRESS_MASTER_COLUMN,
  ROAD_SECTION_COLUMN,
} from "../constants";
import type { EjesLayouts, EjesLoadContext, EjesLoadRole } from "../types";
import { accessPointRefMatchSql } from "./analysisSql";
import { col, table } from "./layoutSql";
import { physicalOf, qualifiedOf } from "./loadContext";
import { CHANGED_CONDITION, createTemp, LOAD_TEMP, tmp } from "./loadSelectionSql";

const REVERT_TEMP = {
  RESTORED_MASTERS: "ej_rev_masters",
  RESTORED_SECTIONS: "ej_rev_restore",
  SECTIONS: "ej_rev_sections",
  POINTS: "ej_rev_points",
  INSERTS: "ej_rev_inserts",
} as const;

/** Deleted masters come back before the sections that point at them; the points follow the restored sections, the inserted rows go last. */
export const REVERT_ORDER: readonly string[] = [
  REVERT_TEMP.RESTORED_MASTERS,
  REVERT_TEMP.RESTORED_SECTIONS,
  REVERT_TEMP.SECTIONS,
  REVERT_TEMP.POINTS,
  REVERT_TEMP.INSERTS,
];

export const REVERT_COLUMNS = { CURSOR: "cursor", LINE: "line" } as const;

export const REVERT_HEAD_SQL: readonly string[] = ["BEGIN;"];
export const REVERT_TAIL_SQL: readonly string[] = ["COMMIT;"];

const SECTION_RESTORED_COLUMNS = [
  ROAD_SECTION_COLUMN.REFTRAMO,
  ROAD_SECTION_COLUMN.CIRCULATION_WAY,
  ROAD_SECTION_COLUMN.TYPE,
  ROAD_SECTION_COLUMN.FONT,
  ROAD_SECTION_COLUMN.SOURCE,
  ROAD_SECTION_COLUMN.TARGET,
  ROAD_SECTION_COLUMN.DISTANCE,
  ROAD_SECTION_COLUMN.GEOMETRY,
];

const ID_LOGICAL_BY_ROLE: Record<EjesLoadRole, string> = {
  [EJES_TABLE_ROLE.ROAD_SECTION]: ROAD_SECTION_COLUMN.ID,
  [EJES_TABLE_ROLE.CIRCULATION_WAY]: CIRCULATION_WAY_COLUMN.ID,
  [EJES_TABLE_ROLE.ADDRESS_MASTER]: ADDRESS_MASTER_COLUMN.ID,
  [EJES_TABLE_ROLE.ACCESS_POINT]: ACCESS_POINT_COLUMN.ID,
};

const formatOf = (template: string, args: readonly string[]): string => `format(${literal(template)}, ${args.join(", ")})`;

/** One UPDATE per touched section, with every column the load can change, read before the first write. */
export function buildRevertSectionsSql(context: EjesLoadContext, layouts: EjesLayouts): string {
  const section = (logical: string): string => `r.${col(layouts, "ROAD_SECTION", logical)}`;
  const assignments = SECTION_RESTORED_COLUMNS.map(() => "%s = %L").join(", ");
  const args = [
    literal(qualifiedOf(context, EJES_TABLE_ROLE.ROAD_SECTION)),
    ...SECTION_RESTORED_COLUMNS.flatMap((logical) => [
      literal(physicalOf(context, EJES_TABLE_ROLE.ROAD_SECTION, logical)),
      section(logical),
    ]),
    literal(physicalOf(context, EJES_TABLE_ROLE.ROAD_SECTION, ROAD_SECTION_COLUMN.ID)),
    section(ROAD_SECTION_COLUMN.ID),
  ];
  return createTemp(
    REVERT_TEMP.SECTIONS,
    [
      `SELECT (row_number() OVER (ORDER BY ${section(ROAD_SECTION_COLUMN.ID)}))::bigint AS n,`,
      `${formatOf(`UPDATE %s SET ${assignments} WHERE %s = %L;`, args)} AS line`,
      `FROM ${table(layouts, "ROAD_SECTION")} AS r JOIN ${tmp(LOAD_TEMP.STATE)} AS s ON s.road_id = ${section(ROAD_SECTION_COLUMN.ID)}`,
      `WHERE ${CHANGED_CONDITION} OR s.renum_old IS NOT NULL`,
    ].join(" ")
  );
}

/** One UPDATE per old `reftramo` with the ids of its points, which hold the old value as it was written. */
export function buildRevertPointsSql(context: EjesLoadContext, layouts: EjesLayouts): string {
  const point = (logical: string): string => `a.${col(layouts, "ACCESS_POINT", logical)}`;
  const reference = point(ACCESS_POINT_COLUMN.ROAD_SECTION);
  const args = [
    literal(qualifiedOf(context, EJES_TABLE_ROLE.ACCESS_POINT)),
    literal(physicalOf(context, EJES_TABLE_ROLE.ACCESS_POINT, ACCESS_POINT_COLUMN.ROAD_SECTION)),
    "g.old_value",
    literal(physicalOf(context, EJES_TABLE_ROLE.ACCESS_POINT, ACCESS_POINT_COLUMN.ID)),
    "g.ids",
  ];
  return createTemp(
    REVERT_TEMP.POINTS,
    [
      `SELECT (row_number() OVER (ORDER BY g.old_value))::bigint AS n, ${formatOf("UPDATE %s SET %s = %L WHERE %s IN (%s);", args)} AS line FROM (`,
      `SELECT ${reference}::text AS old_value, string_agg(format('%L', ${point(ACCESS_POINT_COLUMN.ID)}), ', ' ORDER BY ${point(ACCESS_POINT_COLUMN.ID)}) AS ids`,
      `FROM ${table(layouts, "ACCESS_POINT")} AS a JOIN ${tmp(LOAD_TEMP.MOVE)} AS n ON ${accessPointRefMatchSql(context, "n.old_ref")} GROUP BY ${reference}::text`,
      ") AS g",
    ].join(" ")
  );
}

/**
 * Re-inserts the rows a load deletes, with their original ids: each row is read as JSON before the first write and rebuilt by
 * `jsonb_populate_record`, so every column comes back as it was.
 */
function buildRestoreRowsSql(context: EjesLoadContext, role: EjesLoadRole, idLogical: string, sourceSql: string, name: string): string {
  const target = literal(qualifiedOf(context, role));
  const id = physicalOf(context, role, idLogical);
  const statement = formatOf("INSERT INTO %s OVERRIDING SYSTEM VALUE SELECT * FROM jsonb_populate_record(NULL::%s, %L);", [
    target,
    target,
    "x.row_json",
  ]);
  return createTemp(
    name,
    [
      `SELECT (row_number() OVER (ORDER BY x.row_id))::bigint AS n, ${statement} AS line`,
      `FROM (SELECT t.${id} AS row_id, to_jsonb(t)::text AS row_json FROM ${qualifiedOf(context, role)} AS t`,
      `WHERE t.${id} IN (${sourceSql})) AS x`,
    ].join(" ")
  );
}

export const buildRevertMastersSql = (context: EjesLoadContext): string =>
  buildRestoreRowsSql(
    context,
    EJES_TABLE_ROLE.ADDRESS_MASTER,
    ADDRESS_MASTER_COLUMN.ID,
    `SELECT d.master_id FROM ${tmp(LOAD_TEMP.DEL)} AS d WHERE d.master_deleted`,
    REVERT_TEMP.RESTORED_MASTERS
  );

export const buildRevertRestoredSectionsSql = (context: EjesLoadContext): string =>
  buildRestoreRowsSql(
    context,
    EJES_TABLE_ROLE.ROAD_SECTION,
    ROAD_SECTION_COLUMN.ID,
    `SELECT d.road_id FROM ${tmp(LOAD_TEMP.DEL)} AS d`,
    REVERT_TEMP.RESTORED_SECTIONS
  );

function deleteChunksSql(part: number, context: EjesLoadContext, role: EjesLoadRole, source: string, idExpression: string): string {
  return [
    `SELECT ${part} AS part, x.g, ${literal(qualifiedOf(context, role))} AS tbl,`,
    `${literal(physicalOf(context, role, ID_LOGICAL_BY_ROLE[role]))} AS idcol,`,
    "string_agg(format('%L', x.id), ', ' ORDER BY x.id) AS ids",
    `FROM (SELECT ${idExpression} AS id, ((row_number() OVER (ORDER BY ${idExpression}) - 1) / ${LOAD_CHUNK_SIZE}) AS g FROM ${source}) AS x GROUP BY x.g`,
  ].join(" ");
}

/** Deletes of the inserted ids: sections first, then their address masters, then the new ways. */
export function buildRevertInsertsSql(context: EjesLoadContext): string {
  const branches = [
    deleteChunksSql(1, context, EJES_TABLE_ROLE.ROAD_SECTION, tmp(LOAD_TEMP.NEW), "section_id"),
    deleteChunksSql(2, context, EJES_TABLE_ROLE.ADDRESS_MASTER, tmp(LOAD_TEMP.NEW), "master_id"),
    deleteChunksSql(3, context, EJES_TABLE_ROLE.CIRCULATION_WAY, tmp(LOAD_TEMP.WAY), "way_id"),
  ];
  return createTemp(
    REVERT_TEMP.INSERTS,
    [
      "SELECT (row_number() OVER (ORDER BY y.part, y.g))::bigint AS n,",
      `${formatOf("DELETE FROM %s WHERE %s IN (%s);", ["y.tbl", "y.idcol", "y.ids"])} AS line`,
      `FROM (${branches.join(" UNION ALL ")}) AS y`,
    ].join(" ")
  );
}

export const buildRevertCountSql = (name: string): string => `SELECT count(*) AS "total" FROM ${tmp(name)}`;

export function buildRevertPageSql(name: string, pageSize: number, afterCursor: boolean): string {
  return [
    `SELECT n::text AS ${q(REVERT_COLUMNS.CURSOR)}, line AS ${q(REVERT_COLUMNS.LINE)} FROM ${tmp(name)}`,
    afterCursor ? "WHERE n > $1::bigint" : "",
    `ORDER BY n LIMIT ${pageSize}`,
  ]
    .filter((part) => part !== "")
    .join(" ");
}
