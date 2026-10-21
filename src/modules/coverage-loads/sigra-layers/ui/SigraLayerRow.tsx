"use client";

import React from "react";
import { formatNumber } from "@/core/common/ValueFormatter";
import type { SigraLayerId } from "../constants";
import { getSigraLayer } from "../domain/layerRegistry";
import type { PlanLayer } from "../types";
import shared from "./SigraShared.module.css";
import styles from "./SigraLayerTable.module.css";

interface SigraLayerRowProps {
  layer: PlanLayer;
  isSelected: boolean;
  isLocked: boolean;
  onToggle: (layerId: SigraLayerId) => void;
}

const PLACEHOLDER = "—";
const REQUIRED_LABEL = "Obligatoria";

export const SigraLayerRow: React.FC<SigraLayerRowProps> = ({ layer, isSelected, isLocked, onToggle }) => (
  <tr>
    <td>
      <div className={styles.layerCell}>
        <label className={styles.choice}>
          <input
            type="checkbox"
            checked={isSelected}
            disabled={layer.required || isLocked}
            onChange={() => onToggle(layer.layerId)}
          />
          {layer.label}
          <span className={shared.tableName}>{getSigraLayer(layer.layerId).finalTable}</span>
          {layer.required && <span className={styles.requiredMark}>{REQUIRED_LABEL}</span>}
        </label>
        {layer.blockers.length > 0 && (
          <div className={styles.blockers}>
            {layer.blockers.map((blocker) => (
              <span key={blocker}>{blocker}</span>
            ))}
          </div>
        )}
      </div>
    </td>
    <td className={shared.numeric}>{formatNumber(layer.rowCount, PLACEHOLDER)}</td>
    <td>{layer.lastUpdated ?? PLACEHOLDER}</td>
    <td className={shared.numeric}>{formatNumber(layer.wfsCount, PLACEHOLDER)}</td>
  </tr>
);
