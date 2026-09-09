import { describe, it, expect } from "vitest";
import {
  describePendingCount,
  formatFileSize,
  formatPublicationDate,
} from "@/modules/cartography-watcher/domain/formatters";

describe("formatFileSize", () => {
  it("should render bytes without decimals", () => {
    expect(formatFileSize(512)).toBe("512 B");
  });

  it("should step up to the next unit at its boundary", () => {
    expect(formatFileSize(1023)).toBe("1023 B");
    expect(formatFileSize(1024)).toBe("1.0 KB");
    expect(formatFileSize(1024 * 1024)).toBe("1.0 MB");
    expect(formatFileSize(1024 * 1024 * 1024)).toBe("1.0 GB");
  });

  it("should drop the decimal once the number is large enough not to need it", () => {
    expect(formatFileSize(150 * 1024)).toBe("150 KB");
  });

  it("should stay in gigabytes rather than inventing a larger unit", () => {
    expect(formatFileSize(5 * 1024 * 1024 * 1024)).toBe("5.0 GB");
  });

  it("should describe an unknown or absent size", () => {
    expect(formatFileSize(null)).toBe("Tamaño desconocido");
    expect(formatFileSize(undefined)).toBe("Tamaño desconocido");
    expect(formatFileSize(Number.NaN)).toBe("Tamaño desconocido");
  });

  it("should render an empty file as zero rather than a fraction", () => {
    expect(formatFileSize(0)).toBe("0 B");
  });
});

describe("formatPublicationDate", () => {
  it("should render a portal timestamp as a fixed day/month/year", () => {
    expect(formatPublicationDate("2026-09-03T12:58:02.027248Z")).toBe("03/09/2026");
  });

  it("should pad single digits so the width never shifts", () => {
    expect(formatPublicationDate("2026-01-05T00:00:00.000Z")).toBe("05/01/2026");
  });

  it("should describe a missing or unusable timestamp", () => {
    expect(formatPublicationDate(null)).toBe("Sin fecha");
    expect(formatPublicationDate("")).toBe("Sin fecha");
    expect(formatPublicationDate("no-es-una-fecha")).toBe("Sin fecha");
  });
});

describe("describePendingCount", () => {
  it("should use the singular for exactly one pending file", () => {
    expect(describePendingCount(1)).toBe("1 archivo pendiente");
  });

  it("should use the plural beyond one", () => {
    expect(describePendingCount(20)).toBe("20 archivos pendientes");
  });

  it("should report nothing pending as good news, not as a zero", () => {
    expect(describePendingCount(0)).toBe("Sin novedades");
    expect(describePendingCount(-1)).toBe("Sin novedades");
  });
});
