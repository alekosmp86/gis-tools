import { describe, it, expect } from "vitest";
import { describeCrsFromPrj, detectSridFromPrj } from "@/core/services/shpSrid";

const SIRGAS_UTM_21S_WKT =
  'PROJCS["SIRGAS 2000 / UTM zone 21S",GEOGCS["SIRGAS 2000",DATUM["Sistema_de_Referencia_Geocentrico_para_las_Americas_2000",SPHEROID["GRS 1980",6378137,298.257222101,AUTHORITY["EPSG","7019"]],AUTHORITY["EPSG","6674"]],PRIMEM["Greenwich",0,AUTHORITY["EPSG","8901"]],UNIT["degree",0.0174532925199433,AUTHORITY["EPSG","9122"]],AUTHORITY["EPSG","4674"]],PROJECTION["Transverse_Mercator"],PARAMETER["latitude_of_origin",0],PARAMETER["central_meridian",-63],PARAMETER["scale_factor",0.9996],PARAMETER["false_easting",500000],PARAMETER["false_northing",10000000],UNIT["metre",1,AUTHORITY["EPSG","9001"]],AXIS["Easting",EAST],AXIS["Northing",NORTH],AUTHORITY["EPSG","31981"]]';

const WGS84_GEOGRAPHIC_WKT =
  'GEOGCS["WGS 84",DATUM["WGS_1984",SPHEROID["WGS 84",6378137,298.257223563,AUTHORITY["EPSG","7030"]],AUTHORITY["EPSG","6326"]],PRIMEM["Greenwich",0,AUTHORITY["EPSG","8901"]],UNIT["degree",0.0174532925199433,AUTHORITY["EPSG","9122"]],AUTHORITY["EPSG","4326"]]';

const ESRI_WGS84_UTM_21S_WKT =
  'PROJCS["WGS_1984_UTM_Zone_21S",GEOGCS["GCS_WGS_1984",DATUM["D_WGS_1984",SPHEROID["WGS_1984",6378137,298.257223563]],PRIMEM["Greenwich",0],UNIT["Degree",0.017453292519943295]],PROJECTION["Transverse_Mercator"],PARAMETER["false_easting",500000],PARAMETER["false_northing",10000000],PARAMETER["central_meridian",-63],PARAMETER["scale_factor",0.9996],PARAMETER["latitude_of_origin",0],UNIT["Meter",1]]';

const esriProjcs = (name: string): string =>
  `PROJCS["${name}",GEOGCS["GCS_X",DATUM["D_X",SPHEROID["S",6378137,298.257]],PRIMEM["Greenwich",0],UNIT["Degree",0.017453292519943295]],PROJECTION["Transverse_Mercator"],UNIT["Meter",1]]`;

