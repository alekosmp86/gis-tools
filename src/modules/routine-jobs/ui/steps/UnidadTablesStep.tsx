"use client";

import React from "react";
import { ACTUALIZAR_TABLE_ROLE, type ActualizarTableRole } from "../../jobs/actualizar-padron/constants";
import { UNIT_TABLE_ROLE, type UnitTableRole } from "../../jobs/unidad-territorial/constants";
import { UnitSlot } from "../unidadTerritorialWizardState";
import { AddressMasterLinkToggle } from "./AddressMasterLinkToggle";
import { SlotTablesStep, type SlotCopy, type SlotTablesStepProps } from "./SlotTablesStep";

export type UnitColumnRole = UnitTableRole | ActualizarTableRole;

const LOCALITY_COPY: SlotCopy<UnitSlot, UnitColumnRole> = {
  key: UnitSlot.LOCALITY,
  role: UNIT_TABLE_ROLE.SOURCE,
  title: "Localidades de origen",
  note: "Se copian a unidades territoriales.",
  tableLabel: "Tabla de localidades catastrales (origen)",
};

const TYPE_COPY: SlotCopy<UnitSlot, UnitColumnRole> = {
  key: UnitSlot.TYPE,
  role: UNIT_TABLE_ROLE.TYPE,
  title: "Tipos de unidad",
  note: "Asigna el tipo de cada unidad territorial.",
  tableLabel: "Tabla de tipos de unidad territorial",
};

const ADDRESS_MASTER_COPY: SlotCopy<UnitSlot, UnitColumnRole> = {
  key: UnitSlot.ADDRESS_MASTER,
  role: ACTUALIZAR_TABLE_ROLE.ADDRESS_MASTER,
  title: "Direcciones maestras",
  note: "Tabla donde se crean los registros de dirección maestra de las unidades.",
  tableLabel: "Tabla de direcciones maestras",
};

/** With the link on, the target role also requires the address master column, so the picker rejects a table without it. */
const targetCopyOf = (linkAddressMaster: boolean): SlotCopy<UnitSlot, UnitColumnRole> => {
  const role = linkAddressMaster ? UNIT_TABLE_ROLE.TARGET_LINKED : UNIT_TABLE_ROLE.TARGET;
  return {
    key: UnitSlot.TARGET,
    role,
    selectorKey: role,
    title: "Unidades territoriales (destino)",
    note: "Tabla donde se escriben las unidades territoriales.",
    tableLabel: "Tabla de unidades territoriales (destino)",
  };
};

const copiesOf = (linkAddressMaster: boolean): readonly SlotCopy<UnitSlot, UnitColumnRole>[] => [
  LOCALITY_COPY,
  targetCopyOf(linkAddressMaster),
  TYPE_COPY,
  ...(linkAddressMaster ? [ADDRESS_MASTER_COPY] : []),
];

const LINK_LABEL = "Enlazar direcciones maestras de las unidades";
const LINK_HINT =
  "Crea la dirección maestra de cada unidad que no tiene una y la enlaza con la unidad, en la misma transacción. Activado por defecto: desactívelo solo si las unidades no deben tener dirección maestra.";

export interface UnidadTablesStepProps extends Omit<SlotTablesStepProps<UnitSlot, UnitColumnRole>, "copies" | "footer"> {
  linkAddressMaster: boolean;
  onLinkAddressMasterChange: (linkAddressMaster: boolean) => void;
}

export const UnidadTablesStep: React.FC<UnidadTablesStepProps> = ({ linkAddressMaster, onLinkAddressMasterChange, ...slotProps }) => (
  <SlotTablesStep
    {...slotProps}
    copies={copiesOf(linkAddressMaster)}
    footer={
      <AddressMasterLinkToggle
        checked={linkAddressMaster}
        onChange={onLinkAddressMasterChange}
        label={LINK_LABEL}
        hint={LINK_HINT}
      />
    }
  />
);
