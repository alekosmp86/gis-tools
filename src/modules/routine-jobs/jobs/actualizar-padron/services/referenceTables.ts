import type { RunSession } from "../../cargar-padrones/types";
import { referenceTablesProbeSql, type ReferenceTableFlags } from "../domain/replacementSql";

const FLAG_ALIAS = { ACCESS_POINT: "accessPoint", ADDRESSES: "addresses" } as const;

/** Reads which reference tables the carto schema can offer; the probe reads the catalog only and cannot fail the analysis. */
export async function readReferenceTables(session: RunSession, schema: string): Promise<ReferenceTableFlags> {
  const result = await session.query(referenceTablesProbeSql(schema));
  const row = result.rows[0] ?? {};
  return {
    accessPoint: row[FLAG_ALIAS.ACCESS_POINT] === true,
    addresses: row[FLAG_ALIAS.ADDRESSES] === true,
  };
}
