import { beforeEach, describe, expect, it, vi } from "vitest";
import { SigraLayerId } from "@/modules/coverage-loads/sigra-layers/constants";
import { getSigraLayer } from "@/modules/coverage-loads/sigra-layers/domain/layerRegistry";
import type { WfsFeature } from "@/modules/coverage-loads/sigra-layers/domain/featureMapping";
import { readLayerPages } from "@/modules/coverage-loads/sigra-layers/services/readLayerPages";
import type { WfsPage } from "@/modules/coverage-loads/sigra-layers/services/WfsClient";

const TINY_LAYER = { ...getSigraLayer(SigraLayerId.POSTES), pageSize: 2 };

function featureWithId(id: number): WfsFeature {
  return { geometry: null, properties: { ID: id } };
}

function pageOf(...ids: number[]): WfsPage {
  return { features: ids.map(featureWithId), numberMatched: null };
}

function startIndexOf(url: string): string | null {
  return new URL(url).searchParams.get("startIndex");
}

const fetchPageMock = vi.fn<(url: string) => Promise<WfsPage>>();

async function collect(): Promise<WfsFeature[][]> {
  const pages: WfsFeature[][] = [];
  for await (const features of readLayerPages(TINY_LAYER, { fetchPage: fetchPageMock })) {
    pages.push([...features]);
  }
  return pages;
}

beforeEach(() => {
  fetchPageMock.mockReset();
});

describe("readLayerPages", () => {
  it("should stop after one request when the first page is shorter than pageSize", async () => {
    fetchPageMock.mockResolvedValueOnce(pageOf(1));

    const pages = await collect();

    expect(fetchPageMock).toHaveBeenCalledTimes(1);
    expect(pages).toEqual([[featureWithId(1)]]);
  });

  it("should request startIndex 0 first with the layer page size", async () => {
    fetchPageMock.mockResolvedValueOnce(pageOf(1));

    await collect();

    const params = new URL(fetchPageMock.mock.calls[0][0]).searchParams;
    expect(params.get("startIndex")).toBe("0");
    expect(params.get("count")).toBe("2");
    expect(params.get("typeName")).toBe("WFS_SI:POSTES_F");
  });

  it("should request a second page and stop after a full page followed by a short page", async () => {
    fetchPageMock.mockResolvedValueOnce(pageOf(1, 2)).mockResolvedValueOnce(pageOf(3));

    const pages = await collect();

    expect(fetchPageMock).toHaveBeenCalledTimes(2);
    expect(startIndexOf(fetchPageMock.mock.calls[0][0])).toBe("0");
    expect(startIndexOf(fetchPageMock.mock.calls[1][0])).toBe("2");
    expect(pages).toHaveLength(2);
    expect(pages[1]).toEqual([featureWithId(3)]);
  });

  it("should advance startIndex by pageSize across several full pages", async () => {
    fetchPageMock
      .mockResolvedValueOnce(pageOf(1, 2))
      .mockResolvedValueOnce(pageOf(3, 4))
      .mockResolvedValueOnce(pageOf(5, 6))
      .mockResolvedValueOnce(pageOf(7));

    await collect();

    const startIndexes = fetchPageMock.mock.calls.map(([url]) => startIndexOf(url));
    expect(startIndexes).toEqual(["0", "2", "4", "6"]);
  });

  it("should request one more page after an exactly full last page and not yield the empty page", async () => {
    fetchPageMock.mockResolvedValueOnce(pageOf(1, 2)).mockResolvedValueOnce(pageOf());

    const pages = await collect();

    expect(fetchPageMock).toHaveBeenCalledTimes(2);
    expect(startIndexOf(fetchPageMock.mock.calls[1][0])).toBe("2");
    expect(pages).toEqual([[featureWithId(1), featureWithId(2)]]);
  });

  it("should yield nothing and make one request when the first page is empty", async () => {
    fetchPageMock.mockResolvedValueOnce(pageOf());

    const pages = await collect();

    expect(fetchPageMock).toHaveBeenCalledTimes(1);
    expect(pages).toEqual([]);
  });

  it("should preserve feature order across pages", async () => {
    fetchPageMock
      .mockResolvedValueOnce(pageOf(10, 20))
      .mockResolvedValueOnce(pageOf(30, 40))
      .mockResolvedValueOnce(pageOf(50));

    const pages = await collect();

    const orderedIds = pages.flat().map((feature) => feature.properties.ID);
    expect(orderedIds).toEqual([10, 20, 30, 40, 50]);
  });

  it("should propagate a page error after the previous page was yielded", async () => {
    const failure = new Error("WFS caido");
    fetchPageMock.mockResolvedValueOnce(pageOf(1, 2)).mockRejectedValueOnce(failure);
    const yielded: WfsFeature[][] = [];

    const consume = async (): Promise<void> => {
      for await (const features of readLayerPages(TINY_LAYER, { fetchPage: fetchPageMock })) {
        yielded.push([...features]);
      }
    };

    await expect(consume()).rejects.toBe(failure);
    expect(yielded).toEqual([[featureWithId(1), featureWithId(2)]]);
    expect(fetchPageMock).toHaveBeenCalledTimes(2);
  });

  it("should propagate an error on the first page without yielding", async () => {
    fetchPageMock.mockRejectedValueOnce(new Error("sin red"));

    await expect(collect()).rejects.toThrow("sin red");
  });

  it("should not request pages ahead of the consumer", async () => {
    fetchPageMock.mockResolvedValueOnce(pageOf(1, 2)).mockResolvedValueOnce(pageOf(3));
    const generator = readLayerPages(TINY_LAYER, { fetchPage: fetchPageMock });

    await generator.next();

    expect(fetchPageMock).toHaveBeenCalledTimes(1);
  });
});
