type Replacement = readonly [string, string];

interface ShortNameStep {
  replacements: readonly Replacement[];
  nameLike?: string;
  longerThan?: number;
}

const unconditional = (...replacements: Replacement[]): ShortNameStep => ({ replacements });

const when = (nameLike: string, longerThan: number | undefined, ...replacements: Replacement[]): ShortNameStep => ({
  replacements,
  nameLike,
  longerThan,
});

export const SHORT_NAME_STEPS: readonly ShortNameStep[] = [
  unconditional(
    ["CALLE ", "CL "], ["CAMINO ", "CNO "], ["PASAJE ", "PSJE "], ["BULEVAR ", "BV "], ["RAMBLA ", "RMBL "],
    ["AVENIDA ", "AV "], ["CONTINUACION ", "CONT "], ["SENDA ", "SDA "], ["ASENTAMIENTO ", "ASENT "]
  ),
  unconditional(
    ["GENERAL ", "GRAL "], ["DEPARTAMENTAL ", "DEP "], ["DOCTOR ", "DR "], ["INGENIERO AGRONOMO ", "ING AGR "],
    ["INGENIERO AGRIMENSOR ", "ING AGRIM "], ["INGENIERO ", "ING "], ["ARQUITECTO ", "ARQ "], ["TENIENTE CORONEL ", "TTE CNEL "]
  ),
  unconditional(
    ["CAPITAN ", "CAP "], ["MAESTRO ", "MTRO "], ["GOBERNADOR ", "GDOR "], ["DOCTORA ", "DRA "],
    ["RUTA NACIONAL ", "RUTA NAL "], ["MAESTRA ", "MTRA "], ["CNO NACIONAL ", "CNO NAL "]
  ),
  unconditional(
    ["SERVIDUMBRE ", "SBRE "], ["PRESIDENTE ", "PTE "], ["PROFESOR ", "PROF "], ["FROFESORA ", "PROFA "],
    ["CIRCUNVALACION ", "CIRC "], ["MAESTRA ", "MTRA "], ["CORONEL ", "CNEL "], ["METROS ", "MTS "]
  ),
  unconditional(
    ["PRIMER PARALELA ", "1ER PLA "], ["SEGUNDA PARALELA  ", "2DA PLA "], ["TERCER PARALELA  ", "3RA PLA "],
    ["PARALELA ", "PLA "], ["PJE VEHICULAR ", "PJE VEHIC "], ["MONSEÑOR ", "MONS "], ["ESCRIBANO ", "ESC "],
    ["PROYECTADA ", "PROY "], ["RMBL COSTANERA ", "RMBL COST "], ["PRIMERA PARALELA ", "1ERA PLA "], ["DE VIVIENDAS ", "DE VIV "]
  ),
  unconditional(["3RA PLA ", "3R PLA "], ["TERCERA PARALELA ", "3RA PLA "], ["ASOCIACION CIVIL ", "ASOC CIVIL "], ["PRESBITERO ", "PBRO "]),
  unconditional(["BRIGADIER ", "BRIG "], ["PRIMERA PLA ", "1RA PLA "], ["PEATONAL ", "PEAT "], [" METROS", " MTS"]),
  unconditional(["PSJE PEATONAL ", "PSJE PEAT "], ["BARRIO ", "B° "], ["AV COSTANERA ", "AV COST "], ["SEGUNDA ", "2DA "], ["TERCERA ", "3RA "]),
  unconditional([" WILSON FERREIRA ALDUNATE", " WILSON F ALDUNATE"], ["QUIMICO FARMACEUTICO ", "QUIM FARM "]),
  unconditional(
    ["CUARTA ", "4TA "], ["QUINTA ", "5TA "], ["SEXTA ", "6TA "], ["PRIMERA ", "1RA "], ["HERMANOS ", "HNOS  "],
    ["HERMANO ", "HNO  "], ["PRIMER ", "1ER "]
  ),
  unconditional(["AGRIMENSOR ", "AGRIM "], ["QUIMICA FARMACEUTICA ", "QUIM FARM "], [" FRANCISCO ", " FCO "], ["COMANDANTE ", "CDTE "]),
  unconditional(
    ["ESCUELA ", "ESC. "], [" ESCUELA ", " ESC. "], ["PUEBLO ", "PBLO "], ["ACCESO ", "ACC "], ["DIAGONAL ", "DIAG "],
    ["BALNEARIO ", "BALN "], ["SENDERO ", "SDRO "]
  ),
  when("%INTERBALNEARIA%", undefined, [" INTERBALNEARIA ", " INTER "]),
  when("% SAN FRANCISCO", undefined, [" FRANCISCO", " FCO"]),
  unconditional(
    [" NACIONAL ", " NAL "], [" MUNICIPAL ", " MPAL "], ["CALZADA ", "CALZ "], ["SEPTIMA ", "7MA "], ["HERMANAS ", "HNAS "],
    ["HERMANA ", "HNA "], ["AUXILIAR ", "AUX "], [" CONTADOR ", " CR "], [" ESTADOS UNIDOS ", " EEUU "], ["ARQUITECTA ", "ARQ "],
    ["PROYECTADA ", "PROY "], ["FRACCIONAMIENTO ", "FRACC "], ["INGENIERA ", "ING "], [" PARALELO ", " PLO "], ["PROCURADOR ", "PROC "]
  ),
  unconditional(
    ["ARZOBISPO ", "ARZ "], ["CONCEJAL ", "CONC "], ["FARMACEUTICO ", "FARM "], ["INVESTIGADORA ", "INV "], ["COOPERATIVA ", "COOP "],
    [" SANTA ", " STA "], ["SANTA ", "STA "], ["PLAZA ", "PZA "], ["ROTONDA ", "ROT "]
  ),
  when("% NUEVA %", undefined, [" NUEVA ", " NVA "]),
  unconditional(["COSTANERA ", "COST "], ["PARQUE ", "PQUE "], ["PROVINCIA ", "PROV "], ["CONTADOR ", "CR "]),
  when("% GRANDE", 20, [" GRANDE", " GDE"]),
  when("%FRANCISCA%", undefined, ["FRANCISCA", "FCA"]),
  when("%REPUBLICA%", 20, ["REPUBLICA", "REP"]),
  when("%JUAN MANUEL%", 20, ["JUAN MANUEL", "J M"]),
  when("%CEMENTERIO%", 20, ["CEMENTERIO", "CEM"]),
  when("%JUAN JOSE%", 20, ["JUAN JOSE", "J J"]),
  when("%ESTACION%", 20, ["ESTACION", "EST"]),
  when("%NUEVO%", 20, ["NUEVO", "NVO"]),
  when("%LATERAL%", 20, ["LATERAL", "LAT"]),
  when("% MARIA %", 20, [" MARIA ", " M "]),
  when("MARIA %", 20, ["MARIA ", "M "]),
  when("% MARIA", 20, [" MARIA", " M"]),
  when("%JOSE LUIS%", 20, ["JOSE LUIS", "J L"]),
  when("%SACERDOTE%", 20, ["SACERDOTE ", "SDTE "]),
  when("%LUIS ALBERTO%", 20, ["LUIS ALBERTO", "L A"]),
  when("%LUIS %", 20, ["LUIS ", "L "]),
  when("%JOSE %", 25, ["JOSE ", "J "]),
  when("%ANDRES%", 30, [" ANDRES ", " A "]),
  when("%ELBIO%", 20, ["ELBIO ", "E "]),
  when("%CENTRAL%", 20, ["CENTRAL ", "CTRAL "]),
  when("%DOMINGO%", 25, ["DOMINGO ", "DGO "]),
  when("%PRINCIPAL%", 20, ["PRINCIPAL ", "PPAL "]),
  when("%ESTABLECIMIENTO%", 20, ["ESTABLECIMIENTO ", "ESTAB "]),
  when("%ESTANCIA%", 20, ["ESTANCIA ", "EST "]),
  when("%DOCTOR RUFINO RODRIGUEZ%", 20, ["DR RUFINO RODRIGUEZ", "DR R RODRIGUEZ"]),
  when("%HIPOLITO YRIGOYEN%", 20, ["HIPOLITO YRIGOYEN", "H YRIGOYEN"]),
  when("%PUERTO%", 25, ["PUERTO ", "PTO "]),
  when("%ADOLFO%", 25, ["ADOLFO ", "A "]),
  when("%ROBERTO%", 25, ["ROBERTO ", "R "]),
  when("%EMPALME%", 20, ["EMPALME ", "EMP "]),
  when("%GUILLERMO%", 25, ["GUILLERMO ", "G "]),
  when("%INDUSTRIA %", 20, ["INDUSTRIA", "IND "]),
  when("%INDUSTRIAS %", 20, ["INDUSTRIAS", "INDUS "]),
  when("%ARROYO%", 25, ["ARROYO", "ARR "]),
  when("%ENTRADA%", 20, ["ENTRADA", "ENT"]),
];

