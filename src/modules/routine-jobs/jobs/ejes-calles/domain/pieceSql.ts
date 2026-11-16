import { COVERAGE_RATIO, SPLIT_PIECE_MIN_COVER_M } from "../constants";

/**
 * A neighbour is a split piece or a merge member when it covers more than SPLIT_PIECE_MIN_COVER_M of the old section, or at least
 * COVERAGE_RATIO of a short section (so a stub of 2 m or less can still take part). A touching neighbour reaches at most one tolerance
 * into the old section, which keeps it out of every section longer than about 1.05 m.
 */
export const isPieceSql = (covered: string, sectionLength: string): string =>
  `(${covered} > ${SPLIT_PIECE_MIN_COVER_M} OR ${covered} >= ${COVERAGE_RATIO} * ${sectionLength})`;
