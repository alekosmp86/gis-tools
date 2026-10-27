import { ACTUALIZAR_TABLE_ROLE, type ActualizarTableRole } from "../jobs/actualizar-padron/constants";

export const ActualizarTableKey = {
  STAGING: "staging",
  WORK: "work",
  PADRON: "padron",
  PROVINCE: "province",
  LOCALITY: "locality",
  TYPE: "type",
} as const;

export type ActualizarTableKey = (typeof ActualizarTableKey)[keyof typeof ActualizarTableKey];

export type SchemaField = "stagingSchema" | "workSchema" | "cartoSchema";

export interface ActualizarTableSelection {
  stagingSchema: string;
  workSchema: string;
  cartoSchema: string;
  tables: Record<ActualizarTableKey, string>;
}

export const TABLE_KEYS: readonly ActualizarTableKey[] = Object.values(ActualizarTableKey);

export const REQUIRED_TABLE_KEYS: readonly ActualizarTableKey[] = TABLE_KEYS.filter(
  (key) => key !== ActualizarTableKey.TYPE,
);

const ROLE_OF_KEY: Record<ActualizarTableKey, ActualizarTableRole> = {
  [ActualizarTableKey.STAGING]: ACTUALIZAR_TABLE_ROLE.STAGING,
  [ActualizarTableKey.WORK]: ACTUALIZAR_TABLE_ROLE.TEMP,
  [ActualizarTableKey.PADRON]: ACTUALIZAR_TABLE_ROLE.PADRON,
  [ActualizarTableKey.PROVINCE]: ACTUALIZAR_TABLE_ROLE.PROVINCE,
  [ActualizarTableKey.LOCALITY]: ACTUALIZAR_TABLE_ROLE.LOCALITY,
  [ActualizarTableKey.TYPE]: ACTUALIZAR_TABLE_ROLE.TYPE,
};

export function roleOfTableKey(
  key: ActualizarTableKey,
  { withType = false }: { withType?: boolean } = {},
): ActualizarTableRole {
  if (key === ActualizarTableKey.LOCALITY && withType) return ACTUALIZAR_TABLE_ROLE.LOCALITY_TYPED;
  return ROLE_OF_KEY[key];
}

export function schemaFieldOf(key: ActualizarTableKey): SchemaField {
  if (key === ActualizarTableKey.STAGING) return "stagingSchema";
  if (key === ActualizarTableKey.WORK) return "workSchema";
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
