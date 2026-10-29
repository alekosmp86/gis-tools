import { ACTUALIZAR_TABLE_ROLE, type ActualizarTableRole } from "../jobs/actualizar-padron/constants";

export const ActualizarTableKey = {
  STAGING: "staging",
  TARGET: "target",
  PROVINCE: "province",
  LOCALITY: "locality",
  TYPE: "type",
  ADDRESS_MASTER: "addressMaster",
} as const;

export type ActualizarTableKey = (typeof ActualizarTableKey)[keyof typeof ActualizarTableKey];

export type SchemaField = "stagingSchema" | "cartoSchema";

export interface ActualizarTableSelection {
  stagingSchema: string;
  cartoSchema: string;
  tables: Record<ActualizarTableKey, string>;
}

export const TABLE_KEYS: readonly ActualizarTableKey[] = Object.values(ActualizarTableKey);

/** The optional keys: the type table always, the address master table only when the link option is on. */
const OPTIONAL_TABLE_KEYS: readonly ActualizarTableKey[] = [ActualizarTableKey.TYPE, ActualizarTableKey.ADDRESS_MASTER];

export const REQUIRED_TABLE_KEYS: readonly ActualizarTableKey[] = TABLE_KEYS.filter(
  (key) => !OPTIONAL_TABLE_KEYS.includes(key),
);

const ROLE_OF_KEY: Record<ActualizarTableKey, ActualizarTableRole> = {
  [ActualizarTableKey.STAGING]: ACTUALIZAR_TABLE_ROLE.STAGING,
  [ActualizarTableKey.TARGET]: ACTUALIZAR_TABLE_ROLE.TARGET,
  [ActualizarTableKey.PROVINCE]: ACTUALIZAR_TABLE_ROLE.PROVINCE,
  [ActualizarTableKey.LOCALITY]: ACTUALIZAR_TABLE_ROLE.LOCALITY,
  [ActualizarTableKey.TYPE]: ACTUALIZAR_TABLE_ROLE.TYPE,
  [ActualizarTableKey.ADDRESS_MASTER]: ACTUALIZAR_TABLE_ROLE.ADDRESS_MASTER,
};

export interface RoleOptions {
  withType?: boolean;
  linkAddressMaster?: boolean;
}

export function roleOfTableKey(key: ActualizarTableKey, { withType = false, linkAddressMaster = false }: RoleOptions = {}): ActualizarTableRole {
  if (key === ActualizarTableKey.LOCALITY && withType) return ACTUALIZAR_TABLE_ROLE.LOCALITY_TYPED;
  if (key === ActualizarTableKey.TARGET && linkAddressMaster) return ACTUALIZAR_TABLE_ROLE.TARGET_LINKED;
  return ROLE_OF_KEY[key];
}

export function schemaFieldOf(key: ActualizarTableKey): SchemaField {
  if (key === ActualizarTableKey.STAGING) return "stagingSchema";
  return "cartoSchema";
}

const schemaOf = (selection: ActualizarTableSelection, key: ActualizarTableKey): string =>
  selection[schemaFieldOf(key)].trim();

/** Names chosen for other keys that live in the same schema; a table cannot repeat them. */
export function actualizarExcludedFor(selection: ActualizarTableSelection): Record<ActualizarTableKey, string[]> {
  const excludedFor = (key: ActualizarTableKey): string[] => {
    const sameSchema = TABLE_KEYS.filter((other) => other !== key && schemaOf(selection, other) === schemaOf(selection, key));
    const names = sameSchema.map((other) => selection.tables[other].trim()).filter((name) => name !== "");
    return [...new Set(names)];
  };
  return Object.fromEntries(TABLE_KEYS.map((key) => [key, excludedFor(key)])) as Record<ActualizarTableKey, string[]>;
}
