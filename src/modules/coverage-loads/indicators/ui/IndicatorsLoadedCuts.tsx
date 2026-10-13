"use client";

import React from "react";
import { formatNumber } from "@/core/common/ValueFormatter";
import type { LoadResult } from "../client";
import shared from "./IndicatorsShared.module.css";

interface IndicatorsLoadedCutsProps {
  result: LoadResult;
}

export const IndicatorsLoadedCuts: React.FC<IndicatorsLoadedCutsProps> = ({ result }) => (
  <table className={shared.table}>
    <caption>
      {formatNumber(result.totalInserted)} filas insertadas, {formatNumber(result.totalReplaced)} filas
      reemplazadas
    </caption>
    <thead>
      <tr>
        <th scope="col">Corte</th>
        <th scope="col">Archivo</th>
        <th scope="col">Reemplazadas</th>
        <th scope="col">Insertadas</th>
        <th scope="col">En el histórico</th>
        <th scope="col">Rechazadas</th>
        <th scope="col">Estado</th>
      </tr>
    </thead>
    <tbody>
      {result.cuts.map((cut) => (
        <tr key={cut.fileName}>
          <th scope="row">{cut.fechaact}</th>
          <td>{cut.fileName}</td>
          <td className={shared.numeric}>{formatNumber(cut.replacedRows)}</td>
          <td className={shared.numeric}>{formatNumber(cut.insertedRows)}</td>
          <td className={shared.numeric}>{formatNumber(cut.storedRows)}</td>
          <td className={shared.numeric}>{formatNumber(cut.rejectedRows)}</td>
          <td>{cut.incomplete ? "Corte incompleto" : "Completo"}</td>
        </tr>
      ))}
    </tbody>
  </table>
);
