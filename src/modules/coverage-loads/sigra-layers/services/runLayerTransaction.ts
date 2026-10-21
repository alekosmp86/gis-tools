import type { PgClientLike } from "../../shared/pgClient";
import { evaluateLoad } from "../domain/validation";
import {
  LayerLoadStep,
  type LayerColumns,
  type LoadProgress,
  type PageSource,
  type PageWriter,
  type SigraLayerDefinition,
  type WfsFeature,
} from "../types";
import { inStep, LoadStepError, ValidationRejectedError } from "./loadErrors";
import { countFinalRows, createStaging, swapFinalTable } from "./queries/runLoadQueries";
import { readLayerPages } from "./readLayerPages";

export interface LayerRun {
  readonly layer: SigraLayerDefinition;
  readonly columns: LayerColumns;
  readonly dryRun: boolean;
  readonly source: PageSource;
  readonly progress: LoadProgress;
}

const STAGED_MISMATCH = "Las filas insertadas en la tabla final no coinciden con las descargadas";

const REPEATED_PAGE = "El WFS devolvió registros repetidos: se aborta la descarga.";

/** A full page with no new row means the server ignores the paging; a short one is simply the end of the data. */
function isRepeatedPage(page: ReadonlyArray<WfsFeature>, inserted: number, pageSize: number): boolean {
  return page.length >= pageSize && inserted === 0;
}

async function stagePages(
  pages: AsyncGenerator<ReadonlyArray<WfsFeature>>,
  writePage: PageWriter,
  progress: LoadProgress,
  pageSize: number,
): Promise<void> {
  for (;;) {
    const next = await inStep(LayerLoadStep.WFS, () => pages.next());
    if (next.done) return;
    progress.downloaded += next.value.length;
    const inserted = await inStep(LayerLoadStep.INSERT, () => writePage(next.value));
    progress.staged += inserted;
    if (isRepeatedPage(next.value, inserted, pageSize)) {
      throw new LoadStepError(LayerLoadStep.WFS, new Error(REPEATED_PAGE));
    }
  }
}

async function validate(client: PgClientLike, run: LayerRun): Promise<void> {
  run.progress.previousCount = await inStep(LayerLoadStep.VALIDATION, () => countFinalRows(client, run.layer));
  const verdict = evaluateLoad({ stagedCount: run.progress.staged, finalCount: run.progress.previousCount });
  if (!verdict.ok) throw new ValidationRejectedError(verdict.message);
}

async function swap(client: PgClientLike, run: LayerRun): Promise<void> {
  const inserted = await inStep(LayerLoadStep.SWAP, async () => {
    const rows = await swapFinalTable(client, run.layer, run.columns);
    if (rows !== run.progress.staged) {
      throw new Error(`${STAGED_MISMATCH}: ${rows} de ${run.progress.staged}.`);
    }
    return rows;
  });
  run.progress.finalCount = inserted;
}

/** Everything that happens between BEGIN and COMMIT/ROLLBACK of one layer. The caller ends the transaction. */
export async function loadInsideTransaction(client: PgClientLike, run: LayerRun): Promise<void> {
  const writePage = await inStep(LayerLoadStep.INSERT, () => createStaging(client, run.layer, run.columns));
  await stagePages(readLayerPages(run.layer, run.source), writePage, run.progress, run.layer.pageSize);
  await validate(client, run);
  if (!run.dryRun) await swap(client, run);
}
