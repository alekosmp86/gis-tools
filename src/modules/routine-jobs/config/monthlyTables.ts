const BDJ_CARTO = "bdj_carto";
const CARTO = "carto";

export interface MonthlyTable {
  schema: string;
  table: string;
}

const bdjCartoTable = (table: string): MonthlyTable => ({ schema: BDJ_CARTO, table });
const cartoTable = (table: string): MonthlyTable => ({ schema: CARTO, table });

/** Table pickers prefill from here. A value seeded by an earlier stage always wins; a default missing from the schema is cleared by the picker. */
export const MONTHLY_TABLES = {
  cargarPadrones: {
    schema: BDJ_CARTO,
    rural: "catastro_paisrural",
    urbano: "catastro_paisurbano",
    target: "paispadron",
  },
  cargarLocalidades: {
    padron: bdjCartoTable("paispadron"),
    locality: bdjCartoTable("catastro_paislocalidades"),
    province: cartoTable("province"),
    targetBdjCarto: bdjCartoTable("cadastral_locality"),
    targetCarto: cartoTable("cadastral_locality"),
  },
  actualizarUnidades: {
    locality: cartoTable("cadastral_locality"),
    type: cartoTable("territorial_unit_type"),
    target: cartoTable("territorial_unit"),
  },
  completarUnidades: {
    unit: cartoTable("territorial_unit"),
    addressMaster: cartoTable("addresses_master"),
  },
  actualizarPadrones: {
    staging: bdjCartoTable("paispadron"),
    target: cartoTable("padron"),
    province: cartoTable("province"),
    locality: cartoTable("territorial_unit"),
    type: cartoTable("territorial_unit_type"),
    addressMaster: cartoTable("addresses_master"),
  },
} as const;
