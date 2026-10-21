import { describe, expect, it } from "vitest";
import { SigraLayerId } from "@/modules/coverage-loads/sigra-layers/constants";
import { getSigraLayer } from "@/modules/coverage-loads/sigra-layers/domain/layerRegistry";
import { buildProbeUrl } from "@/modules/coverage-loads/sigra-layers/domain/wfsUrl";
import { probeLayers } from "@/modules/coverage-loads/sigra-layers/services/probeLayers";
import type { WfsPage, WfsPageFetcher } from "@/modules/coverage-loads/sigra-layers/types";

type Answer = WfsPage | Error | string;

/** Answers by layer typeName+cql (read from the URL), records every URL asked. */
class FakeFetcher implements WfsPageFetcher {
  public readonly urls: string[] = [];

  constructor(private readonly answers: Readonly<Record<string, Answer>>) {}

  async fetchPage(url: string): Promise<WfsPage> {
    this.urls.push(url);
    const params = new URL(url).searchParams;
    const answer = this.answers[`${params.get("typeName")}|${params.get("CQL_FILTER") ?? ""}`];
    if (answer === undefined) return { features: [], numberMatched: null };
    if (typeof answer === "string") throw answer;
    if (answer instanceof Error) throw answer;
    return answer;
  }
}

const ZONAS = getSigraLayer(SigraLayerId.ZONAS_FTTH);
const LIMITE = getSigraLayer(SigraLayerId.LIMITE_CENTRAL_FTTH);
const POSTES = getSigraLayer(SigraLayerId.POSTES);
const keyOf = (layer: { typeName: string; cql: string | null }) => `${layer.typeName}|${layer.cql ?? ""}`;
const page = (numberMatched: number | null): WfsPage => ({ features: [], numberMatched });

describe("probeLayers (AC-1)", () => {
  it("should request the probe URL of each layer, once", async () => {
    // Arrange
    const fetcher = new FakeFetcher({});

    // Act
    await probeLayers([ZONAS, LIMITE], fetcher);

    // Assert
    expect(fetcher.urls).toEqual([buildProbeUrl(ZONAS), buildProbeUrl(LIMITE)]);
  });

  it("should return numberMatched per layer in the input order", async () => {
    // Arrange
    const fetcher = new FakeFetcher({
      [keyOf(POSTES)]: page(120000),
      [keyOf(ZONAS)]: page(512),
      [keyOf(LIMITE)]: page(40),
    });

    // Act
    const probes = await probeLayers([POSTES, ZONAS, LIMITE], fetcher);

    // Assert
    expect(probes).toEqual([
      { layerId: SigraLayerId.POSTES, numberMatched: 120000, error: null },
      { layerId: SigraLayerId.ZONAS_FTTH, numberMatched: 512, error: null },
      { layerId: SigraLayerId.LIMITE_CENTRAL_FTTH, numberMatched: 40, error: null },
    ]);
  });

  it("should report numberMatched null with no error when the response has no count", async () => {
    // Arrange
    const fetcher = new FakeFetcher({ [keyOf(ZONAS)]: page(null) });

    // Act
    const probes = await probeLayers([ZONAS], fetcher);

    // Assert
    expect(probes).toEqual([{ layerId: SigraLayerId.ZONAS_FTTH, numberMatched: null, error: null }]);
  });

  it("should report zero as a real count, not as missing", async () => {
    // Arrange
    const fetcher = new FakeFetcher({ [keyOf(ZONAS)]: page(0) });

    // Act
    const probes = await probeLayers([ZONAS], fetcher);

    // Assert
    expect(probes[0].numberMatched).toBe(0);
  });

  it("should turn a failing request into a Spanish error text and keep probing the others", async () => {
    // Arrange
    const fetcher = new FakeFetcher({
      [keyOf(ZONAS)]: new Error("El WFS de SIGRA respondio con el estado HTTP 503."),
      [keyOf(LIMITE)]: page(40),
    });

    // Act
    const probes = await probeLayers([ZONAS, LIMITE], fetcher);

    // Assert
    expect(probes[0]).toMatchObject({ layerId: SigraLayerId.ZONAS_FTTH, numberMatched: null });
    expect(typeof probes[0].error).toBe("string");
    expect((probes[0].error ?? "").length).toBeGreaterThan(0);
    expect(probes[1]).toEqual({ layerId: SigraLayerId.LIMITE_CENTRAL_FTTH, numberMatched: 40, error: null });
  });

  it("should not throw when the failure is not an Error object", async () => {
    // Arrange
    const fetcher = new FakeFetcher({ [keyOf(ZONAS)]: "timeout" });

    // Act
    const probes = await probeLayers([ZONAS], fetcher);

    // Assert
    expect(probes).toHaveLength(1);
    expect(probes[0].numberMatched).toBeNull();
    expect((probes[0].error ?? "").length).toBeGreaterThan(0);
  });

  it("should return no probes and make no request for an empty list", async () => {
    // Arrange
    const fetcher = new FakeFetcher({});

    // Act
    const probes = await probeLayers([], fetcher);

    // Assert
    expect(probes).toEqual([]);
    expect(fetcher.urls).toEqual([]);
  });

  it("should use the layer's own typeName and cql, not a shared URL", async () => {
    // Arrange
    const fetcher = new FakeFetcher({});

    // Act
    await probeLayers([LIMITE], fetcher);

    // Assert
    const params = new URL(fetcher.urls[0]).searchParams;
    expect(params.get("typeName")).toBe(LIMITE.typeName);
    expect(params.get("CQL_FILTER")).toBe(LIMITE.cql);
    expect(params.get("count")).toBe("1");
  });
});
