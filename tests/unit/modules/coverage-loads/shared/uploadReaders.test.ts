import { describe, expect, it } from "vitest";
import { checkDeclaredBodySize, readFlag, readForm } from "@/modules/coverage-loads/shared/uploadReaders";

const MAX_BODY_BYTES = 1000;
const URL_BASE = "http://localhost/api/m/coverage-loads/any/plan";
const TOO_LARGE = { status: 413, message: `La solicitud supera el tamaño máximo de ${MAX_BODY_BYTES} bytes.` };
const LENGTH_REQUIRED = { status: 411, message: "La solicitud debe declarar su tamaño (encabezado Content-Length)." };

function requestWith(contentLength: string | null): Request {
  const headers = new Headers();
  if (contentLength !== null) headers.set("content-length", contentLength);
  return new Request(URL_BASE, { method: "POST", headers });
}

describe("shared upload readers (AC-26)", () => {
  describe("checkDeclaredBodySize", () => {
    it("should refuse with 413 and the Spanish message naming the cap when the declared size is above it", () => {
      // Arrange & Act
      const refusal = checkDeclaredBodySize(requestWith(String(MAX_BODY_BYTES + 1)), MAX_BODY_BYTES);

      // Assert
      expect(refusal).toEqual(TOO_LARGE);
    });

    it("should use the cap it is given, not a fixed one", () => {
      // Arrange & Act & Assert
      expect(checkDeclaredBodySize(requestWith("51"), 50)).toEqual({
        status: 413,
        message: "La solicitud supera el tamaño máximo de 50 bytes.",
      });
      expect(checkDeclaredBodySize(requestWith("51"), 51)).toBeNull();
    });

    it.each([
      ["exactly the cap", String(MAX_BODY_BYTES)],
      ["zero", "0"],
      ["a normal size", "512"],
    ])("should accept a declared size of %s", (_label, value) => {
      // Arrange & Act & Assert
      expect(checkDeclaredBodySize(requestWith(value), MAX_BODY_BYTES)).toBeNull();
    });

    it("should tolerate surrounding whitespace in the declared size", () => {
      // Arrange & Act & Assert
      expect(checkDeclaredBodySize(requestWith(` ${MAX_BODY_BYTES + 1} `), MAX_BODY_BYTES)).toEqual(TOO_LARGE);
    });

    it("should refuse with 411 when the Content-Length header is absent", () => {
      // Arrange & Act & Assert
      expect(checkDeclaredBodySize(requestWith(null), MAX_BODY_BYTES)).toEqual(LENGTH_REQUIRED);
    });

    it.each([
      ["empty", ""],
      ["whitespace only", "   "],
      ["non-numeric", "abc"],
      ["negative", "-5"],
      ["decimal", "1.5"],
      ["exponent", "1e12"],
    ])("should leave a malformed header (%s) to the form reader instead of refusing it", (_label, value) => {
      // Arrange & Act & Assert
      expect(checkDeclaredBodySize(requestWith(value), MAX_BODY_BYTES)).toBeNull();
    });
  });

  describe("readForm", () => {
    it("should return the parsed multipart form", async () => {
      // Arrange
      const form = new FormData();
      form.append("field", "value");
      const request = new Request(URL_BASE, { method: "POST", body: form });

      // Act
      const outcome = await readForm(request);

      // Assert
      expect(outcome.ok).toBe(true);
      if (outcome.ok) expect(outcome.value.get("field")).toBe("value");
    });

    it("should answer the Spanish multipart error when the body is not a form", async () => {
      // Arrange
      const request = new Request(URL_BASE, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });

      // Act
      const outcome = await readForm(request);

      // Assert
      expect(outcome).toEqual({ ok: false, error: "La solicitud debe ser un formulario multipart válido." });
    });
  });

  describe("readFlag", () => {
    it("should be true only for the exact text true", () => {
      // Arrange
      const form = new FormData();
      form.append("yes", "true");
      form.append("upper", "TRUE");
      form.append("one", "1");

      // Act & Assert
      expect(readFlag(form, "yes")).toBe(true);
      expect(readFlag(form, "upper")).toBe(false);
      expect(readFlag(form, "one")).toBe(false);
      expect(readFlag(form, "missing")).toBe(false);
    });
  });
});
