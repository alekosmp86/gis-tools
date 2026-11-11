"use client";

import React from "react";
import { EJES_ROLES, EJES_TABLE_ROLE, type EjesTableRole } from "../../jobs/ejes-calles/constants";
import { EJES_ROLE_TITLES } from "../ejesCallesTexts";
import { SlotTablesStep, type SlotCopy, type SlotTablesStepProps } from "./SlotTablesStep";

const COPY_BY_ROLE: Record<EjesTableRole, Omit<SlotCopy<EjesTableRole, EjesTableRole>, "key" | "role" | "title">> = {
  [EJES_TABLE_ROLE.STAGING]: {
    note: "Tabla de paso con los ejes cargados desde el CSV. Solo se lee.",
    tableLabel: "Tabla de ejes de origen",
  },
  [EJES_TABLE_ROLE.ROAD_SECTION]: {
    note: "Tabla final de tramos. El análisis no la modifica.",
    tableLabel: "Tabla de tramos de calle",
  },
  [EJES_TABLE_ROLE.CIRCULATION_WAY]: {
    note: "Calles a las que pertenecen los tramos.",
    tableLabel: "Tabla de vías de circulación",
  },
  [EJES_TABLE_ROLE.ADDRESS_MASTER]: {
    note: "Una dirección maestra por cada tramo.",
    tableLabel: "Tabla de direcciones maestras",
  },
  [EJES_TABLE_ROLE.VERTICES]: {
    note: "Vértices de la topología de los tramos.",
    tableLabel: "Tabla de vértices de ruteo",
  },
  [EJES_TABLE_ROLE.ACCESS_POINT]: {
    note: "Puntos que apuntan a un tramo por su reftramo.",
    tableLabel: "Tabla de puntos de acceso",
  },
  [EJES_TABLE_ROLE.LOCALITIES]: {
    note: "Calcula el cloc_iso de los tramos. Solo se lee.",
    tableLabel: "Tabla de localidades INE",
  },
  [EJES_TABLE_ROLE.DEPARTMENTS]: {
    note: "Código de departamento de los tramos fuera de toda localidad. Solo se lee.",
    tableLabel: "Tabla de departamentos",
  },
};

const COPIES: readonly SlotCopy<EjesTableRole, EjesTableRole>[] = EJES_ROLES.map((role) => ({
  key: role,
  role,
  title: EJES_ROLE_TITLES[role],
  ...COPY_BY_ROLE[role],
}));

export type EjesTablesStepProps = Omit<SlotTablesStepProps<EjesTableRole, EjesTableRole>, "copies" | "footer">;

export const EjesTablesStep: React.FC<EjesTablesStepProps> = (props) => <SlotTablesStep {...props} copies={COPIES} />;
