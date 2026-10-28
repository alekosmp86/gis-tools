"use client";

import React from "react";
import { COMPLETAR_TABLE_ROLE, type CompletarTableRole } from "../../jobs/completar-unidad-territorial/constants";
import { CompletarSlot } from "../completarUnidadTerritorialWizardState";
import { SlotTablesStep, type SlotCopy, type SlotTablesStepProps } from "./SlotTablesStep";

const COPIES: readonly SlotCopy<CompletarSlot, CompletarTableRole>[] = [
  {
    key: CompletarSlot.UNIT,
    role: COMPLETAR_TABLE_ROLE.UNIT,
    title: "Unidades territoriales",
    note: "Se enlaza cada unidad sin dirección maestra.",
    tableLabel: "Tabla de unidades territoriales",
  },
  {
    key: CompletarSlot.ADDRESS_MASTER,
    role: COMPLETAR_TABLE_ROLE.ADDRESS_MASTER,
    title: "Direcciones maestras",
    note: "Tabla donde se crean los registros de dirección maestra.",
    tableLabel: "Tabla de direcciones maestras",
  },
];

export type CompletarTablesStepProps = Omit<SlotTablesStepProps<CompletarSlot, CompletarTableRole>, "copies">;

export const CompletarTablesStep: React.FC<CompletarTablesStepProps> = (props) => <SlotTablesStep {...props} copies={COPIES} />;
