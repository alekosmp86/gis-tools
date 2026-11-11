import { describe, it, expect } from "vitest";
import { resolveFileSridForSql } from "@/core/spatial/FileSridResolver";

const UTM21S_PRJ =
  'PROJCS["WGS 84 / UTM zone 21S",GEOGCS["WGS 84",DATUM["WGS_1984",SPHEROID["WGS 84",6378137,298.257223563]],PRIMEM["Greenwich",0],UNIT["degree",0.0174532925199433]],PROJECTION["Transverse_Mercator"],PARAMETER["latitude_of_origin",0],PARAMETER["central_meridian",-57],PARAMETER["scale_factor",0.9996],PARAMETER["false_easting",500000],PARAMETER["false_northing",10000000],UNIT["metre",1],AUTHORITY["EPSG","32721"]]';

describe("resolveFileSridForSql", () => {
  it("SRID-1: should return 4326 when there is no shpBuffer and no prjText (CSV/GeoJSON)", () => {
    expect(resolveFileSridForSql({})).toBe(4326);
  });

  it("SRID-2: should return 4326 when there is no shpBuffer even if a prjText is present", () => {
    expect(resolveFileSridForSql({ shpBuffer: null, prjText: UTM21S_PRJ })).toBe(4326);
  });

  it("SRID-3: should return the .prj EPSG when a shapefile has a parseable .prj", () => {
    const result = resolveFileSridForSql({ shpBuffer: new Uint8Array([1]), prjText: UTM21S_PRJ });

    expect(result).toBe(32721);
  });

  it("SRID-4: should return undefined when a shapefile has no .prj", () => {
    expect(resolveFileSridForSql({ shpBuffer: new Uint8Array([1]) })).toBeUndefined();
    expect(resolveFileSridForSql({ shpBuffer: new Uint8Array([1]), prjText: "" })).toBeUndefined();
    expect(resolveFileSridForSql({ shpBuffer: new Uint8Array([1]), prjText: null })).toBeUndefined();
  });

  it("SRID-5: should return undefined when a shapefile has an unparseable .prj", () => {
    const result = resolveFileSridForSql({ shpBuffer: new Uint8Array([1]), prjText: "garbage" });

    expect(result).toBeUndefined();
  });
});
