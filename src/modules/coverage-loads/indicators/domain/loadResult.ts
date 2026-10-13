import type { LoadedCut, LoadResult, ParsedCut } from "../types";

/** Joins what the transaction wrote with the rows that were rejected, in upload order. */
export function buildLoadResult(cuts: ReadonlyArray<ParsedCut>, loadedCuts: ReadonlyArray<LoadedCut>): LoadResult {
  return {
    cuts: loadedCuts,
    totalInserted: loadedCuts.reduce((total, loaded) => total + loaded.insertedRows, 0),
    totalReplaced: loadedCuts.reduce((total, loaded) => total + loaded.replacedRows, 0),
    hasIncompleteCut: loadedCuts.some((loaded) => loaded.incomplete),
    rejectedRows: cuts.flatMap((cut) => cut.rejected),
  };
}
