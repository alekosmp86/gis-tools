"use client";

import React from "react";
import { formatNumber } from "@/core/common/ValueFormatter";
import type { AvancePlan } from "../client";
import { buildStatusRows, labelStatus } from "../domain/planView";
import shared from "./AvanceShared.module.css";

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
    <table className={shared.table}>
      <caption>Situación de las zonas en SIGRA y filas del Avance actual por situación</caption>
      <thead>
        <tr>
          <th scope="col">Situación</th>
          <th scope="col">Zonas</th>
          <th scope="col">Filas del Avance actual</th>
          <th scope="col">En la carga nueva</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.status}>
            <th scope="row">{labelStatus(row.status)}</th>
            <td className={shared.numeric}>{formatNumber(row.zones)}</td>
            <td className={shared.numeric}>{formatNumber(row.currentAvanceRows)}</td>
            <td>{row.isExcluded ? EXCLUDED_LABEL : INCLUDED_LABEL}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
};
