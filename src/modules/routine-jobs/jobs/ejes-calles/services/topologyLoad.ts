import type { RunSession } from "../../cargar-padrones/types";
import { throwIfIssues } from "../../shared/preflightAsserts";
import { numberOf } from "../../shared/rowMapping";
import { plural } from "../../shared/text";
import {
  buildCreatedVerticesSql,
  buildCreateTopologySql,
  buildDeleteUnusedVerticesSql,
  buildTopologyCheckSql,
  buildTopologyCountSql,
  buildTopologyIdsSql,
  buildUnusedCandidatesSql,
  buildVertexCandidatesSql,
  buildVertexTotalsSql,
} from "../domain/topologySql";
import type { EjesLoadContext } from "../types";
import { assertWritten, writtenBy } from "./writeStatements";

export interface TopologyCounts {
  topologyAssigned: number;
  verticesCreated: number;
  verticesDeleted: number;
}

interface VertexTotals {
  total: number;
  maxId: number;
}

/** pgRouting returns OK, or FAIL after catching an error: the text is read, not only the section check that follows. */
const PGR_TOPOLOGY_OK = "OK";

async function runTopology(session: RunSession, context: EjesLoadContext): Promise<void> {
  const result = String((await session.query(buildCreateTopologySql(context))).rows[0]?.topology ?? "");
  if (result !== PGR_TOPOLOGY_OK) {
    throwIfIssues([
      `pgr_createTopology no completó la topología (respuesta: "${result}"). Revise el log del servidor (NOTICE) para ver la causa: se revierte la carga.`,
    ]);
  }
}

/** Before the writes: the sections the topology step sets and the vertices it may delete, both known inside the transaction. */
export async function createTopologyInputs(session: RunSession, context: EjesLoadContext): Promise<void> {
  await session.query(buildTopologyIdsSql());
  await session.query(buildVertexCandidatesSql(context));
}

async function readTotals(session: RunSession, context: EjesLoadContext): Promise<VertexTotals> {
  const row = (await session.query(buildVertexTotalsSql(context))).rows[0] ?? {};
  return { total: numberOf(row.total), maxId: numberOf(row.max_id) };
}

async function assertAssigned(session: RunSession, context: EjesLoadContext): Promise<number> {
  const row = (await session.query(buildTopologyCheckSql(context))).rows[0] ?? {};
  const missing = numberOf(row.missing);
  if (missing > 0) {
    throwIfIssues([
      `${plural(missing, "tramo quedó", "tramos quedaron")} sin origen o destino después de pgr_createTopology: se revierte la carga.`,
    ]);
  }
  return numberOf(row.assigned);
}

/** Deletes the candidates no section uses; the count is the one the same predicate gives just before the delete. */
async function cleanVertices(session: RunSession, context: EjesLoadContext): Promise<number> {
  const expected = numberOf((await session.query(buildUnusedCandidatesSql(context))).rows[0]?.expected);
  const deleted = await writtenBy(session, buildDeleteUnusedVerticesSql(context));
  assertWritten("los vértices sin uso", deleted, expected);
  return deleted;
}

/** After the section writes and the removals: sets the topology of the touched sections, then deletes the vertices this load left unused. */
export async function writeTopology(session: RunSession, context: EjesLoadContext): Promise<TopologyCounts> {
  const before = await readTotals(session, context);
  const topologySections = numberOf((await session.query(buildTopologyCountSql())).rows[0]?.count);
  if (topologySections > 0) await runTopology(session, context);
  const topologyAssigned = await assertAssigned(session, context);
  const verticesDeleted = await cleanVertices(session, context);
  const verticesCreated = numberOf((await session.query(buildCreatedVerticesSql(context, before.maxId))).rows[0]?.created);
  const after = await readTotals(session, context);
  if (after.total !== before.total + verticesCreated - verticesDeleted) {
    throwIfIssues([
      `Los vértices no cuadran: ${before.total} antes, ${after.total} después, ${verticesCreated} creados y ${verticesDeleted} borrados.`,
    ]);
  }
  return { topologyAssigned, verticesCreated, verticesDeleted };
}
