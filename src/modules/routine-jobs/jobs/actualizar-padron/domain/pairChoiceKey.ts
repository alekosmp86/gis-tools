export interface PairChoiceKeyFields {
  typePadron: string | null;
  provinceId: number | null;
  localityId: number | null;
  number: string | null;
}

/** Identity of a new padron key: the same key text names the same group in the API parser and in the wizard. */
export const pairChoiceKeyId = (key: PairChoiceKeyFields): string =>
  JSON.stringify([key.typePadron, key.provinceId, key.localityId, key.number]);
