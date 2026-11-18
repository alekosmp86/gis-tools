import React from "react";
import { AlertMessage } from "@/ui-kit/components/AlertMessage";
import { AlertType } from "@/ui-kit/types/ui";
import { formatNumber } from "@/core/common/ValueFormatter";
import { GeometryRepairStatus, type GeometryRepairOutcome } from "@/core/types/replace";

export interface GeometryRepairSummaryProps {
  outcome: GeometryRepairOutcome;
}

const StatusAlert: React.FC<GeometryRepairSummaryProps> = ({ outcome }) => {
  if (outcome.status === GeometryRepairStatus.OFF) {
    return <AlertMessage type={AlertType.INFO} text="Sin reparación de geometrías: las geometrías se cargaron tal como vienen del origen." />;
  }
  if (outcome.status === GeometryRepairStatus.SKIPPED) {
    return <AlertMessage type={AlertType.INFO} text="Reparación de geometrías no ejecutada: el reemplazo no terminó sin errores." />;
  }
  return (
    <>
      {outcome.status === GeometryRepairStatus.OK && outcome.columns.length === 0 && (
        <AlertMessage type={AlertType.INFO} text="Reparación de geometrías: el destino no tiene columnas poligonales reparables." />
      )}
      {outcome.columns.map(({ column, repairedRows, unrepairableRows }) => (
        <React.Fragment key={column}>
          <AlertMessage type={AlertType.INFO} text={`Geometrías reparadas en ${column}: ${formatNumber(repairedRows)} filas.`} />
          {unrepairableRows > 0 && (
            <AlertMessage
              type={AlertType.WARNING}
              text={`${formatNumber(unrepairableRows)} filas no se pudieron reparar y conservan su geometría original (${column}).`}
            />
          )}
        </React.Fragment>
      ))}
      {outcome.status === GeometryRepairStatus.FAILED && (
        <AlertMessage
          type={AlertType.WARNING}
          text="Reparación de geometrías incompleta: la carga se conserva; vea los errores."
        />
      )}
    </>
  );
};

export const GeometryRepairSummary: React.FC<GeometryRepairSummaryProps> = ({ outcome }) => (
  <>
    <StatusAlert outcome={outcome} />
    {outcome.skippedColumns.map((column) => (
      <AlertMessage key={`skipped-${column}`} type={AlertType.INFO} text={`Columna ${column} omitida (tipo no soportado).`} />
    ))}
  </>
);
