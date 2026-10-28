"use client";

import React from "react";
import { UNIT_TABLE_ROLE, type UnitTableRole } from "../../jobs/unidad-territorial/constants";
import { UnitSlot } from "../unidadTerritorialWizardState";
import { SlotTablesStep, type SlotCopy, type SlotTablesStepProps } from "./SlotTablesStep";

const COPIES: readonly SlotCopy<UnitSlot, UnitTableRole>[] = [
  {
    key: UnitSlot.LOCALITY,
    role: UNIT_TABLE_ROLE.SOURCE,
    title: "Localidades de origen",
    note: "Se copian a unidades territoriales.",
    tableLabel: "Tabla de localidades catastrales (origen)",
  },
  {
    key: UnitSlot.TARGET,
    role: UNIT_TABLE_ROLE.TARGET,
    title: "Unidades territoriales (destino)",
    note: "Tabla donde se escriben las unidades territoriales.",
    tableLabel: "Tabla de unidades territoriales (destino)",
  },
  {
    key: UnitSlot.TYPE,
    role: UNIT_TABLE_ROLE.TYPE,
    title: "Tipos de unidad",
    note: "Asigna el tipo de cada unidad territorial.",
    tableLabel: "Tabla de tipos de unidad territorial",
  },
];

export type UnidadTablesStepProps = Omit<SlotTablesStepProps<UnitSlot, UnitTableRole>, "copies">;

export const UnidadTablesStep: React.FC<UnidadTablesStepProps> = (props) => <SlotTablesStep {...props} copies={COPIES} />;
