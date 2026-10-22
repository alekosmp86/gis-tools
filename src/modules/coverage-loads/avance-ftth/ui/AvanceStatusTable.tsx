"use client";

import React from "react";
import { formatNumber } from "@/core/common/ValueFormatter";
import type { AvancePlan } from "../client";
import { buildStatusRows, labelStatus } from "../domain/planView";
import shared from "./AvanceShared.module.css";
import { AvanceTable } from "./AvanceTable";

interface AvanceStatusTableProps {
  plan: AvancePlan;
}

const EXCLUDED_LABEL = "Excluido";
const INCLUDED_LABEL = "Incluido";

/** Zones layer and current Avance rows per district status, and what the active exclusion list does with each. */
export const AvanceStatusTable: React.FC<AvanceStatusTableProps> = ({ plan }) => {
  const rows = buildStatusRows(plan);
  if (rows.length === 0) return null;

  return (
    <AvanceTable
      caption="Situación de las zonas en SIGRA y filas del Avance actual por situación"
      headers={["Situación", "Zonas", "Filas del Avance actual", "En la carga nueva"]}
    >
      {rows.map((row) => (
        <tr key={row.status}>
          <th scope="row">{labelStatus(row.status)}</th>
          <td className={shared.numeric}>{formatNumber(row.zones)}</td>
          <td className={shared.numeric}>{formatNumber(row.currentAvanceRows)}</td>
          <td>{row.isExcluded ? EXCLUDED_LABEL : INCLUDED_LABEL}</td>
        </tr>
      ))}
    </AvanceTable>
  );
};
