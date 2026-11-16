import { buildQualifiedTableLabel, resolveSchemaName } from "@/core/services/sqlStatements";
import type { CatalogQuerySession } from "@/core/services/server/tableCatalog/tableCatalog";
import { assertSourceTablesReady, throwIfIssues } from "../../shared/preflightAsserts";
import {
  READ_PRIVILEGES,
  sequenceIssuesOf,
  tableAnyPrivilegeIssues,
  tablePrivilegeIssues,
  targetStructureIssuesOf,
} from "../../shared/targetPreflight";
import {
  ADDRESS_MASTER_COLUMN,
  CIRCULATION_WAY_COLUMN,
  EJES_LOAD_ROLES,
  EJES_READ_ROLES,
  EJES_TABLE_ROLE,
  ROAD_SECTION_COLUMN,
  EJES_STAGING_COLUMN,
  VERTICES_COLUMN,
} from "../constants";
import { LEADING_INDEX_SQL, PGR_SUPPORT_SQL, PGR_VERSION_SQL, topologyIndexesOf, topologyNameIssuesOf } from "../domain/topologySql";
import type { EjesLayouts, EjesLoadContext, EjesLoadRole, EjesResolvedLayouts } from "../types";

const EJES_WRITE_PRIVILEGES: readonly string[] = ["SELECT", "INSERT", "UPDATE", "DELETE"];

/** LOCK ... IN SHARE ROW EXCLUSIVE MODE needs one of these on each locked table. */
const LOCK_PRIVILEGES: readonly string[] = ["UPDATE", "DELETE", "TRUNCATE"];

const OWNER_SQL =
  "SELECT pg_has_role(current_user, c.relowner, 'MEMBER') AS is_owner FROM pg_class AS c JOIN pg_namespace AS n ON n.oid = c.relnamespace WHERE n.nspname = $1::text AND c.relname = $2::text";

export async function assertEjesReadable(session: CatalogQuerySession, layouts: EjesLayouts): Promise<void> {
  const issues: string[] = [];
  for (const role of EJES_READ_ROLES) {
    // One pg client: privilege checks are awaited in turn, so they never overlap.
    // react-doctor-disable-next-line react-doctor/async-await-in-loop
    issues.push(...(await tablePrivilegeIssues(session, layouts[role], READ_PRIVILEGES)));
  }
  throwIfIssues(issues);
}

export async function assertEjesStagingReady(session: CatalogQuerySession, layouts: EjesLayouts): Promise<void> {
  const staging = layouts[EJES_TABLE_ROLE.STAGING];
  await assertSourceTablesReady(session, {
    withRows: [{ layout: staging, description: "ejes de vía de circulación" }],
    geometry: { layout: staging, column: EJES_STAGING_COLUMN.GEOM },
  });
}

export async function ejesWritePrivilegeInfo(session: CatalogQuerySession, resolved: EjesResolvedLayouts): Promise<string[]> {
  const info: string[] = [];
  for (const target of resolved.writeTargets) {
    // react-doctor-disable-next-line react-doctor/async-await-in-loop
    info.push(...(await tablePrivilegeIssues(session, target, EJES_WRITE_PRIVILEGES)));
    // react-doctor-disable-next-line react-doctor/async-await-in-loop
    info.push(...(await sequenceIssuesOf(session, target, false)));
  }
  return info;
}

const LOAD_PRIVILEGES: Record<EjesLoadRole, readonly string[]> = {
  [EJES_TABLE_ROLE.ROAD_SECTION]: ["SELECT", "INSERT", "UPDATE", "DELETE"],
  [EJES_TABLE_ROLE.CIRCULATION_WAY]: ["SELECT", "INSERT"],
  [EJES_TABLE_ROLE.ADDRESS_MASTER]: ["SELECT", "INSERT", "DELETE"],
  [EJES_TABLE_ROLE.ACCESS_POINT]: ["SELECT", "UPDATE"],
  [EJES_TABLE_ROLE.VERTICES]: ["SELECT", "INSERT", "UPDATE", "DELETE"],
};

const PGR_MISSING_MESSAGE = "pgRouting no está instalado en la base: la carga necesita pgr_createTopology para actualizar la topología.";
const pgrVersionMessage = (version: string): string =>
  `La versión de pgRouting ${version} no tiene pgr_createTopology con la firma que usa la carga: la carga necesita esa función para la topología.`;

const INSERTED_COLUMNS: Partial<Record<EjesLoadRole, readonly string[]>> = {
  [EJES_TABLE_ROLE.ROAD_SECTION]: [
    ROAD_SECTION_COLUMN.ID,
    ROAD_SECTION_COLUMN.REFTRAMO,
    ROAD_SECTION_COLUMN.CIRCULATION_WAY,
    ROAD_SECTION_COLUMN.TYPE,
    ROAD_SECTION_COLUMN.FONT,
    ROAD_SECTION_COLUMN.ADDRESS_MASTER,
    ROAD_SECTION_COLUMN.DISTANCE,
    ROAD_SECTION_COLUMN.GEOMETRY,
  ],
  [EJES_TABLE_ROLE.CIRCULATION_WAY]: Object.values(CIRCULATION_WAY_COLUMN),
  [EJES_TABLE_ROLE.ADDRESS_MASTER]: Object.values(ADDRESS_MASTER_COLUMN),
  [EJES_TABLE_ROLE.VERTICES]: Object.values(VERTICES_COLUMN),
};

