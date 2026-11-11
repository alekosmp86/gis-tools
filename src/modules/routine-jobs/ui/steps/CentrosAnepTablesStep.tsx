"use client";

import React from "react";
import { CENTROS_ROLES, CENTROS_TABLE_ROLE, type CentrosTableRole } from "../../jobs/centros-anep/constants";
import { CENTROS_ROLE_TITLES } from "../centrosAnepTexts";
import { SlotTablesStep, type SlotCopy, type SlotTablesStepProps } from "./SlotTablesStep";

const COPY_BY_ROLE: Record<CentrosTableRole, Omit<SlotCopy<CentrosTableRole, CentrosTableRole>, "key" | "role" | "title">> = {
  [CENTROS_TABLE_ROLE.STAGING]: {
    note: "Tabla de paso cargada con DB vs. Shapefile (Reemplazo completo). Solo se lee.",
    tableLabel: "Tabla de centros ANEP de staging",
  },
  [CENTROS_TABLE_ROLE.FINAL]: {
    note: "Tabla que publica GeoServer. Se vacía y se vuelve a llenar con la carga real.",
    tableLabel: "Tabla final de centros ANEP",
  },
};

const COPIES: readonly SlotCopy<CentrosTableRole, CentrosTableRole>[] = CENTROS_ROLES.map((role) => ({
  key: role,
  role,
  title: CENTROS_ROLE_TITLES[role],
  ...COPY_BY_ROLE[role],
}));

export type CentrosAnepTablesStepProps = Omit<SlotTablesStepProps<CentrosTableRole, CentrosTableRole>, "copies" | "footer">;

export const CentrosAnepTablesStep: React.FC<CentrosAnepTablesStepProps> = (props) => (
  <SlotTablesStep {...props} copies={COPIES} />
);
