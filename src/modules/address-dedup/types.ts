import type { Decision, DecisionFilter, DecisionReason, DedupScope, FILTER_ALL } from "./constants";

export interface DbConnection {
  readonly host: string;
  readonly port: number;
  readonly db_name: string;
  readonly user: string;
  readonly password: string;
}

/** The eight bound parameters of the analysis query, named. Order lives in the query module. */
export interface DuplicateAnalysisParameters {
  readonly detectionFuentes: ReadonlyArray<string>;
  readonly provinceId: number;
  readonly removableFuentes: ReadonlyArray<string>;
  readonly protectedFuentes: ReadonlyArray<string>;
  readonly geoDecimalsWithPadron: number;
  readonly geoDecimalsWithoutPadron: number;
  readonly protectedSiblingRemovesLone: boolean;
  readonly scope: DedupScope;
}

/** One output row of the analysis query. Keys mirror the SQL columns, so CSV headers match v3. */
export interface AnalysisRow {
  readonly group_id: number;
  readonly fuente: string;
  readonly urn: string;
  readonly province: string | null;
  readonly locality: string | null;
  readonly street_name: string | null;
  readonly street_number: string | null;
  readonly letter: string | null;
  readonly square: string | null;
  readonly sandlot: string | null;
  readonly km: string | null;
  readonly padron: string | null;
  readonly type_padron: string | null;
  readonly postal_code: string | null;
  readonly lat: number | null;
  readonly lng: number | null;
  readonly document_type: string | null;
  readonly matched_serv_cto_tlk: boolean;
  readonly matched_nap_physical_device: boolean;
  readonly dup_group_size: number;
  readonly n_matched_in_group: number;
  readonly pool_rank_in_group: number | null;
  readonly decision: Decision;
  readonly decision_reason: DecisionReason;
  readonly block: string | null;
  readonly tower: string | null;
  readonly floor: string | null;
  readonly unit: string | null;
  readonly code_country: string | null;
  readonly name_country: string | null;
  readonly id_province: number | null;
  readonly raw_rs_censal_locality_name: string | null;
  readonly raw_rs_censal_locality_code: string | null;
  readonly rs_cadastral_locality_name: string | null;
  readonly rs_idcalle: string | null;
  readonly raw_rs_name: string | null;
  readonly rs_reftramo: string | null;
  readonly rs_short_name: string | null;
  readonly raw_number: string | null;
  readonly side: string | null;
  readonly raw_padron_number: string | null;
  readonly province_code: string | null;
  readonly padron_locality: string | null;
  readonly padron_locality_or_geo: string | null;
  readonly match_key: string;
}

export type AnalysisTextField = {
  [Field in keyof AnalysisRow]: AnalysisRow[Field] extends string | null ? Field : never;
}[keyof AnalysisRow];

export interface AnalysisGroup {
  readonly groupId: number;
  readonly rows: ReadonlyArray<AnalysisRow>;
}

export interface DedupSummary {
  readonly groupCount: number;
  readonly rowCount: number;
  readonly byDecisionAndFuente: Readonly<Record<string, Readonly<Record<string, number>>>>;
  readonly byReason: Readonly<Record<string, number>>;
}

export interface DedupRequest {
  readonly connection: DbConnection;
  readonly provinceId: number;
  readonly protectedSiblingRemovesLone?: boolean;
  readonly scope?: DedupScope;
}

export interface DedupResult {
  readonly rows: ReadonlyArray<AnalysisRow>;
  readonly summary: DedupSummary;
}

export interface RepositoryRequest {
  readonly connection: DbConnection;
  readonly parameters: DuplicateAnalysisParameters;
}

/** Body the browser posts to `analyze` and `export`. Port is text because it comes from a form field. */
export interface DedupRequestPayload {
  readonly connection: {
    readonly host: string;
    readonly port: string;
    readonly db_name: string;
    readonly user: string;
    readonly password: string;
  };
  readonly provinceId: number;
  readonly protectedSiblingRemovesLone: boolean;
  readonly scope: DedupScope;
}

export interface AnalyzeResponsePayload {
  readonly summary: DedupSummary;
  readonly groups: ReadonlyArray<AnalysisGroup>;
  readonly skippedWithoutCoordinates: number;
}

export interface GroupFilterCriteria {
  readonly search: string;
  readonly decision: DecisionFilter;
  readonly reason: DecisionReason | typeof FILTER_ALL;
  /** A raw fuente value (`""` is the rows with no fuente), or the "all" sentinel. */
  readonly fuente: string;
  readonly reviewOnly: boolean;
}

export interface DecisionCounts {
  readonly keep: number;
  readonly remove: number;
}

export interface SelectOption<TValue extends string> {
  readonly value: TValue;
  readonly label: string;
}