describe("shpSrid", () => {
  describe("detectSridFromPrj", () => {
    describe("EPSG authority", () => {
      it("should return the EPSG code of the last top-level AUTHORITY when the CRS is projected", () => {
        expect(detectSridFromPrj(SIRGAS_UTM_21S_WKT)).toBe(31981);
      });

      it("should return the EPSG code of the CRS when the CRS is geographic", () => {
        expect(detectSridFromPrj(WGS84_GEOGRAPHIC_WKT)).toBe(4326);
      });

      it("should ignore nested AUTHORITY nodes of datum, spheroid and unit when no top-level one exists", () => {
        const nestedOnly =
          'GEOGCS["X",DATUM["D",SPHEROID["S",6378137,298.257,AUTHORITY["EPSG","7030"]],AUTHORITY["EPSG","6326"]],UNIT["degree",0.0174,AUTHORITY["EPSG","9122"]]]';
        expect(detectSridFromPrj(nestedOnly)).toBeNull();
      });

      it("should parse the authority when whitespace and newlines surround it", () => {
        const multiline = `PROJCS["SIRGAS 2000 / UTM zone 21S",\n\tGEOGCS["SIRGAS 2000",\n\t\tAUTHORITY [ "EPSG" , "4674" ]],\n\tAUTHORITY [ "EPSG" ,  "31981" ]\n]`;
        expect(detectSridFromPrj(multiline)).toBe(31981);
      });

      it("should parse a lowercase authority keyword and lowercase authority name", () => {
        expect(detectSridFromPrj('projcs["X",authority["epsg","31982"]]')).toBe(31982);
      });

      it("should prefer the top-level EPSG authority over a name that suggests another CRS", () => {
        const conflicting =
          'PROJCS["SIRGAS_2000_UTM_Zone_21S",GEOGCS["GCS_SIRGAS_2000",DATUM["D_SIRGAS_2000",SPHEROID["GRS_1980",6378137,298.257222101]],PRIMEM["Greenwich",0],UNIT["Degree",0.0174532925199433]],PROJECTION["Transverse_Mercator"],AUTHORITY["EPSG","31982"]]';
        expect(detectSridFromPrj(conflicting)).toBe(31982);
      });

      it("should return null when the only top-level authority is not EPSG", () => {
        expect(detectSridFromPrj('PROJCS["X",GEOGCS["Y"],AUTHORITY["ESRI","102033"]]')).toBeNull();
      });
    });

    describe("ESRI name table fallback", () => {
      it("should return 32721 for WGS_1984_UTM_Zone_21S when no authority is present", () => {
        expect(detectSridFromPrj(ESRI_WGS84_UTM_21S_WKT)).toBe(32721);
      });

      it("should return 32720 for WGS_1984_UTM_Zone_20S", () => {
        expect(detectSridFromPrj(esriProjcs("WGS_1984_UTM_Zone_20S"))).toBe(32720);
      });

      it("should return 31981 for SIRGAS_2000_UTM_Zone_21S", () => {
        expect(detectSridFromPrj(esriProjcs("SIRGAS_2000_UTM_Zone_21S"))).toBe(31981);
      });

      it("should return 31982 for SIRGAS_2000_UTM_Zone_22S", () => {
        expect(detectSridFromPrj(esriProjcs("SIRGAS_2000_UTM_Zone_22S"))).toBe(31982);
      });

      it("should return 5382 for SIRGAS-ROU98_UTM_Zone_21S", () => {
        expect(detectSridFromPrj(esriProjcs("SIRGAS-ROU98_UTM_Zone_21S"))).toBe(5382);
      });

      it("should return 5383 for SIRGAS-ROU98_UTM_Zone_22S", () => {
        expect(detectSridFromPrj(esriProjcs("SIRGAS-ROU98_UTM_Zone_22S"))).toBe(5383);
      });

      it("should return null for SIRGAS-ROU98 UTM zones other than 21S and 22S", () => {
        expect(detectSridFromPrj(esriProjcs("SIRGAS-ROU98_UTM_Zone_20S"))).toBeNull();
        expect(detectSridFromPrj(esriProjcs("SIRGAS-ROU98_UTM_Zone_21N"))).toBeNull();
      });

      it("should return 5381 for the GEOGCS name GCS_SIRGAS-ROU98", () => {
        const geographic = 'GEOGCS["GCS_SIRGAS-ROU98",DATUM["D_SIRGAS-ROU98",SPHEROID["WGS_1984",6378137.0,298.257223563]],PRIMEM["Greenwich",0.0],UNIT["Degree",0.0174532925199433]]';
        expect(detectSridFromPrj(geographic)).toBe(5381);
      });

      it("should return 4326 for the GEOGCS name GCS_WGS_1984", () => {
        const geographic = 'GEOGCS["GCS_WGS_1984",DATUM["D_WGS_1984",SPHEROID["WGS_1984",6378137,298.257223563]],PRIMEM["Greenwich",0],UNIT["Degree",0.0174532925199433]]';
        expect(detectSridFromPrj(geographic)).toBe(4326);
      });

      it("should return 4674 for the GEOGCS name GCS_SIRGAS_2000", () => {
        const geographic = 'GEOGCS["GCS_SIRGAS_2000",DATUM["D_SIRGAS_2000",SPHEROID["GRS_1980",6378137,298.257222101]],PRIMEM["Greenwich",0],UNIT["Degree",0.0174532925199433]]';
        expect(detectSridFromPrj(geographic)).toBe(4674);
      });

      it("should match the name table across newlines and indentation", () => {
        const multiline = 'PROJCS["WGS_1984_UTM_Zone_21S",\n  GEOGCS[\n    "GCS_WGS_1984",\n    DATUM["D_WGS_1984",SPHEROID["WGS_1984",6378137,298.257223563]]\n  ]\n]';
        expect(detectSridFromPrj(multiline)).toBe(32721);
      });

      it.each([
        ["WGS_1984_UTM_Zone_1N", 32601],
        ["WGS_1984_UTM_Zone_19S", 32719],
        ["WGS_1984_UTM_Zone_60N", 32660],
        ["WGS_1984_UTM_Zone_60S", 32760],
      ])("should return the WGS 84 UTM EPSG code for %s on the zone boundaries and inside the range", (name, srid) => {
        expect(detectSridFromPrj(esriProjcs(name))).toBe(srid);
      });

      it.each(["WGS_1984_UTM_Zone_0N", "WGS_1984_UTM_Zone_61N", "WGS_1984_UTM_Zone_99S"])(
        "should return null for %s because the zone number is out of range",
        (name) => {
          expect(detectSridFromPrj(esriProjcs(name))).toBeNull();
        }
      );

      it.each([
        ["SIRGAS_2000_UTM_Zone_18S", 31978],
        ["SIRGAS_2000_UTM_Zone_25S", 31985],
      ])("should return the SIRGAS 2000 UTM EPSG code for %s on the zone boundaries", (name, srid) => {
        expect(detectSridFromPrj(esriProjcs(name))).toBe(srid);
      });

      it.each(["SIRGAS_2000_UTM_Zone_17S", "SIRGAS_2000_UTM_Zone_26S"])(
        "should return null for %s because the zone is outside the supported SIRGAS 2000 south range",
        (name) => {
          expect(detectSridFromPrj(esriProjcs(name))).toBeNull();
        }
      );

      it.each(["SIRGAS_2000_UTM_Zone_21N", "SIRGAS_2000_UTM_Zone_18N"])(
        "should return null for SIRGAS 2000 north zone %s because north zones are not mapped",
        (name) => {
          expect(detectSridFromPrj(esriProjcs(name))).toBeNull();
        }
      );

      it("should return null for a UTM name without a hemisphere letter", () => {
        expect(detectSridFromPrj(esriProjcs("WGS_1984_UTM_Zone_21X"))).toBeNull();
      });

      it("should match projected names case-insensitively", () => {
        expect(detectSridFromPrj(esriProjcs("wgs_1984_utm_zone_21s"))).toBe(32721);
        expect(detectSridFromPrj(esriProjcs("sirgas_2000_utm_zone_22s"))).toBe(31982);
      });

      it("should match geographic names case-insensitively", () => {
        const geographic = 'GEOGCS["gcs_wgs_1984",DATUM["D_WGS_1984",SPHEROID["WGS_1984",6378137,298.257223563]]]';
        expect(detectSridFromPrj(geographic)).toBe(4326);
      });

      it("should tolerate whitespace surrounding the projected and geographic names", () => {
        const projected = 'PROJCS[" WGS_1984_UTM_Zone_21S ",GEOGCS["GCS_WGS_1984"]]';
        const geographic = 'GEOGCS[" GCS_SIRGAS-ROU98 ",DATUM["D_SIRGAS-ROU98"]]';
        expect(detectSridFromPrj(projected)).toBe(32721);
        expect(detectSridFromPrj(geographic)).toBe(5381);
      });

      it("should prefer the PROJCS name over the nested GEOGCS name", () => {
        const projectedOverGeographic =
          'PROJCS["WGS_1984_UTM_Zone_21S",GEOGCS["GCS_SIRGAS-ROU98",DATUM["D_SIRGAS-ROU98",SPHEROID["S",6378137,298.257]]],PROJECTION["Transverse_Mercator"],UNIT["Meter",1]]';
        expect(detectSridFromPrj(projectedOverGeographic)).toBe(32721);
      });

      it("should prefer the EPSG authority over a SIRGAS-ROU98 name", () => {
        const conflicting =
          'PROJCS["SIRGAS-ROU98_UTM_Zone_21S",GEOGCS["GCS_SIRGAS-ROU98",DATUM["D_SIRGAS-ROU98",SPHEROID["S",6378137,298.257]]],PROJECTION["Transverse_Mercator"],AUTHORITY["EPSG","31981"]]';
        expect(detectSridFromPrj(conflicting)).toBe(31981);
      });

      it("should return null for an unknown GEOGCS name", () => {
        const geographic = 'GEOGCS["GCS_ETRS_1989",DATUM["D_ETRS_1989",SPHEROID["GRS_1980",6378137,298.257222101]]]';
        expect(detectSridFromPrj(geographic)).toBeNull();
      });
    });

    describe("empty and malformed input", () => {
      it("should return null when the prj text is null", () => {
        expect(detectSridFromPrj(null)).toBeNull();
      });

      it("should return null when the prj text is undefined", () => {
        expect(detectSridFromPrj(undefined)).toBeNull();
      });

      it("should return null when the prj text is empty", () => {
        expect(detectSridFromPrj("")).toBeNull();
      });

      it("should return null when the prj text is whitespace only", () => {
        expect(detectSridFromPrj("   \n\t  ")).toBeNull();
      });

      it("should return null when the text is not WKT", () => {
        expect(detectSridFromPrj("esto no es un prj")).toBeNull();
      });

      it("should return null when the text is a plain EPSG label rather than WKT", () => {
        expect(detectSridFromPrj("EPSG:31981")).toBeNull();
      });
    });
  });

  describe("describeCrsFromPrj", () => {
    describe("name", () => {
      it("should return the PROJCS name when the projection is an ESRI UTM name", () => {
        expect(describeCrsFromPrj(ESRI_WGS84_UTM_21S_WKT).name).toBe("WGS_1984_UTM_Zone_21S");
      });

      it("should return the PROJCS name with spaces when the CRS carries an EPSG authority", () => {
        expect(describeCrsFromPrj(SIRGAS_UTM_21S_WKT).name).toBe("SIRGAS 2000 / UTM zone 21S");
      });

      it("should return the GEOGCS name when the CRS is geographic", () => {
        expect(describeCrsFromPrj(WGS84_GEOGRAPHIC_WKT).name).toBe("WGS 84");
      });

      it("should return the name of a WKT2 PROJCRS root", () => {
        const wkt2 = 'PROJCRS["WGS 84 / UTM zone 21S",BASEGEOGCRS["WGS 84",DATUM["World Geodetic System 1984"]],CONVERSION["UTM zone 21S"]]';
        expect(describeCrsFromPrj(wkt2).name).toBe("WGS 84 / UTM zone 21S");
      });

      it("should return a null name when the root has no quoted name, ignoring nested GEOGCS names", () => {
        const unnamedRoot = 'PROJCS[UNKNOWN,GEOGCS["GCS_WGS_1984",DATUM["D_WGS_1984"]]]';
        expect(describeCrsFromPrj(unnamedRoot).name).toBeNull();
      });

      it("should return the name even when no SRID can be resolved", () => {
        expect(describeCrsFromPrj(esriProjcs("Custom Local Grid"))).toEqual({
          name: "Custom Local Grid",
          srid: null,
        });
      });
    });

    describe("srid", () => {
      it("should return the SRID resolved from the ESRI name table", () => {
        expect(describeCrsFromPrj(ESRI_WGS84_UTM_21S_WKT).srid).toBe(32721);
      });

      it("should return the SRID from the EPSG authority", () => {
        expect(describeCrsFromPrj(SIRGAS_UTM_21S_WKT).srid).toBe(31981);
      });

      it("should return 5382 with its name for SIRGAS-ROU98_UTM_Zone_21S", () => {
        expect(describeCrsFromPrj(esriProjcs("SIRGAS-ROU98_UTM_Zone_21S"))).toEqual({
          name: "SIRGAS-ROU98_UTM_Zone_21S",
          srid: 5382,
        });
      });

      it("should return 5381 with its name for the GEOGCS GCS_SIRGAS-ROU98 user prj", () => {
        const userPrj =
          'GEOGCS["GCS_SIRGAS-ROU98",DATUM["D_SIRGAS-ROU98",SPHEROID["WGS_1984",6378137.0,298.257223563]],PRIMEM["Greenwich",0.0],UNIT["Degree",0.0174532925199433]]';
        expect(describeCrsFromPrj(userPrj)).toEqual({ name: "GCS_SIRGAS-ROU98", srid: 5381 });
      });
    });

    describe("empty and malformed input", () => {
      it("should return null name and null srid when the prj text is null", () => {
        expect(describeCrsFromPrj(null)).toEqual({ name: null, srid: null });
      });

      it("should return null name and null srid when the prj text is undefined", () => {
        expect(describeCrsFromPrj(undefined)).toEqual({ name: null, srid: null });
      });

      it("should return null name and null srid when the prj text is empty", () => {
        expect(describeCrsFromPrj("")).toEqual({ name: null, srid: null });
      });

      it("should return null name and null srid when the prj text is whitespace only", () => {
        expect(describeCrsFromPrj("   \n\t  ")).toEqual({ name: null, srid: null });
      });

      it("should return null name and null srid when the text is not WKT", () => {
        expect(describeCrsFromPrj("esto no es un prj")).toEqual({ name: null, srid: null });
      });

      it("should return null name and null srid when the text is a plain EPSG label", () => {
        expect(describeCrsFromPrj("EPSG:31981")).toEqual({ name: null, srid: null });
      });
    });
  });
});
