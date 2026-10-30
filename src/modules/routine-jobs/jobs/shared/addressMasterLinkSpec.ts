export const ADDRESS_MASTER_COLUMN = {
  ID: "addresses_master_id",
  URN: "urn",
  LATITUDE: "latitud",
  LONGITUDE: "longitud",
} as const;

export const ADDRESS_MASTER_WRITTEN_COLUMNS: readonly string[] = [
  ADDRESS_MASTER_COLUMN.URN,
  ADDRESS_MASTER_COLUMN.LATITUDE,
  ADDRESS_MASTER_COLUMN.LONGITUDE,
];

export const ADDRESS_MASTER_REQUIRED_COLUMNS: readonly string[] = Object.values(ADDRESS_MASTER_COLUMN);

export const ADDRESS_MASTER_INITIAL_COORDINATE = 0;

export const ADDRESS_MASTER_TITLE = "de direcciones maestras";

export const ADDRESS_MASTER_TOGGLE_MISMATCH_MESSAGE =
  "La opción de enlace de direcciones maestras no coincide con la tabla de direcciones maestras. Active el enlace y elija la tabla, o desactive ambos.";

const TERRITORIAL_UNIT_URN_PREFIX = "cgeo:territorial_unit:id:";
const PADRON_URN_PREFIX = "cgeo:padron:id:";

export interface AddressMasterSubjectTexts {
  structureTitle: string;
  createdScope: string;
  linkedMessageStart: string;
  remainingMessageStart: string;
  expectedPhrase: string;
  ambiguousPhrase: string;
  ambiguousNouns: readonly [singular: string, plural: string];
  linkedNoun: string;
  createdChangeKind: string;
  linkedChangeKind: string;
}

/** What a subject table contributes to the link pass: its urn prefix, its columns and its Spanish wording. */
export interface AddressMasterSubjectSpec {
  urnPrefix: string;
  idColumn: string;
  addressMasterColumn: string;
  nameColumn: string | null;
  provinceColumn: string | null;
  requiredColumns: readonly string[];
  texts: AddressMasterSubjectTexts;
}

export const UNIT_SUBJECT_SPEC: AddressMasterSubjectSpec = {
  urnPrefix: TERRITORIAL_UNIT_URN_PREFIX,
  idColumn: "id",
  addressMasterColumn: "id_address_master",
  nameColumn: "name",
  provinceColumn: "id_province",
  requiredColumns: ["id", "name", "id_province", "id_address_master"],
  texts: {
    structureTitle: "de unidades territoriales",
    createdScope: "",
    linkedMessageStart: "Las unidades enlazadas",
    remainingMessageStart: "Las unidades sin dirección maestra después del enlace",
    expectedPhrase: "las esperadas",
    ambiguousPhrase: "las ambiguas",
    ambiguousNouns: ["unidad ambigua", "unidades ambiguas"],
    linkedNoun: "unidades enlazadas",
    createdChangeKind: "Dirección maestra creada",
    linkedChangeKind: "Unidad enlazada",
  },
};

export const PADRON_SUBJECT_SPEC: AddressMasterSubjectSpec = {
  urnPrefix: PADRON_URN_PREFIX,
  idColumn: "id",
  addressMasterColumn: "id_address_master",
  nameColumn: null,
  provinceColumn: null,
  requiredColumns: ["id", "id_address_master"],
  texts: {
    structureTitle: "de padrones",
    createdScope: " para padrones",
    linkedMessageStart: "Los padrones enlazados",
    remainingMessageStart: "Los padrones sin dirección maestra después del enlace",
    expectedPhrase: "los esperados",
    ambiguousPhrase: "los ambiguos",
    ambiguousNouns: ["padrón ambiguo", "padrones ambiguos"],
    linkedNoun: "padrones enlazados",
    createdChangeKind: "Dirección maestra creada para padrón",
    linkedChangeKind: "Padrón enlazado",
  },
};
