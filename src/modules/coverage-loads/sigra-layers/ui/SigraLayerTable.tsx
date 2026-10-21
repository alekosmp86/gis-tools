"use client";

import React from "react";
import type { SigraLayerId } from "../constants";
import { LAYER_GROUPS } from "../domain/layerGroups";
import type { PlanLayer, SigraPlan } from "../types";
import { SigraLayerGroup } from "./SigraLayerGroup";
import styles from "./SigraLayerTable.module.css";

interface SigraLayerTableProps {
  plan: SigraPlan;
  selection: ReadonlyArray<SigraLayerId>;
  disabled: boolean;
  onToggle: (layerId: SigraLayerId) => void;
}

function layersOfGroup(plan: SigraPlan, layerIds: ReadonlyArray<SigraLayerId>): PlanLayer[] {
  return layerIds.flatMap((layerId) => plan.layers.filter((layer) => layer.layerId === layerId));
}

/** The layers of the plan by group, each with its selection checkbox; a required layer cannot be unchecked. */
export const SigraLayerTable: React.FC<SigraLayerTableProps> = ({ plan, selection, disabled, onToggle }) => (
  <div className={styles.groups}>
    {LAYER_GROUPS.map((group) => {
      const layers = layersOfGroup(plan, group.layerIds);
      return layers.length === 0 ? null : (
        <SigraLayerGroup
          key={group.id}
          group={group}
          layers={layers}
          selection={selection}
          isLocked={disabled}
          onToggle={onToggle}
        />
      );
    })}
  </div>
);
