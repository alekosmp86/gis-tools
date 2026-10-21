import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WFS_REQUEST_TIMEOUT_MS } from "@/modules/coverage-loads/sigra-layers/constants";
import {
  WfsRequestError,
  createWfsPageFetcher,
} from "@/modules/coverage-loads/sigra-layers/services/WfsClient";

const PAGE_URL = "http://vmlx-sgrabal-prod/geoserver/ows?service=WFS&typeName=WFS_SI:POSTES_F&startIndex=0";

const fetchMock = vi.fn<typeof fetch>();
const sleepMock = vi.fn<(ms: number) => Promise<void>>();

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function textResponse(body: string, status = 200): Response {
  return new Response(body, { status });
}

function buildFetcher(overrides: { timeoutMs?: number; maxRetries?: number } = {}) {
  return createWfsPageFetcher({ fetchImpl: fetchMock, sleep: sleepMock, ...overrides });
}

const SAMPLE_FEATURE = { geometry: { type: "Point", coordinates: [1, 2] }, properties: { ID: 7 } };

beforeEach(() => {
  fetchMock.mockReset();
  sleepMock.mockReset();
  sleepMock.mockResolvedValue(undefined);
});

describe("createWfsPageFetcher", () => {
  describe("successful responses", () => {
    it("should return the features and numberMatched of a valid page", async () => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse({ features: [SAMPLE_FEATURE, { geometry: null, properties: { ID: 8 } }], numberMatched: 289000 }),
      );

      const page = await buildFetcher().fetchPage(PAGE_URL);

      expect(page.numberMatched).toBe(289000);
      expect(page.features).toHaveLength(2);
      expect(page.features[0]).toEqual({ geometry: { type: "Point", coordinates: [1, 2] }, properties: { ID: 7 } });
      expect(page.features[1].geometry).toBeNull();
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(sleepMock).not.toHaveBeenCalled();
    });

    it("should return numberMatched null when the response omits it", async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse({ features: [SAMPLE_FEATURE] }));

      const page = await buildFetcher().fetchPage(PAGE_URL);

      expect(page.numberMatched).toBeNull();
      expect(page.features).toHaveLength(1);
    });

    it("should return an empty feature list for an empty page", async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse({ features: [], numberMatched: 0 }));

      const page = await buildFetcher().fetchPage(PAGE_URL);

      expect(page.features).toEqual([]);
    });

    it("should request the exact url given", async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse({ features: [] }));

      await buildFetcher().fetchPage(PAGE_URL);

      expect(String(fetchMock.mock.calls[0][0])).toBe(PAGE_URL);
    });

    it("should pass an AbortSignal to fetch", async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse({ features: [] }));

      await buildFetcher({ timeoutMs: 5000 }).fetchPage(PAGE_URL);

      const init = fetchMock.mock.calls[0][1] as RequestInit | undefined;
      expect(init?.signal).toBeInstanceOf(AbortSignal);
    });
  });

  describe("retries", () => {
    it("should retry a network error and succeed on the second attempt", async () => {
      fetchMock
        .mockRejectedValueOnce(new TypeError("fetch failed"))
        .mockResolvedValueOnce(jsonResponse({ features: [SAMPLE_FEATURE], numberMatched: 1 }));

      const page = await buildFetcher({ maxRetries: 2 }).fetchPage(PAGE_URL);

      expect(page.features).toHaveLength(1);
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(sleepMock).toHaveBeenCalledTimes(1);
    });

    it("should retry an HTTP 5xx and succeed on the third attempt", async () => {
      fetchMock
        .mockResolvedValueOnce(textResponse("boom", 503))
        .mockResolvedValueOnce(textResponse("boom", 500))
        .mockResolvedValueOnce(jsonResponse({ features: [], numberMatched: 0 }));

      const page = await buildFetcher({ maxRetries: 2 }).fetchPage(PAGE_URL);

      expect(page.features).toEqual([]);
      expect(fetchMock).toHaveBeenCalledTimes(3);
      expect(sleepMock).toHaveBeenCalledTimes(2);
    });

    it("should throw WfsRequestError after maxRetries + 1 attempts when every call returns 5xx", async () => {
      fetchMock.mockImplementation(async () => textResponse("boom", 502));

      const outcome = buildFetcher({ maxRetries: 2 }).fetchPage(PAGE_URL);

      await expect(outcome).rejects.toBeInstanceOf(WfsRequestError);
      expect(fetchMock).toHaveBeenCalledTimes(3);
      expect(sleepMock).toHaveBeenCalledTimes(2);
    });

    it("should throw WfsRequestError after maxRetries + 1 attempts when every call rejects", async () => {
      fetchMock.mockImplementation(async () => {
        throw new TypeError("fetch failed");
      });

      const outcome = buildFetcher({ maxRetries: 2 }).fetchPage(PAGE_URL);

      await expect(outcome).rejects.toBeInstanceOf(WfsRequestError);
      expect(fetchMock).toHaveBeenCalledTimes(3);
      expect(sleepMock).toHaveBeenCalledTimes(2);
    });

    it("should not retry when maxRetries is 0", async () => {
      fetchMock.mockImplementation(async () => textResponse("boom", 500));

      const outcome = buildFetcher({ maxRetries: 0 }).fetchPage(PAGE_URL);

      await expect(outcome).rejects.toBeInstanceOf(WfsRequestError);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(sleepMock).not.toHaveBeenCalled();
    });

    it("should retry once when maxRetries is 1", async () => {
      fetchMock.mockImplementation(async () => textResponse("boom", 500));

      const outcome = buildFetcher({ maxRetries: 1 }).fetchPage(PAGE_URL);

      await expect(outcome).rejects.toBeInstanceOf(WfsRequestError);
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(sleepMock).toHaveBeenCalledTimes(1);
    });

    it("should default to 2 retries (3 attempts) when maxRetries is not given", async () => {
      fetchMock.mockImplementation(async () => textResponse("boom", 500));

      const outcome = createWfsPageFetcher({ fetchImpl: fetchMock, sleep: sleepMock }).fetchPage(PAGE_URL);

      await expect(outcome).rejects.toBeInstanceOf(WfsRequestError);
      expect(fetchMock).toHaveBeenCalledTimes(3);
    });
  });

  describe("non-retryable failures", () => {
    it.each([400, 401, 404])("should throw WfsRequestError without retrying on HTTP %i", async (status) => {
      fetchMock.mockResolvedValue(textResponse("nope", status));

      const outcome = buildFetcher({ maxRetries: 2 }).fetchPage(PAGE_URL);

      await expect(outcome).rejects.toBeInstanceOf(WfsRequestError);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(sleepMock).not.toHaveBeenCalled();
    });

    it("should throw WfsRequestError when the body is not JSON", async () => {
      fetchMock.mockResolvedValue(textResponse("<ServiceExceptionReport/>", 200));

      const outcome = buildFetcher({ maxRetries: 0 }).fetchPage(PAGE_URL);

      await expect(outcome).rejects.toBeInstanceOf(WfsRequestError);
    });

    it("should throw WfsRequestError when the JSON has no features array", async () => {
      fetchMock.mockResolvedValue(jsonResponse({ numberMatched: 5 }));

      const outcome = buildFetcher({ maxRetries: 0 }).fetchPage(PAGE_URL);

      await expect(outcome).rejects.toBeInstanceOf(WfsRequestError);
    });

    it("should throw WfsRequestError when features is not an array", async () => {
      fetchMock.mockResolvedValue(jsonResponse({ features: "none" }));

      const outcome = buildFetcher({ maxRetries: 0 }).fetchPage(PAGE_URL);

      await expect(outcome).rejects.toBeInstanceOf(WfsRequestError);
    });

    it("should throw WfsRequestError when the JSON body is null", async () => {
      fetchMock.mockResolvedValue(jsonResponse(null));

      const outcome = buildFetcher({ maxRetries: 0 }).fetchPage(PAGE_URL);

      await expect(outcome).rejects.toBeInstanceOf(WfsRequestError);
    });
  });

  describe("error messages", () => {
    it("should raise an Error with a non-empty message", async () => {
      fetchMock.mockResolvedValue(textResponse("nope", 404));

      const failure = await buildFetcher().fetchPage(PAGE_URL).catch((error: unknown) => error);

      expect(failure).toBeInstanceOf(WfsRequestError);
      expect(failure).toBeInstanceOf(Error);
      expect((failure as Error).message.trim().length).toBeGreaterThan(0);
    });

    it("should not leak the full request url with its query in the message", async () => {
      fetchMock.mockResolvedValue(textResponse("nope", 404));

      const failure = await buildFetcher().fetchPage(PAGE_URL).catch((error: unknown) => error);

      expect((failure as Error).message).not.toContain(PAGE_URL);
      expect((failure as Error).message).not.toContain("startIndex=0");
    });
  });
});

