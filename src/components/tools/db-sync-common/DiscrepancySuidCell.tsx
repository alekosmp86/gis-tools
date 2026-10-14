import React from "react";
import {
  PairingMethod,
  type DiscrepancyItem,
  type ComparisonSourceDescriptor,
  type ItemPairing,
} from "@/core/types/comparison";
import styles from "./DiscrepancySuidCell.module.css";

export interface DiscrepancySuidCellProps {
  item: DiscrepancyItem;
  descriptor: ComparisonSourceDescriptor;
  rowSpan?: number;
}

const PAIRING_LABELS: Record<PairingMethod, string> = {
  [PairingMethod.EXACT]: "Emparejado por coincidencia",
  [PairingMethod.GEOMETRY]: "Emparejado por geometría",
  [PairingMethod.ELIMINATION]: "Emparejado por eliminación",
  [PairingMethod.SKIPPED_CAP]: "Grupo demasiado grande para emparejar",
  [PairingMethod.NO_GEOMETRY]: "No se puede emparejar sin geometría",
};

function describePairing(pairing: ItemPairing): string {
  const label = PAIRING_LABELS[pairing.method];
  if (pairing.method === PairingMethod.GEOMETRY && pairing.distance !== undefined) {
    return `${label} (distancia ${Number(pairing.distance.toFixed(6))})`;
  }
  return label;
}

function isAmbiguousPairing(pairing: ItemPairing): boolean {
  return (
    pairing.method === PairingMethod.SKIPPED_CAP || pairing.method === PairingMethod.NO_GEOMETRY
  );
}

export const DiscrepancySuidCell: React.FC<DiscrepancySuidCellProps> = ({
  item,
  descriptor,
  rowSpan,
}) => {
  return (
    <td rowSpan={rowSpan} className={styles.suidCell} title={item.suid}>
      <span className={styles.suidText}>{item.suid}</span>
      {item.duplicateDetails ? (
        <div className={styles.noteText}>
          SUID Duplicado ({item.duplicateDetails.targetCount} en {descriptor.targetShortLabel} / {item.duplicateDetails.sourceCount} en {descriptor.sourceShortLabel})
        </div>
      ) : item.note ? (
        <div className={styles.noteText}>{item.note}</div>
      ) : null}
      {item.pairing && !(item.note && !item.duplicateDetails && isAmbiguousPairing(item.pairing)) ? (
        <div className={styles.noteText}>{describePairing(item.pairing)}</div>
      ) : null}
    </td>
  );
};
