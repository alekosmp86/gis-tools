import { afterEach, describe, expect, it, vi } from "vitest";
import { createIndicatorsHandlers } from "@/modules/coverage-loads/indicators/api/handlers";
import { checkDeclaredBodySize } from "@/modules/coverage-loads/indicators/api/uploadReaders";
import { MAX_BODY_BYTES } from "@/modules/coverage-loads/indicators/constants";
import { buildLoadResult } from "@/modules/coverage-loads/indicators/domain/loadResult";
import type { IndicatorsRepository } from "@/modules/coverage-loads/indicators/services/IndicatorsRepository";

const URL_BASE = "http://localhost/api/m/coverage-loads/indicators";
const TOO_LARGE_MESSAGE = `La solicitud supera el tamaño máximo de ${MAX_BODY_BYTES} bytes.`;

function requestWith(contentLength: string | null): Request {
  const headers = new Headers();
  if (contentLength !== null) headers.set("content-length", contentLength);
  return new Request(`${URL_BASE}/plan`, { method: "POST", headers });
}

function makeRepository() {
  return {
    inspectHistory: vi.fn(async () => ({ existingRowsByDate: {}, shortfalls: [] })),
    loadCuts: vi.fn(async (_connection, request) => buildLoadResult(request.cuts, [])),
    readReport: vi.fn(async () => []),
  } satisfies IndicatorsRepository;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("checkDeclaredBodySize", () => {
  it("should return the Spanish message when the declared size is above the maximum", () => {
    // Arrange & Act
    const message = checkDeclaredBodySize(requestWith(String(MAX_BODY_BYTES + 1)));

    // Assert
    expect(message).toBe(TOO_LARGE_MESSAGE);
  });

  it("should return null when the declared size is exactly the maximum", () => {
    expect(checkDeclaredBodySize(requestWith(String(MAX_BODY_BYTES)))).toBeNull();
  });

  it("should return null when the declared size is zero", () => {
    expect(checkDeclaredBodySize(requestWith("0"))).toBeNull();
  });

  it("should tolerate surrounding whitespace in the declared size", () => {
    expect(checkDeclaredBodySize(requestWith(` ${MAX_BODY_BYTES + 1} `))).toBe(TOO_LARGE_MESSAGE);
  });

  it.each([
    ["absent", null],
    ["empty", ""],
    ["whitespace only", "   "],
    ["non-numeric", "abc"],
    ["negative", "-5"],
    ["negative and huge", `-${MAX_BODY_BYTES * 2}`],
    ["decimal", "1.5"],
    ["exponent", "1e12"],
  ])("should return null when the header is %s", (_label, value) => {
    expect(checkDeclaredBodySize(requestWith(value))).toBeNull();
  });
});

describe("indicators handlers: declared body size", () => {
  it.each(["plan", "load"] as const)(
    "should answer 413 with success false on %s and never read the form when Content-Length is over the maximum",
    async (endpoint) => {
      // Arrange
      const repository = makeRepository();
      const handlers = createIndicatorsHandlers({ repository });
      const request = requestWith(String(MAX_BODY_BYTES + 1));
      const formData = vi.spyOn(request, "formData");

      // Act
      const response = await handlers[endpoint](request);

      // Assert
      expect(response.status).toBe(413);
      expect(await response.json()).toEqual({ success: false, error: TOO_LARGE_MESSAGE });
      expect(formData).not.toHaveBeenCalled();
      expect(repository.inspectHistory).not.toHaveBeenCalled();
      expect(repository.loadCuts).not.toHaveBeenCalled();
    }
  );

  it.each(["plan", "load"] as const)(
    "should read the form on %s when Content-Length is exactly the maximum",
    async (endpoint) => {
      // Arrange
      const handlers = createIndicatorsHandlers({ repository: makeRepository() });
      const request = requestWith(String(MAX_BODY_BYTES));
      const formData = vi.spyOn(request, "formData");

      // Act
      const response = await handlers[endpoint](request);

      // Assert
      expect(formData).toHaveBeenCalledTimes(1);
      expect(response.status).toBe(400);
    }
  );
});
