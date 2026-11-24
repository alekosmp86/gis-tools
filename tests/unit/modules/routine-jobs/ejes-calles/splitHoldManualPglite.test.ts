import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { EJES_SKIP_REASON } from "@/modules/routine-jobs/jobs/ejes-calles/constants";
import { splitGroupsSql } from "@/modules/routine-jobs/jobs/ejes-calles/domain/splitHoldSql";

const SETUP_TIMEOUT_MS = 60_000;

interface Piece {
  oldId: number;
  newRef: string;
  manual: boolean;
}

/** One split row per (old section, piece): the old section has one row, one point, one copy of its piece and no merge. */
const splitTablesSql = (pieces: Piece[], mergedRefs: string[] = []): string => {
  const rows = pieces
    .map((piece) => `(${piece.oldId}, '${piece.oldId}', '30', 1::bigint, 0::bigint, 1::bigint, '${piece.newRef}', false, ${piece.manual})`)
    .join(", ");
  const merged = mergedRefs.map((ref) => `('${ref}')`).join(", ");
  return `
    CREATE TEMP TABLE t_pieces (old_id int, old_ref text, idcalle text, points bigint, id_points bigint, old_rows bigint, new_ref text, geom_variant boolean, manual boolean);
    CREATE TEMP TABLE t_merges (new_ref text);
    CREATE TEMP TABLE t_copy_refs (ref text, copies bigint);
    ${rows.length > 0 ? `INSERT INTO t_pieces VALUES ${rows};` : ""}
    ${merged.length > 0 ? `INSERT INTO t_merges VALUES ${merged};` : ""}
    INSERT INTO t_copy_refs SELECT DISTINCT new_ref, 1 FROM t_pieces;
  `;
};

describe("split holds of manual choices on PGlite (EJS-8, EJS-22)", () => {
  let database: PGlite;

  beforeAll(async () => {
    database = new PGlite();
    await database.waitReady;
  }, SETUP_TIMEOUT_MS);

  afterAll(async () => {
    await database.close();
  });

  /** Runs the hold SQL over the pieces the test just created, and returns the reason of each old section (null when it is not held). */
  const holdsOf = async (pieces: Piece[], mergedRefs: string[] = []): Promise<Array<[number, string | null]>> => {
    await database.exec("DROP TABLE IF EXISTS t_pieces; DROP TABLE IF EXISTS t_merges; DROP TABLE IF EXISTS t_copy_refs;");
    await database.exec(splitTablesSql(pieces, mergedRefs));
    const result = await database.query<{ old_id: number; hold_reason: string | null }>(
      splitGroupsSql("t_pieces", "t_merges", "t_copy_refs") + " ORDER BY old_id"
    );
    return result.rows.map((row) => [Number(row.old_id), row.hold_reason]);
  };

  it("should not hold two manual splits that share one piece, since both are a manual choice", async () => {
    const holds = await holdsOf([
      { oldId: 1, newRef: "9", manual: true },
      { oldId: 2, newRef: "9", manual: true },
    ]);

    expect(holds).toEqual([
      [1, null],
      [2, null],
    ]);
  });

  it("should hold both splits when a manual split and an automatic split share one piece", async () => {
    const holds = await holdsOf([
      { oldId: 1, newRef: "9", manual: true },
      { oldId: 2, newRef: "9", manual: false },
    ]);

    expect(holds).toEqual([
      [1, EJES_SKIP_REASON.SHARED_PIECE],
      [2, EJES_SKIP_REASON.SHARED_PIECE],
    ]);
  });

  it("should hold both splits when two automatic splits share one piece", async () => {
    const holds = await holdsOf([
      { oldId: 1, newRef: "9", manual: false },
      { oldId: 2, newRef: "9", manual: false },
    ]);

    expect(holds).toEqual([
      [1, EJES_SKIP_REASON.SHARED_PIECE],
      [2, EJES_SKIP_REASON.SHARED_PIECE],
    ]);
  });

  it("should hold a manual split whose piece is also a merge member, even though the choice is manual", async () => {
    const holds = await holdsOf([{ oldId: 1, newRef: "9", manual: true }], ["9"]);

    expect(holds).toEqual([[1, EJES_SKIP_REASON.SHARED_PIECE]]);
  });

  it("should not hold a manual split whose piece no other split uses", async () => {
    const holds = await holdsOf([{ oldId: 1, newRef: "9", manual: true }]);

    expect(holds).toEqual([[1, null]]);
  });
});
