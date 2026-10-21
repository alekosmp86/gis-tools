import { describe, expect, it } from "vitest";
import { SigraLayerId, WFS_BASE_URL } from "@/modules/coverage-loads/sigra-layers/constants";
import { getSigraLayer } from "@/modules/coverage-loads/sigra-layers/domain/layerRegistry";
import { buildPageUrl, buildProbeUrl } from "@/modules/coverage-loads/sigra-layers/domain/wfsUrl";

const BASE_ORIGIN_AND_PATH = WFS_BASE_URL.split("?")[0];

describe("buildPageUrl", () => {
  it("should start with the host and path of the WFS base URL", () => {
    const layer = getSigraLayer(SigraLayerId.ZONAS_FTTH);

    const url = buildPageUrl(layer, 0);

    expect(url.startsWith(BASE_ORIGIN_AND_PATH)).toBe(true);
    expect(new URL(url).host).toBe("vmlx-sgrabal-prod");
    expect(new URL(url).pathname).toBe("/geoserver/ows");
  });

  it("should carry the base WFS params", () => {
    const layer = getSigraLayer(SigraLayerId.ZONAS_FTTH);

    const params = new URL(buildPageUrl(layer, 0)).searchParams;

    expect(params.get("service")).toBe("WFS");
    expect(params.get("version")).toBe("2.0.0");
    expect(params.get("request")).toBe("GetFeature");
    expect(params.get("outputFormat")).toBe("application/json");
  });

  it("should carry typeName, sortBy, count and startIndex of the layer", () => {
    const layer = getSigraLayer(SigraLayerId.ZONAS_FTTH);

    const params = new URL(buildPageUrl(layer, 0)).searchParams;

    expect(params.get("typeName")).toBe("WFS_SI:AREA_ZONA_FTTH_F");
    expect(params.get("sortBy")).toBe("ID_AREA");
    expect(params.get("count")).toBe("2000");
    expect(params.get("startIndex")).toBe("0");
  });

  it("should omit CQL_FILTER when the layer has no cql", () => {
    const layer = getSigraLayer(SigraLayerId.ZONAS_FTTH);

    const params = new URL(buildPageUrl(layer, 0)).searchParams;

    expect(params.has("CQL_FILTER")).toBe(false);
  });

  it("should use the requested startIndex", () => {
    const layer = getSigraLayer(SigraLayerId.CAMARAS);

    const first = new URL(buildPageUrl(layer, 0)).searchParams;
    const later = new URL(buildPageUrl(layer, 4000)).searchParams;

    expect(first.get("startIndex")).toBe("0");
    expect(later.get("startIndex")).toBe("4000");
    expect(later.get("count")).toBe("5000");
  });

  it.each([
    SigraLayerId.LIMITE_CENTRAL_FTTH,
    SigraLayerId.CENTRALES_FTTH,
    SigraLayerId.LIMITE_MIXTO_COBRE,
    SigraLayerId.LIMITE_CENTRAL_COBRE,
    SigraLayerId.LIMITE_ECONOMICO_COBRE,
    SigraLayerId.CENTRALES_COBRE,
    SigraLayerId.ZONAS_INSEGURIDAD,
  ])("should round-trip the raw cql of %s through URL encoding", (layerId) => {
    const layer = getSigraLayer(layerId);

    const params = new URL(buildPageUrl(layer, 0)).searchParams;

    expect(layer.cql).not.toBeNull();
    expect(params.get("CQL_FILTER")).toBe(layer.cql);
  });

  it("should decode the limite-central-ftth cql with spaces, quotes and percent exactly", () => {
    const layer = getSigraLayer(SigraLayerId.LIMITE_CENTRAL_FTTH);

    const url = buildPageUrl(layer, 2000);
    const params = new URL(url).searchParams;

    expect(params.get("CQL_FILTER")).toBe("CR_SITE_TYPE_ID=9 AND CENTRAL_NOMBRE LIKE '%FTTH'");
    expect(url).not.toContain(" ");
    expect(url).not.toContain("LIKE '%FTTH'");
  });

  it("should decode the centrales-ftth cql exactly", () => {
    const layer = getSigraLayer(SigraLayerId.CENTRALES_FTTH);

    const params = new URL(buildPageUrl(layer, 0)).searchParams;

    expect(params.get("CQL_FILTER")).toBe("TIPO_DE_CENTRAL='CENTRAL FTTH' AND NOMBRE LIKE '%FTTH'");
  });

  it("should keep the LIMTE_MIXTO spelling in the limite-mixto-cobre cql", () => {
    const layer = getSigraLayer(SigraLayerId.LIMITE_MIXTO_COBRE);

    const params = new URL(buildPageUrl(layer, 0)).searchParams;

    expect(params.get("CQL_FILTER")).toBe("AREA_TIPO='LIMTE_MIXTO'");
  });

  it("should not duplicate the base params", () => {
    const layer = getSigraLayer(SigraLayerId.LIMITE_CENTRAL_FTTH);

    const params = new URL(buildPageUrl(layer, 0)).searchParams;

    for (const name of ["service", "version", "request", "outputFormat", "typeName", "sortBy", "count", "startIndex", "CQL_FILTER"]) {
      expect(params.getAll(name)).toHaveLength(1);
    }
  });

  it("should use the page size of the layer given", () => {
    const layer = { ...getSigraLayer(SigraLayerId.POSTES), pageSize: 7 };

    const params = new URL(buildPageUrl(layer, 14)).searchParams;

    expect(params.get("count")).toBe("7");
    expect(params.get("startIndex")).toBe("14");
  });
});

describe("buildProbeUrl", () => {
  it("should ask for a single feature from the start index 0", () => {
    const layer = getSigraLayer(SigraLayerId.POSTES);

    const params = new URL(buildProbeUrl(layer)).searchParams;

    expect(params.get("count")).toBe("1");
    expect(params.get("startIndex")).toBe("0");
  });

  it("should be the first page URL with only count changed", () => {
    for (const id of Object.values(SigraLayerId)) {
      const layer = getSigraLayer(id);

      const page = new URL(buildPageUrl(layer, 0));
      const probe = new URL(buildProbeUrl(layer));
      page.searchParams.set("count", "1");

      expect(probe.toString()).toBe(page.toString());
    }
  });

  it("should carry the typeName, sortBy and base params of the layer", () => {
    const layer = getSigraLayer(SigraLayerId.ZONAS_FTTH);

    const params = new URL(buildProbeUrl(layer)).searchParams;

    expect(params.get("typeName")).toBe("WFS_SI:AREA_ZONA_FTTH_F");
    expect(params.get("sortBy")).toBe("ID_AREA");
    expect(params.get("service")).toBe("WFS");
    expect(params.get("outputFormat")).toBe("application/json");
    expect(params.has("CQL_FILTER")).toBe(false);
  });

  it("should round-trip the raw cql of the layer exactly", () => {
    const layer = getSigraLayer(SigraLayerId.LIMITE_CENTRAL_FTTH);

    const url = buildProbeUrl(layer);

    expect(new URL(url).searchParams.get("CQL_FILTER")).toBe("CR_SITE_TYPE_ID=9 AND CENTRAL_NOMBRE LIKE '%FTTH'");
    expect(url).not.toContain(" ");
  });

  it("should ignore the page size of the layer", () => {
    const layer = { ...getSigraLayer(SigraLayerId.CAMARAS), pageSize: 7 };

    expect(new URL(buildProbeUrl(layer)).searchParams.get("count")).toBe("1");
  });
});
