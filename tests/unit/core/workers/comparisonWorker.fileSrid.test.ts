import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const sqlCtor = vi.fn();
const generatePatches = vi.fn();

vi.mock("@/core/workers/comparison/SqlPatchGenerator", () => ({
  SqlPatchGenerator: class {
    constructor(opts: unknown) {
      sqlCtor(opts);
    }
    generatePatches(...args: unknown[]) {
      return generatePatches(...args);
    }
  },
}));
vi.mock("@/core/binary/BinaryShpReader", () => ({
  BinaryShpReader: class {},
}));
vi.mock("@/core/workers/comparison/SpatialComparisonEngine", () => ({
  SpatialComparisonEngine: class {},
}));

const UTM21S_PRJ =
  'PROJCS["WGS 84 / UTM zone 21S",GEOGCS["WGS 84",DATUM["WGS_1984",SPHEROID["WGS 84",6378137,298.257223563]],PRIMEM["Greenwich",0],UNIT["degree",0.0174532925199433]],PROJECTION["Transverse_Mercator"],PARAMETER["latitude_of_origin",0],PARAMETER["central_meridian",-57],PARAMETER["scale_factor",0.9996],PARAMETER["false_easting",500000],PARAMETER["false_northing",10000000],UNIT["metre",1],AUTHORITY["EPSG","32721"]]';

interface FakeSelf {
  onmessage: ((event: { data: unknown }) => void) | null;
  postMessage: ReturnType<typeof vi.fn>;
}

async function sendGenerateSql(fileDataset: Record<string, unknown>) {
  const fakeSelf: FakeSelf = { onmessage: null, postMessage: vi.fn() };
  vi.stubGlobal("self", fakeSelf);
  vi.resetModules();
  const { ComparisonWorkerMessageType } = await import("@/core/types/workerMessages");
  await import("@/core/workers/comparisonWorker");
  fakeSelf.onmessage!({
    data: {
      type: ComparisonWorkerMessageType.GENERATE_SQL,
      payload: {
        discrepancyItems: [],
        fileDataset,
        mappingConfig: {},
        dbSchemaName: "public",
        dbTableName: "t",
        dbColumnTypes: {},
      },
    },
  });
  return sqlCtor.mock.calls[0][0];
}

describe("comparisonWorker GENERATE_SQL fileSrid (CSV SRID bug)", () => {
  beforeEach(() => {
    sqlCtor.mockReset();
    generatePatches.mockReset();
    generatePatches.mockReturnValue({});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("SRID-9: should pass fileSrid 4326 and a null reader when the dataset has no shpBuffer", async () => {
    const opts = await sendGenerateSql({ fileName: "t.csv" });

    expect(opts.fileSrid).toBe(4326);
    expect(opts.shpReader).toBeNull();
  });

  it("SRID-10: should keep the .prj EPSG for a shapefile with a .prj", async () => {
    const opts = await sendGenerateSql({ shpBuffer: new Uint8Array([1]), prjText: UTM21S_PRJ });

    expect(opts.fileSrid).toBe(32721);
  });

  it("SRID-11: should leave fileSrid undefined for a shapefile without a .prj", async () => {
    const opts = await sendGenerateSql({ shpBuffer: new Uint8Array([1]) });

    expect(opts.fileSrid).toBeUndefined();
  });
});
