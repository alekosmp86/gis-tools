"use client";

import React from "react";
import type { ActualizarPadronBackup } from "../jobs/actualizar-padron/types";
import type { ReportRowListRow } from "./ReportRowList";
import { RevertBackupSection } from "./RevertBackupSection";

const INSTRUCTIONS = [
  "Para revertir, descomprima el .gz y ejecute el .sql completo contra la base, con psql o con pgAdmin / cualquier cliente SQL. Revierte solo los cambios de esta ejecución y supone que nadie más modificó esas filas.",
  "El servidor guarda una copia temporal durante 7 días.",
  "Si el servidor se reinicia, los enlaces de descarga dejan de funcionar: descargue el respaldo antes.",
];

export interface ActualizarBackupSectionProps {
  backup: ActualizarPadronBackup;
}

const optionalRowOf = (label: string, value: number | undefined): ReportRowListRow[] =>
  value !== undefined && value > 0 ? [{ label, value }] : [];

const countRowsOf = (backup: ActualizarPadronBackup): ReportRowListRow[] => [
  { label: "Geometrías actualizadas", value: backup.counts.updated },
  { label: "Claves actualizadas", value: backup.counts.paired },
  { label: "Padrones insertados", value: backup.counts.inserted },
  ...(backup.counts.deleted > 0 ? [{ label: "Padrones eliminados", value: backup.counts.deleted }] : []),
  ...optionalRowOf("Direcciones reasignadas", backup.counts.reassigned),
  ...optionalRowOf("Entradas de direcciones maestras eliminadas", backup.counts.masterDeleted),
  { label: "Padrones sin dirección maestra antes del enlace", value: backup.counts.addressMasterRows },
];

export const ActualizarBackupSection: React.FC<ActualizarBackupSectionProps> = ({ backup }) => (
  <RevertBackupSection backup={backup} rows={countRowsOf(backup)} instructions={INSTRUCTIONS} />
);
