import { cte, q } from "../../shared/sqlFragments";
import { CIRCULATION_WAY_COLUMN } from "../constants";
import type { EjesLayouts } from "../types";
import { col, countOf, listOf, table } from "./layoutSql";
import { canonicalTextSql } from "./stagingSql";

/** A name as the rename compares it: upper case, no accents, one space between words, no edge spaces. */
export const normalizedNameSql = (expression: string): string =>
  `upper(btrim(regexp_replace(translate(${expression}, 'ÁÉÍÓÚÜÑáéíóúüñ', 'AEIOUUNaeiouun'), '\\s+', ' ', 'g')))`;

/** The file's copies of each `idcalle` with their trimmed names and normalised names; `copies` is the source of the copies (the analysis' kept copies or `ej_copy`). */
const renameCopiesCte = (copies: string): string =>
  cte(
    "rename_copies",
    `SELECT k.idcalle, btrim(k.nombre) AS name, ${normalizedNameSql("k.nombre")} AS norm FROM ${copies} AS k WHERE k.idcalle IS NOT NULL AND k.nombre IS NOT NULL`
  );

/**
 * Needs `rename_copies`. One row per `idcalle`: one representative file name per distinct normalised name (the lowest spelling), ordered by
 * normalised name; its sections; and whether its copies name it in more than one normalised way, which means the user must choose one.
 */
const renameStreetsCte = (): string =>
  cte(
    "rename_streets",
    [
      "SELECT d.idcalle, array_agg(d.name ORDER BY d.norm) AS names, sum(d.sections)::bigint AS sections, count(*) > 1 AS multi_name FROM",
      "(SELECT c.idcalle, c.norm, min(c.name) AS name, count(*) AS sections FROM",
      `${q("rename_copies")} AS c GROUP BY c.idcalle, c.norm) AS d GROUP BY d.idcalle`,
    ].join(" ")
  );

/**
 * Needs `rename_streets` and `cw_pairs`. A street is listed when carto holds rows for its `idcalle` and none of them holds a name that
 * normalises to one of the file's names. Its new name is the first of its file names.
 */
const renamedStreetsCte = (): string =>
  cte(
    "renamed_streets",
    [
      "SELECT s.idcalle, s.names, s.names[1] AS new_name, s.sections, s.multi_name FROM",
      `${q("rename_streets")} AS s`,
      `WHERE EXISTS (SELECT 1 FROM ${q("cw_pairs")} AS p WHERE p.idcalle = s.idcalle)`,
      `AND NOT EXISTS (SELECT 1 FROM ${q("rename_copies")} AS c JOIN ${q("cw_pairs")} AS p ON p.idcalle = c.idcalle AND ${normalizedNameSql("p.name")} = c.norm WHERE c.idcalle = s.idcalle)`,
    ].join(" ")
  );

/** The rename candidates, shared by the analysis and the load. Needs `cw_pairs`; `copies` is the file's copies with `idcalle` and `nombre`. */
export const renameCandidateCtes = (copies: string): string[] => [renameCopiesCte(copies), renameStreetsCte(), renamedStreetsCte()];

/** Analysis only: the `circulation_way` rows each renamed street would change, by the plain comparison the load uses. */
const renameWaysCte = (layouts: EjesLayouts): string => {
  const way = (logical: string): string => `w.${col(layouts, "CIRCULATION_WAY", logical)}`;
  return cte(
    "rename_ways",
    [
      `SELECT s.idcalle, count(*) AS ways FROM ${table(layouts, "CIRCULATION_WAY")} AS w`,
      `JOIN ${q("renamed_streets")} AS s ON s.idcalle = ${canonicalTextSql(way(CIRCULATION_WAY_COLUMN.CALLE))}`,
      `WHERE ${way(CIRCULATION_WAY_COLUMN.NAME)} IS DISTINCT FROM s.new_name GROUP BY s.idcalle`,
    ].join(" ")
  );
};

/** Analysis only: the names carto holds per renamed street, joined with " / ". */
const renameNamesCte = (): string =>
  cte(
    "rename_names",
    `SELECT p.idcalle, string_agg(DISTINCT p.name, ' / ' ORDER BY p.name) AS names FROM ${q("cw_pairs")} AS p WHERE p.idcalle IN (SELECT s.idcalle FROM ${q("renamed_streets")} AS s) GROUP BY p.idcalle`
  );

/** Analysis only: the file copies the load reads as `ej_copy` (the kept copies, minus the held renumber pairs). */
const analysisCopiesSql = (): string =>
  `(SELECT k.idcalle, k.nombre FROM ${q("copy_final")} AS k WHERE NOT EXISTS (SELECT 1 FROM ${q("renum_skipped")} AS h WHERE h.new_ref = k.ref))`;

/** Analysis only. Needs `cw_pairs`, `copy_final` and `renum_skipped` in the same statement. */
export const renamedStreetsCtes = (layouts: EjesLayouts): string[] => [
  ...renameCandidateCtes(analysisCopiesSql()),
  renameWaysCte(layouts),
  renameNamesCte(),
];

const renamedStreetsListSql = (): string =>
  [
    'SELECT s.idcalle AS "idcalle", n.names AS "currentNames", s.new_name AS "newName", s.names AS "names", s.sections AS "sections",',
    'COALESCE(w.ways, 0) AS "ways", s.multi_name AS "multiName"',
    `FROM ${q("renamed_streets")} AS s LEFT JOIN ${q("rename_ways")} AS w ON w.idcalle = s.idcalle LEFT JOIN ${q("rename_names")} AS n ON n.idcalle = s.idcalle`,
    "ORDER BY s.idcalle",
  ].join(" ");

export const renamedStreetsListColumn = (alias: string): string => listOf(alias, "renamed_list", renamedStreetsListSql());

export const renamedStreetsCountColumns = (): string[] => [
  `${countOf("renamed_streets")} AS "renamed_streets"`,
  `${countOf("renamed_streets", "multi_name")} AS "renamed_streets_held"`,
];
