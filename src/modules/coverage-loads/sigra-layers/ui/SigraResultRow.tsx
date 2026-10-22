"use client";

import React from "react";
import { AlertTriangle } from "lucide-react";
import { formatNumber } from "@/core/common/ValueFormatter";
import { getSigraLayer } from "../domain/layerRegistry";
import { describeLayerStep } from "../domain/statusLabels";
import type { LayerLoadResult } from "../types";
import { DELTA_PLACEHOLDER, deltaClassName, formatDelta, hasProblem, resultDelta } from "./delta";
import { SigraStatusBadge } from "./SigraStatusBadge";
import shared from "./SigraShared.module.css";
import styles from "./SigraResultTable.module.css";

interface SigraResultRowProps {
  result: LayerLoadResult;
  dryRun: boolean;
}

export const SigraResultRow: React.FC<SigraResultRowProps> = ({ result, dryRun }) => {
  const delta = resultDelta(result, dryRun);
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
      <td className={shared.numeric}>{formatNumber(result.previousCount, DELTA_PLACEHOLDER)}</td>
      <td className={shared.numeric}>{formatNumber(result.finalCount, DELTA_PLACEHOLDER)}</td>
      <td className={`${shared.numeric} ${deltaClassName(delta)}`}>{formatDelta(delta)}</td>
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
