import { COVERAGE_RATIO, PIECE_OWN_FRACTION, SPLIT_PIECE_MIN_COVER_M } from "../constants";

/**
 * A new section (`newLength`, same idcalle, already joined) is a split piece or a merge member of an old section (`oldLength`, covered
 * `covered` metres) when it absorbs COVERAGE_RATIO of the old one (stubs included), or when it covers more than SPLIT_PIECE_MIN_COVER_M and
 * at least PIECE_OWN_FRACTION of its own length (it mostly lies on the old one). A new section that only touches the end of an old one
 * overlaps it by a few metres and is neither.
 */
export const isPieceSql = (covered: string, oldLength: string, newLength: string): string =>
  `(${covered} >= ${COVERAGE_RATIO} * ${oldLength} OR (${covered} > ${SPLIT_PIECE_MIN_COVER_M} AND ${covered} >= ${PIECE_OWN_FRACTION} * ${newLength}))`;
