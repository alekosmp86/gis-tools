import { describe, expect, it } from "vitest";
import { readUploadHeaders } from "@/modules/coverage-loads/shp/api/uploadHeaders";
import { UPLOAD_CAP_BYTES } from "@/modules/coverage-loads/shp/job/constants.ts";
import { uploadRequest } from "../helpers/apiTestEnv";

describe("readUploadHeaders", () => {
  it("should decode the percent-encoded file name and parse the size when everything is valid", () => {
    // Arrange
    const request = uploadRequest({ fileName: "LTEUruguay_20260131.shp", size: "1234" });

    // Act
    const result = readUploadHeaders(request);

    // Assert
    expect(result).toEqual({
      ok: true,
      value: {
        fileName: "LTEUruguay_20260131.shp",
        sizeBytes: 1234,
        target: { table: "lte", prefix: "LTEUruguay", fechaact: "2026-01-31" },
      },
    });
  });

  it("should URL-decode x-file-name before validating it", () => {
    // Arrange
    const request = new Request("http://localhost/x", {
      method: "POST",
      headers: { "content-type": "application/octet-stream", "x-file-name": "NRUruguay%5F20260228.shp", "x-file-size": "10" },
      body: new Uint8Array([1]),
    });

    // Act
    const result = readUploadHeaders(request);

    // Assert
    expect(result.ok && result.value.fileName).toBe("NRUruguay_20260228.shp");
  });

  it("should accept a content type with parameters after octet-stream", () => {
    // Arrange
    const request = uploadRequest({ contentType: "application/octet-stream; charset=binary", size: 5 });

    // Act & Assert
    expect(readUploadHeaders(request).ok).toBe(true);
  });

  it("should refuse a wrong content type", () => {
    // Arrange
    const request = uploadRequest({ contentType: "multipart/form-data", size: 5 });

    // Act
    const result = readUploadHeaders(request);

    // Assert
    expect(result).toMatchObject({ ok: false, tooLarge: false });
    expect(!result.ok && result.error).toContain("application/octet-stream");
  });

  it("should refuse a request without content type", () => {
    // Arrange
    const request = uploadRequest({ contentType: null, size: 5 });

    // Act & Assert
    expect(readUploadHeaders(request).ok).toBe(false);
  });

  it("should refuse a request without a body", () => {
    // Arrange
    const request = uploadRequest({ body: null, size: 5 });

    // Act
    const result = readUploadHeaders(request);

    // Assert
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error).toBe("La solicitud no contiene el archivo.");
  });

  it("should refuse a missing x-file-name", () => {
    // Arrange
    const request = uploadRequest({ fileName: null, size: 5 });

    // Act
    const result = readUploadHeaders(request);

    // Assert
    expect(!result.ok && result.error).toContain("x-file-name");
  });

  it("should refuse a name that is not valid percent-encoding", () => {
    // Arrange
    const request = new Request("http://localhost/x", {
      method: "POST",
      headers: { "content-type": "application/octet-stream", "x-file-name": "%E0%A4%A", "x-file-size": "10" },
      body: new Uint8Array([1]),
    });

    // Act
    const result = readUploadHeaders(request);

    // Assert
    expect(result.ok).toBe(false);
  });

  it("should refuse a file name that does not follow the Prefix_aaaammdd.shp convention", () => {
    // Arrange
    const request = uploadRequest({ fileName: "mapa.shp", size: 5 });

    // Act
    const result = readUploadHeaders(request);

    // Assert
    expect(result).toMatchObject({ ok: false, tooLarge: false });
    expect(!result.ok && result.error).toContain("mapa.shp");
  });

  it("should refuse a path-like file name", () => {
    // Arrange
    const request = uploadRequest({ fileName: "../LTEUruguay_20260131.shp", size: 5 });

    // Act & Assert
    expect(readUploadHeaders(request).ok).toBe(false);
  });

  it.each([
    ["missing", null],
    ["empty", ""],
    ["zero", "0"],
    ["negative", "-5"],
    ["fractional", "1.5"],
    ["text", "abc"],
    ["hex", "0x10"],
    ["exponent", "1e3"],
    ["unsafe integer", "99999999999999999999999"],
  ])("should refuse a %s x-file-size", (_label, size) => {
    // Arrange
    const request = uploadRequest({ size });

    // Act
    const result = readUploadHeaders(request);

    // Assert
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error).toContain("x-file-size");
    expect(!result.ok && result.tooLarge).toBe(false);
  });

  it("should accept exactly the 4 GiB cap", () => {
    // Arrange
    const request = uploadRequest({ size: UPLOAD_CAP_BYTES });

    // Act
    const result = readUploadHeaders(request);

    // Assert
    expect(result.ok && result.value.sizeBytes).toBe(UPLOAD_CAP_BYTES);
  });

  it("should flag a size one byte over 4 GiB as too large", () => {
    // Arrange
    const request = uploadRequest({ size: UPLOAD_CAP_BYTES + 1 });

    // Act
    const result = readUploadHeaders(request);

    // Assert
    expect(result).toMatchObject({ ok: false, tooLarge: true });
    expect(!result.ok && result.error).toContain("4 GiB");
  });

  it("should accept a size of one byte", () => {
    // Arrange
    const request = uploadRequest({ size: 1 });

    // Act & Assert
    expect(readUploadHeaders(request).ok).toBe(true);
  });

  it("should trim whitespace around the size", () => {
    // Arrange
    const request = uploadRequest({ size: "  77 " });

    // Act
    const result = readUploadHeaders(request);

    // Assert
    expect(result.ok && result.value.sizeBytes).toBe(77);
  });
});
