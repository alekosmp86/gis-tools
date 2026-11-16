export const LocalidadesDestination = {
  BDJ_CARTO: "bdjCarto",
  CARTO: "carto",
} as const;

export type LocalidadesDestination = (typeof LocalidadesDestination)[keyof typeof LocalidadesDestination];
