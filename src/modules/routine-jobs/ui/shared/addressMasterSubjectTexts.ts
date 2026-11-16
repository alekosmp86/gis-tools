export interface AddressMasterSubjectTexts {
  hint: string;
  idHeader: string;
  withDetails: boolean;
  withoutAddressMaster: string;
  linked: string;
  ambiguous: string;
}

export const PADRON_ADDRESS_MASTER_TEXTS: AddressMasterSubjectTexts = {
  hint: "Direcciones maestras de los padrones: se crean y se enlazan en la misma transacción que la actualización.",
  idHeader: "Id padrón",
  withDetails: false,
  withoutAddressMaster: "Padrones sin dirección maestra",
  linked: "Padrones enlazados",
  ambiguous: "Ambiguos",
};

export const UNIT_ADDRESS_MASTER_TEXTS: AddressMasterSubjectTexts = {
  hint: "Direcciones maestras de las unidades: se crean y se enlazan en la misma transacción que la actualización.",
  idHeader: "Id unidad",
  withDetails: true,
  withoutAddressMaster: "Unidades sin dirección maestra",
  linked: "Unidades enlazadas",
  ambiguous: "Ambiguas",
};
