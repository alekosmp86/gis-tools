import { useEffect, useState } from "react";
import type {
  ColumnMappingConfig,
  ComparisonSummary,
  DiscrepancyItem,
  SqlPatchSummary,
} from "@/core/types/comparison";
import { DiscrepancyType } from "@/core/types/comparison";
import type { DbConfig } from "@/core/types/db";
import type { ParsedFileDataset } from "@/core/types/parsers";
import type { ParsedShapefileData } from "@/core/types/shp";
import type { SelectionIdSet } from "@/core/types/selection";
import {
  countSelectedPatches,
  selectActionableItems,
} from "@/core/workers/comparison/DiscrepancySelection";
import { generateSqlPatchesInWorker, serializeFileDataset } from "@/core/services/workerBridge";

const PREVIEW_ITEMS_PER_KIND = 25;
const PREVIEW_DEBOUNCE_MS = 150;

export interface UseSelectionSqlPatchesParams {
  summary: ComparisonSummary;
  selectedIds: SelectionIdSet;
  fileDataset: ParsedShapefileData | ParsedFileDataset;
  mappingConfig: ColumnMappingConfig;
  dbConfig: DbConfig;
}

interface PreviewState {
  sqlUpdatePreview: string;
  sqlInsertPreview: string;
}

const EMPTY_PREVIEW: PreviewState = { sqlUpdatePreview: "", sqlInsertPreview: "" };

function takePreviewItems(actionableItems: readonly DiscrepancyItem[]): DiscrepancyItem[] {
  const updates: DiscrepancyItem[] = [];
  const inserts: DiscrepancyItem[] = [];
  for (const item of actionableItems) {
    const bucket = item.type === DiscrepancyType.ONLY_IN_SHP ? inserts : updates;
    if (bucket.length < PREVIEW_ITEMS_PER_KIND) bucket.push(item);
    if (updates.length >= PREVIEW_ITEMS_PER_KIND && inserts.length >= PREVIEW_ITEMS_PER_KIND) break;
  }
  return updates.concat(inserts);
}

function generateForItems(
  params: UseSelectionSqlPatchesParams,
  items: DiscrepancyItem[]
): Promise<SqlPatchSummary> {
  const { summary, fileDataset, mappingConfig, dbConfig } = params;
  const serializedDataset = serializeFileDataset(
    "recordsMap" in fileDataset ? fileDataset : { ...fileDataset, recordsMap: new Map() }
  );
  return generateSqlPatchesInWorker({
    discrepancyItems: items,
    fileDataset: serializedDataset,
    mappingConfig: {
      ...mappingConfig,
      targetSrid: summary.targetSrid ?? mappingConfig.targetSrid,
    },
    dbSchemaName: dbConfig.schema_name,
    dbTableName: dbConfig.table_name,
    dbColumnTypes: summary.dbColumnTypes,
  });
}

export function useSelectionSqlPatches(params: UseSelectionSqlPatchesParams) {
  const { summary, selectedIds, fileDataset, mappingConfig, dbConfig } = params;
  const primaryKeyColumn = mappingConfig.primaryKeyColumn;
  const [generated, setGenerated] = useState<{
    forSelection: SelectionIdSet;
    forSummary: ComparisonSummary;
    preview: PreviewState;
  } | null>(null);

  const actionableItems = selectActionableItems(summary.items, selectedIds, primaryKeyColumn);
  const counts = countSelectedPatches(actionableItems);
  const hasSelection = actionableItems.length > 0;

  useEffect(() => {
    if (selectedIds.size === 0) return;
    const items = takePreviewItems(
      selectActionableItems(summary.items, selectedIds, primaryKeyColumn)
    );
    if (items.length === 0) return;

    let cancelled = false;
    const timer = setTimeout(() => {
      generateForItems({ summary, selectedIds, fileDataset, mappingConfig, dbConfig }, items)
        .then((result) => {
          if (cancelled) return;
          setGenerated({
            forSelection: selectedIds,
            forSummary: summary,
            preview: {
              sqlUpdatePreview: result.sqlUpdatePreview,
              sqlInsertPreview: result.sqlInsertPreview,
            },
          });
        })
        .catch(() => {
          if (!cancelled) setGenerated(null);
        });
    }, PREVIEW_DEBOUNCE_MS);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [summary, selectedIds, fileDataset, mappingConfig, dbConfig, primaryKeyColumn]);

  const isPreviewCurrent =
    generated !== null &&
    generated.forSelection === selectedIds &&
    generated.forSummary === summary;
  const preview = hasSelection && isPreviewCurrent ? generated.preview : EMPTY_PREVIEW;

  const generateFullScript = () => generateForItems(params, actionableItems);

  return {
    selectedCount: actionableItems.length,
    sqlUpdateCount: counts.updates,
    sqlInsertCount: counts.inserts,
    sqlUpdatePreview: preview.sqlUpdatePreview,
    sqlInsertPreview: preview.sqlInsertPreview,
    generateFullScript,
  };
}
