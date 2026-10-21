"use client";

import React from "react";
import { AlertTriangle } from "lucide-react";
import { formatNumber } from "@/core/common/ValueFormatter";
import { getSigraLayer } from "../domain/layerRegistry";
import { describeLayerStep } from "../domain/statusLabels";
import { LayerLoadStatus, type LayerLoadResult } from "../types";
import { SigraStatusBadge } from "./SigraStatusBadge";
import shared from "./SigraShared.module.css";
import styles from "./SigraResultTable.module.css";

interface SigraResultRowProps {
  result: LayerLoadResult;
  dryRun: boolean;
}

const PLACEHOLDER = "—";

function computeDelta(result: LayerLoadResult, dryRun: boolean): number | null {
  const after = dryRun ? result.staged : result.finalCount;
  if (result.previousCount === null || after === null || after === undefined) return null;
  return after - result.previousCount;
}

function deltaClass(delta: number | null): string | undefined {
  if (delta === null || delta === 0) return undefined;
  return delta > 0 ? styles.positive : styles.negative;
}

function formatDelta(delta: number | null): string {
  if (delta === null) return PLACEHOLDER;
  return delta > 0 ? `+${formatNumber(delta)}` : formatNumber(delta);
}

function hasProblem(result: LayerLoadResult): boolean {
  return result.status === LayerLoadStatus.FAILED || result.status === LayerLoadStatus.REJECTED_VALIDATION;
}

export const SigraResultRow: React.FC<SigraResultRowProps> = ({ result, dryRun }) => {
  const delta = computeDelta(result, dryRun);
  return (
  <tr>
    <th scope="row">
      {getSigraLayer(result.layerId).label}
      <span className={shared.tableName}>{getSigraLayer(result.layerId).finalTable}</span>
    </th>
    <td>
      <SigraStatusBadge status={result.status} />
    </td>
    <td className={shared.numeric}>{formatNumber(result.downloaded)}</td>
    <td className={shared.numeric}>{formatNumber(result.staged)}</td>
    <td className={shared.numeric}>{formatNumber(result.duplicatesIgnored)}</td>
    <td className={shared.numeric}>{formatNumber(result.previousCount, PLACEHOLDER)}</td>
    <td className={shared.numeric}>{formatNumber(result.finalCount, PLACEHOLDER)}</td>
    <td className={`${shared.numeric} ${deltaClass(delta) ?? ""}`}>{formatDelta(delta)}</td>
    <td>
      <div className={styles.detail}>
        {hasProblem(result) && (
          <span>
            <strong>{describeLayerStep(result.step)}</strong>: {result.message}
          </span>
        )}
        {result.auditWarning !== null && (
          <span className={styles.auditWarning}>
            <AlertTriangle size={14} />
            {result.auditWarning}
          </span>
        )}
      </div>
    </td>
  </tr>
  );
};