describe("createWfsPageFetcher request timeout", () => {
  const OK = () => jsonResponse({ features: [SAMPLE_FEATURE], numberMatched: 1 });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should arm AbortSignal.timeout with WFS_REQUEST_TIMEOUT_MS by default", async () => {
    // Arrange
    const timeout = vi.spyOn(AbortSignal, "timeout");
    fetchMock.mockResolvedValueOnce(OK());

    // Act
    await createWfsPageFetcher({ fetchImpl: fetchMock, sleep: sleepMock }).fetchPage(PAGE_URL);

    // Assert
    expect(timeout).toHaveBeenCalledTimes(1);
    expect(timeout).toHaveBeenCalledWith(WFS_REQUEST_TIMEOUT_MS);
  });

  it("should arm a fresh timeout with the same value on every retry attempt", async () => {
    // Arrange
    const timeout = vi.spyOn(AbortSignal, "timeout");
    fetchMock
      .mockResolvedValueOnce(textResponse("down", 503))
      .mockResolvedValueOnce(textResponse("down", 503))
      .mockResolvedValueOnce(OK());

    // Act
    await createWfsPageFetcher({ fetchImpl: fetchMock, sleep: sleepMock }).fetchPage(PAGE_URL);

    // Assert
    expect(timeout).toHaveBeenCalledTimes(3);
    expect(timeout.mock.calls.every(([ms]) => ms === WFS_REQUEST_TIMEOUT_MS)).toBe(true);
  });

  it("should use the custom timeoutMs option when given, on every attempt", async () => {
    // Arrange
    const timeout = vi.spyOn(AbortSignal, "timeout");
    fetchMock.mockRejectedValueOnce(new TypeError("fetch failed")).mockResolvedValueOnce(OK());

    // Act
    await createWfsPageFetcher({ fetchImpl: fetchMock, sleep: sleepMock, timeoutMs: 1234 }).fetchPage(PAGE_URL);

    // Assert
    expect(timeout).toHaveBeenCalledTimes(2);
    expect(timeout.mock.calls.map(([ms]) => ms)).toEqual([1234, 1234]);
  });

  it.each(["TimeoutError", "AbortError"])("should retry a fetch rejected with a %s DOMException like a network error", async (name) => {
    // Arrange
    fetchMock.mockRejectedValueOnce(new DOMException("signal timed out", name)).mockResolvedValueOnce(OK());

    // Act
    const page = await createWfsPageFetcher({ fetchImpl: fetchMock, sleep: sleepMock }).fetchPage(PAGE_URL);

    // Assert
    expect(page.features).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(sleepMock).toHaveBeenCalledTimes(1);
  });

  it("should give up with a WfsRequestError after the retries when every attempt times out", async () => {
    // Arrange
    fetchMock.mockImplementation(async () => {
      throw new DOMException("signal timed out", "TimeoutError");
    });

    // Act
    const failure = await createWfsPageFetcher({ fetchImpl: fetchMock, sleep: sleepMock }).fetchPage(PAGE_URL).catch((error: unknown) => error);

    // Assert
    expect(failure).toBeInstanceOf(WfsRequestError);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});