const TITLE_BY_ROLE: Record<EjesLoadRole, string> = {
  [EJES_TABLE_ROLE.ROAD_SECTION]: "La tabla de tramos de calle",
  [EJES_TABLE_ROLE.CIRCULATION_WAY]: "La tabla de vías de circulación",
  [EJES_TABLE_ROLE.ADDRESS_MASTER]: "La tabla de direcciones maestras",
  [EJES_TABLE_ROLE.ACCESS_POINT]: "La tabla de puntos de acceso",
  [EJES_TABLE_ROLE.VERTICES]: "La tabla de vértices de ruteo",
};

const PGR_PRIVILEGE_MESSAGE = "No tiene privilegio EXECUTE sobre pgr_createTopology: la carga necesita ejecutarla.";

/** The indexes pgRouting would otherwise create on the tables it reads: missing ones are listed by name. */
async function topologyIndexIssuesOf(session: CatalogQuerySession, context: EjesLoadContext): Promise<string[]> {
  const { tables, required } = topologyIndexesOf(context);
  const rows = (await session.query(LEADING_INDEX_SQL, [tables])).rows;
  const present = new Set(rows.map((row) => `${String(row.qualified)}|${String(row.column_name)}|${String(row.method)}`));
  const missing = required.filter((entry) => !present.has(entry.key)).map((entry) => entry.label);
  if (missing.length === 0) return [];
  return [
    `Faltan índices que pgr_createTopology necesita: ${missing.join(", ")}. Si faltan, pgRouting los crea en la tabla y la carga no los revierte: créelos antes de cargar.`,
  ];
}

/** The topology step needs pgRouting with pgr_createTopology, EXECUTE on it and its indexes: a blocker in a real run, information in a dry run. */
export async function topologyIssuesOf(session: CatalogQuerySession, context: EjesLoadContext): Promise<string[]> {
  const names = topologyNameIssuesOf(context);
  const support = (await session.query(PGR_SUPPORT_SQL)).rows[0] ?? {};
  if (!Boolean(support.installed)) return [...names, PGR_MISSING_MESSAGE];
  const version = String((await session.query(PGR_VERSION_SQL)).rows[0]?.version ?? "desconocida");
  if (!Boolean(support.has_topology)) return [...names, pgrVersionMessage(version)];
  const privilege = Boolean(support.can_execute) ? [] : [PGR_PRIVILEGE_MESSAGE];
  return [...names, ...privilege, ...(await topologyIndexIssuesOf(session, context))];
}

async function analyzeOwnershipWarning(session: CatalogQuerySession, schema: string, table: string): Promise<string[]> {
  const result = await session.query(OWNER_SQL, [resolveSchemaName(schema), table]);
  if (result.rows[0]?.is_owner !== false) return [];
  const label = buildQualifiedTableLabel(schema, table);
  return [`ANALYZE de ${label} se omitiría: el usuario no es propietario de la tabla. Es solo una advertencia y la carga continúa.`];
}

/** ANALYZE by a non-owner is skipped with a warning by the server: reported here, never a blocker. */
export async function ejesAnalyzeWarnings(session: CatalogQuerySession, context: EjesLoadContext): Promise<string[]> {
  const warnings: string[] = [];
  for (const role of EJES_LOAD_ROLES) {
    const target = context.targets[role];
    // One pg client: ownership checks are awaited in turn, so they never overlap.
    // react-doctor-disable-next-line react-doctor/async-await-in-loop
    warnings.push(...(await analyzeOwnershipWarning(session, target.schema, target.table)));
  }
  return warnings;
}

/** A real run writes only what slice 1 needs: any missing privilege, sequence or NOT NULL column is a blocker, not information. */
export async function assertEjesLoadReady(session: CatalogQuerySession, context: EjesLoadContext): Promise<string[]> {
  const issues: string[] = [];
  for (const role of EJES_LOAD_ROLES) {
    const target = context.targets[role];
    // One pg client: checks are awaited in turn, so they never overlap.
    // react-doctor-disable-next-line react-doctor/async-await-in-loop
    issues.push(...(await tablePrivilegeIssues(session, target, LOAD_PRIVILEGES[role])));
    // react-doctor-disable-next-line react-doctor/async-await-in-loop
    issues.push(...(await tableAnyPrivilegeIssues(session, target, LOCK_PRIVILEGES, "para bloquear la tabla en la carga")));
    const inserted = INSERTED_COLUMNS[role];
    if (inserted === undefined) continue;
    // react-doctor-disable-next-line react-doctor/async-await-in-loop
    issues.push(...(await sequenceIssuesOf(session, target, true)));
    // react-doctor-disable-next-line react-doctor/async-await-in-loop
    issues.push(...(await targetStructureIssuesOf(session, target, inserted, TITLE_BY_ROLE[role])));
  }
  issues.push(...(await topologyIssuesOf(session, context)));
  throwIfIssues(issues);
  return ejesAnalyzeWarnings(session, context);
}
