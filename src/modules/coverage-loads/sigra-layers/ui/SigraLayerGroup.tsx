"use client";

import React from "react";
import type { SigraLayerId } from "../constants";
import type { LayerGroup } from "../domain/layerGroups";
import type { PlanLayer } from "../types";
import { SigraLayerRow } from "./SigraLayerRow";
import shared from "./SigraShared.module.css";
import styles from "./SigraLayerTable.module.css";

interface SigraLayerGroupProps {
  group: LayerGroup;
  layers: ReadonlyArray<PlanLayer>;
  selection: ReadonlyArray<SigraLayerId>;
  isLocked: boolean;
  onToggle: (layerId: SigraLayerId) => void;
}

export const SigraLayerGroup: React.FC<SigraLayerGroupProps> = ({ group, layers, selection, isLocked, onToggle }) => {
  const selected = new Set(selection);

  return (
    <section>
      <h3 className={styles.groupTitle}>{group.label}</h3>
      <table className={shared.table}>
        <thead>
          <tr>
            <th scope="col">Capa</th>
            <th scope="col" className={shared.numeric}>Registros actuales</th>
            <th scope="col">Última actualización</th>
            <th scope="col" className={shared.numeric}>Registros en SIGRA</th>
          </tr>
        </thead>
        <tbody>
          {layers.map((layer) => (
            <SigraLayerRow
              key={layer.layerId}
              layer={layer}
              isSelected={selected.has(layer.layerId)}
              isLocked={isLocked}
              onToggle={onToggle}
            />
          ))}
        </tbody>
      </table>
    </section>
  );
};
