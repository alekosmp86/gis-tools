"use client";

import React from "react";
import { formatNumber } from "@/core/common/ValueFormatter";
import { REPORT_KIND_LABELS, type AvanceLoadResult } from "../client";
import { labelStatus } from "../domain/planView";
import shared from "./AvanceShared.module.css";

interface AvanceResultTablesProps {
  result: AvanceLoadResult;
}

const REPORT_FAILED_LABEL = "Falló";

export const AvanceResultTables: React.FC<AvanceResultTablesProps> = ({ result }) => (
  <>
    <table className={shared.table}>
      <caption>{formatNumber(result.avanceInserted)} filas insertadas en el Avance</caption>
      <thead>
        <tr>
          <th scope="col">Archivo</th>
          <th scope="col">Filas cargadas</th>
          <th scope="col">Basura eliminada</th>
          <th scope="col">Filas en el Avance</th>
          <th scope="col">Claves sin zona</th>
        </tr>
      </thead>
      <tbody>
        {result.files.map((file) => (
          <tr key={file.fileName}>
            <th scope="row">{file.fileName}</th>
            <td className={shared.numeric}>{formatNumber(file.rowsLoaded)}</td>
            <td className={shared.numeric}>{formatNumber(file.junkDeleted)}</td>
            <td className={shared.numeric}>{formatNumber(file.avanceInserted)}</td>
            <td className={shared.numeric}>{formatNumber(file.unmatchedKeys)}</td>
          </tr>
        ))}
      </tbody>
    </table>
    <table className={shared.table}>
      <caption>Filas insertadas por situación de la zona</caption>
      <thead>
        <tr>
          <th scope="col">Situación</th>
          <th scope="col">Filas</th>
        </tr>
      </thead>
      <tbody>
        {result.byStatus.map((entry) => (
          <tr key={entry.status}>
            <th scope="row">{labelStatus(entry.status)}</th>
            <td className={shared.numeric}>{formatNumber(entry.count)}</td>
          </tr>
        ))}
      </tbody>
    </table>
    <table className={shared.table}>
      <caption>Reportes</caption>
      <thead>
        <tr>
          <th scope="col">Reporte</th>
          <th scope="col">Filas</th>
        </tr>
      </thead>
      <tbody>
        {result.reports.map((report) => (
          <tr key={report.kind}>
            <th scope="row">{REPORT_KIND_LABELS[report.kind]}</th>
            <td className={report.rows === null ? undefined : shared.numeric}>
              {report.rows === null ? REPORT_FAILED_LABEL : formatNumber(report.rows)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  </>
);