const ROUTE_NAME_LIKE = "RUTA %-%";
const ROUTE_NAME_EXCLUDED_LIKES = ["% RAMAL%", "% BYPASS", "%PERIMETRAL%", "%NACIONAL%"] as const;
const ROUTE_NAME_SEPARATOR = "-";

const LIKE_SPECIAL_CHARACTERS = /[.*+?^${}()|[\]\\]/g;

function likeMatches(value: string, pattern: string): boolean {
  const source = pattern
    .split("%")
    .map((part) => part.replace(LIKE_SPECIAL_CHARACTERS, "\\$&"))
    .join(".*");
  return new RegExp(`^${source}$`, "s").test(value);
}

function applyStep(shortName: string, name: string, step: ShortNameStep): string {
  if (step.nameLike !== undefined && !likeMatches(name, step.nameLike)) return shortName;
  if (step.longerThan !== undefined && shortName.length <= step.longerThan) return shortName;
  return step.replacements.reduce((current, [from, to]) => current.split(from).join(to), shortName);
}

const isRouteName = (name: string): boolean =>
  likeMatches(name, ROUTE_NAME_LIKE) && !ROUTE_NAME_EXCLUDED_LIKES.some((pattern) => likeMatches(name, pattern));

export function shortNameOf(name: string): string {
  if (isRouteName(name)) return name.split(ROUTE_NAME_SEPARATOR)[0].trim();
  return SHORT_NAME_STEPS.reduce((shortName, step) => applyStep(shortName, name, step), name);
}
