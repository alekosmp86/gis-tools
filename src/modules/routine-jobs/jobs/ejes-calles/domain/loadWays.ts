import { textOf, type Row } from "../../shared/rowMapping";
import { literal, q } from "../../shared/sqlFragments";
import { LOAD_CHUNK_SIZE } from "../constants";
import { LOAD_TEMP } from "./loadSelectionSql";
import { shortNameOf } from "./shortName";

export interface NewWayRow {
  idcalle: string;
  name: string | null;
  shortName: string | null;
  typeId: string | null;
  fontId: string | null;
}

const nullableLiteral = (value: string | null): string => (value === null ? "NULL" : literal(value));

export const newWayOf = (row: Row): NewWayRow => {
  const name = textOf(row.name);
  return {
    idcalle: String(row.idcalle),
    name,
    shortName: name === null ? null : shortNameOf(name),
    typeId: textOf(row.type_id),
    fontId: textOf(row.font_id),
  };
};

/** The `short_name` rules run here, on the new names only, and the result goes to the session's temp table. */
export function buildInsertWayInputSql(ways: readonly NewWayRow[]): string[] {
  const statements: string[] = [];
  for (let start = 0; start < ways.length; start += LOAD_CHUNK_SIZE) {
    const values = ways
      .slice(start, start + LOAD_CHUNK_SIZE)
      .map((way) =>
        `(${[literal(way.idcalle), nullableLiteral(way.name), nullableLiteral(way.shortName), nullableLiteral(way.typeId), nullableLiteral(way.fontId)].join(", ")})`
      );
    statements.push(`INSERT INTO ${q(LOAD_TEMP.WAY_IN)} (idcalle, name, short_name, type_id, font_id) VALUES ${values.join(", ")}`);
  }
  return statements;
}

/** The renamed streets as `(idcalle, name, short_name)`, the short name made by the same rules as a new way. */
export function buildInsertWayRenameInputSql(ways: readonly NewWayRow[]): string[] {
  const statements: string[] = [];
  for (let start = 0; start < ways.length; start += LOAD_CHUNK_SIZE) {
    const values = ways
      .slice(start, start + LOAD_CHUNK_SIZE)
      .map((way) => `(${[literal(way.idcalle), nullableLiteral(way.name), nullableLiteral(way.shortName)].join(", ")})`);
    statements.push(`INSERT INTO ${q(LOAD_TEMP.WAY_RENAME_IN)} (idcalle, name, short_name) VALUES ${values.join(", ")}`);
  }
  return statements;
}
