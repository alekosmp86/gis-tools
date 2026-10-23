import { MatchKind } from "@/core/services/columnAutoMapper";

export const AUTO_MATCH_LABELS: Record<string, string> = {
  [MatchKind.EXACT]: "coincide por nombre exacto",
  [MatchKind.CASE_INSENSITIVE]: "coincide sin distinguir mayúsculas",
  [MatchKind.NORMALIZED]: "coincide ignorando guiones y acentos",
  [MatchKind.TRUNCATED]: "nombre truncado a 10 caracteres del DBF",
  [MatchKind.SIMILAR]: "nombre parecido: revíselo",
};

export const isReviewMatch = (kind: string): boolean => kind === MatchKind.SIMILAR;
