import { listOf, nullableNumber, numberOf, textOf, type Row } from "../../shared/rowMapping";
import { shortNameOf } from "./shortName";
import { TWIN_CLASS, type TwinClass } from "../constants";
import { ANALYSIS_LIST_ALIAS } from "./analysisSql";
import type {
  EjesAnalysis,
  EjesAttrRow,
  EjesMergeRow,
  EjesNewStreetRow,
  EjesRemovalRow,
  EjesSplitRow,
  EjesTwinRow,
  EjesStagingReport,
  EjesUnknownValue,
} from "../types";

const textsOf = (value: unknown): string[] => (Array.isArray(value) ? value.map(String) : []);

const unknownValueOf = (row: Row): EjesUnknownValue => ({ value: textOf(row.value), rows: numberOf(row.rows) });

const splitOf = (row: Row): EjesSplitRow => ({
  oldRef: String(row.old_ref),
  idcalle: textOf(row.idcalle),
  newRefs: textsOf(row.new_refs),
  points: numberOf(row.points),
  coverage: nullableNumber(row.coverage),
  oldLength: nullableNumber(row.old_length),
  newLength: nullableNumber(row.new_length),
  outsideLength: nullableNumber(row.outside_length),
});

const mergeOf = (row: Row): EjesMergeRow => ({
  newRef: String(row.new_ref),
  idcalle: textOf(row.idcalle),
  oldRefs: textsOf(row.old_refs),
  points: numberOf(row.points),
  coverage: nullableNumber(row.coverage),
  oldLength: nullableNumber(row.old_length),
  newLength: nullableNumber(row.new_length),
  outsideLength: nullableNumber(row.outside_length),
});

const removalOf = (row: Row): EjesRemovalRow => ({
  ref: String(row.ref),
  idcalle: textOf(row.idcalle),
  points: numberOf(row.points),
});

const streetOf = (row: Row): EjesNewStreetRow => {
  const name = textOf(row.name);
  return {
    idcalle: textOf(row.idcalle),
    name,
    shortName: name === null ? null : shortNameOf(name),
    sections: numberOf(row.sections),
    tipos: textOf(row.tipos),
    departments: textOf(row.departments),
    localities: textOf(row.localities),
  };
};

const attrOf = (row: Row): EjesAttrRow => ({
  ref: String(row.ref),
  name: textOf(row.name),
  currentName: textOf(row.current_name),
  idcalle: textOf(row.idcalle),
  currentIdcalle: textOf(row.current_idcalle),
  typeId: nullableNumber(row.type_id),
  currentTypeId: nullableNumber(row.current_type_id),
  fontId: nullableNumber(row.font_id),
  currentFontId: nullableNumber(row.current_font_id),
});

const twinClassOf = (value: unknown): TwinClass =>
  Object.values(TWIN_CLASS).find((twinClass) => twinClass === value) ?? TWIN_CLASS.NEITHER;

const twinOf = (row: Row): EjesTwinRow => ({
  ref: String(row.ref),
  idcalle: textOf(row.idcalle),
  department: textOf(row.department),
  localities: textsOf(row.localities),
  class: twinClassOf(row.class),
  length: nullableNumber(row.length),
  urbanLength: nullableNumber(row.urban_length),
  ruralLength: nullableNumber(row.rural_length),
  dropLocalities: textsOf(row.drop_localities),
});

export function toEjesStagingReport(row: Row): EjesStagingReport {
  return {
    rows: numberOf(row.rows),
    distinctRefs: numberOf(row.distinct_refs),
    repeatedGroups: numberOf(row.repeated_groups),
    repeatedRows: numberOf(row.repeated_rows),
    nonIntegerRefs: numberOf(row.non_integer_refs),
    emptyGeometry: numberOf(row.empty_geometry),
    emptyIdcalle: numberOf(row.empty_idcalle),
    damagedTextRows: numberOf(row.damaged_text_rows),
    unknownTipoRows: numberOf(row.unknown_tipo_rows),
    unknownFuenteRows: numberOf(row.unknown_fuente_rows),
    unknownTipos: listOf(row.unknown_tipos).map(unknownValueOf),
    unknownFuentes: listOf(row.unknown_fuentes).map(unknownValueOf),
  };
}

export function toEjesAnalysis(row: Row): EjesAnalysis {
  return {
    counts: {
      newSections: numberOf(row.new_sections),
      unchanged: numberOf(row.unchanged),
      attr: numberOf(row.attr),
      geom: numberOf(row.geom),
      both: numberOf(row.both),
      removed: numberOf(row.removed),
      splits: numberOf(row.splits),
      merges: numberOf(row.merges),
      plainRemovals: numberOf(row.plain_removals),
      plainHeld: numberOf(row.plain_held),
      newStreets: numberOf(row.new_streets),
      twins: numberOf(row.twins),
      twinsUrban: numberOf(row.twins_urban),
      twinsRural: numberOf(row.twins_rural),
      twinsBoth: numberOf(row.twins_both),
      twinsNeither: numberOf(row.twins_neither),
      twinsCrossDepartment: numberOf(row.twins_cross_department),
      twinsDrop: numberOf(row.twins_drop),
      twinsKeep: numberOf(row.twins_keep),
    },
    cloc: {
      withLocality: numberOf(row.with_locality),
      onlyDepartment: numberOf(row.only_department),
      withoutCode: numberOf(row.without_code),
    },
    splits: listOf(row[ANALYSIS_LIST_ALIAS.SPLITS]).map(splitOf),
    merges: listOf(row[ANALYSIS_LIST_ALIAS.MERGES]).map(mergeOf),
    plainRemovals: listOf(row[ANALYSIS_LIST_ALIAS.PLAIN]).map(removalOf),
    newStreets: listOf(row[ANALYSIS_LIST_ALIAS.STREETS]).map(streetOf),
    attrChanges: listOf(row[ANALYSIS_LIST_ALIAS.ATTRS]).map(attrOf),
    twins: listOf(row[ANALYSIS_LIST_ALIAS.TWINS]).map(twinOf),
  };
}
