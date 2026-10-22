const ROOT_PATTERN = /^\s*(PROJCS|GEOGCS|PROJCRS|GEOGCRS)\s*\[/i;
const QUOTED_NAME_PATTERN = /^\s*"([^"]*)"\s*$/;
const AUTHORITY_PATTERN = /^\s*AUTHORITY\s*\[\s*"([^"]*)"\s*,\s*"([^"]*)"\s*\]\s*$/i;
const EPSG_AUTHORITY = "epsg";
const EPSG_CODE_PATTERN = /^\d+$/;

const Hemisphere = {
  NORTH: "N",
  SOUTH: "S",
} as const;

const ESRI_NAME_TO_SRID: ReadonlyMap<string, number> = new Map([
  ["GCS_WGS_1984", 4326],
  ["GCS_SIRGAS_2000", 4674],
  ["GCS_SIRGAS-ROU98", 5381],
  ["SIRGAS-ROU98_UTM_ZONE_21S", 5382],
  ["SIRGAS-ROU98_UTM_ZONE_22S", 5383],
]);

interface UtmZoneRule {
  readonly pattern: RegExp;
  readonly minZone: number;
  readonly maxZone: number;
  readonly northSridBase: number | null;
  readonly southSridBase: number;
}

const UTM_ZONE_RULES: ReadonlyArray<UtmZoneRule> = [
  {
    pattern: /^WGS_1984_UTM_ZONE_(\d{1,2})([NS])$/,
    minZone: 1,
    maxZone: 60,
    northSridBase: 32600,
    southSridBase: 32700,
  },
  {
    pattern: /^SIRGAS_2000_UTM_ZONE_(\d{1,2})([NS])$/,
    minZone: 18,
    maxZone: 25,
    northSridBase: null,
    southSridBase: 31960,
  },
];

interface WktRoot {
  name: string | null;
  children: string[];
}

export interface CrsDescription {
  name: string | null;
  srid: number | null;
}

function splitTopLevelItems(body: string): string[] {
  const items: string[] = [];
  let depth = 0;
  let inQuotes = false;
  let itemStart = 0;
  for (let index = 0; index < body.length; index++) {
    const character = body[index];
    if (character === '"') {
      inQuotes = !inQuotes;
    } else if (inQuotes) {
      continue;
    } else if (character === "[") {
      depth++;
    } else if (character === "]") {
      depth--;
    } else if (character === "," && depth === 0) {
      items.push(body.slice(itemStart, index));
      itemStart = index + 1;
    }
  }
  items.push(body.slice(itemStart));
  return items;
}

function parseWktRoot(wkt: string): WktRoot | null {
  const bodyStart = wkt.indexOf("[") + 1;
  const bodyEnd = wkt.lastIndexOf("]");
  if (bodyEnd < bodyStart) return null;
  const children = splitTopLevelItems(wkt.slice(bodyStart, bodyEnd));
  const nameMatch = children.map((child) => QUOTED_NAME_PATTERN.exec(child)).find(Boolean);
  const name = nameMatch ? nameMatch[1].trim() : "";
  return { name: name === "" ? null : name, children };
}

function readWktRoot(prjText: string | null | undefined): WktRoot | null {
  const wkt = prjText?.trim() ?? "";
  if (!ROOT_PATTERN.test(wkt)) return null;
  return parseWktRoot(wkt);
}

function findEpsgAuthority(children: string[]): number | null {
  const authorities = children
    .map((child) => AUTHORITY_PATTERN.exec(child))
    .filter((match): match is RegExpExecArray => match !== null);
  const epsgMatches = authorities.filter(
    (match) => match[1].toLowerCase() === EPSG_AUTHORITY && EPSG_CODE_PATTERN.test(match[2])
  );
  const lastEpsg = epsgMatches[epsgMatches.length - 1];
  return lastEpsg ? Number(lastEpsg[2]) : null;
}

function utmZoneSrid(rule: UtmZoneRule, zone: number, hemisphere: string): number | null {
  if (zone < rule.minZone || zone > rule.maxZone) return null;
  if (hemisphere === Hemisphere.SOUTH) return rule.southSridBase + zone;
  return rule.northSridBase === null ? null : rule.northSridBase + zone;
}

function resolveUtmZoneSrid(normalizedName: string): number | null {
  for (const rule of UTM_ZONE_RULES) {
    const match = rule.pattern.exec(normalizedName);
    if (match) return utmZoneSrid(rule, Number(match[1]), match[2]);
  }
  return null;
}

function resolveNameSrid(name: string | null): number | null {
  if (name === null) return null;
  const normalizedName = name.toUpperCase();
  return ESRI_NAME_TO_SRID.get(normalizedName) ?? resolveUtmZoneSrid(normalizedName);
}

function resolveRootSrid(root: WktRoot): number | null {
  return findEpsgAuthority(root.children) ?? resolveNameSrid(root.name);
}

export function describeCrsFromPrj(prjText: string | null | undefined): CrsDescription {
  const root = readWktRoot(prjText);
  if (!root) return { name: null, srid: null };
  return { name: root.name, srid: resolveRootSrid(root) };
}

export function detectSridFromPrj(prjText: string | null | undefined): number | null {
  return describeCrsFromPrj(prjText).srid;
}
