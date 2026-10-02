import { describe, expect, it } from "vitest";
import { ExportFormat } from "@/modules/address-dedup/constants";
import {
  buildExportFilename,
  countWithoutCoordinates,
  EXPORT_COLUMNS,
  groupsToGeoJsonLinks,
  rowsToCsv,
  rowsToGeoJsonPoints,
} from "@/modules/address-dedup/domain/export";
import { groupRows } from "@/modules/address-dedup/domain/groups";
import { makeRow } from "./rowFactory";

const HEADER = EXPORT_COLUMNS.join(",");

function bodyLines(csv: string): string[] {
  return csv.split("\r\n").slice(1, -1);
}

describe("rowsToCsv", () => {
  it("should emit only the header, CRLF terminated, for empty input", () => {
    // Arrange & Act
    const csv = rowsToCsv([]);

    // Assert
    expect(csv).toBe(`${HEADER}\r\n`);
  });

  it("should keep the v3 header byte-identical, without the match key display columns", () => {
    // Arrange
    const expectedHeader = [
      "group_id,fuente,urn,province,locality,street_name,street_number,letter,square,sandlot,km,padron,type_padron,postal_code",
      "lat,lng,document_type,matched_serv_cto_tlk,matched_nap_physical_device,dup_group_size,n_matched_in_group,pool_rank_in_group",
      "decision,decision_reason,block,tower,floor,unit,code_country,name_country,id_province,raw_rs_censal_locality_name",
      "raw_rs_censal_locality_code,rs_cadastral_locality_name,rs_idcalle,raw_rs_name,rs_reftramo,rs_short_name,raw_number,side,raw_padron_number",
    ].join(",");

    // Act
    const header = rowsToCsv([]).split("\r\n")[0];

    // Assert
    expect(header).toBe(expectedHeader);
  });

  it("should include decision and decision_reason in the header", () => {
    // Arrange & Act
    const header = rowsToCsv([]).split("\r\n")[0].split(",");

    // Assert
    expect(header).toContain("decision");
    expect(header).toContain("decision_reason");
  });

  it("should separate records with CRLF and end with one", () => {
    // Arrange
    const rows = [makeRow({ urn: "a" }), makeRow({ urn: "b" })];

    // Act
    const csv = rowsToCsv(rows);

    // Assert
    expect(csv.endsWith("\r\n")).toBe(true);
    expect(csv.split("\r\n")).toHaveLength(4);
  });

  it("should quote cells with commas, double the quotes, and quote embedded newlines", () => {
    // Arrange
    const rows = [makeRow({ street_name: 'CALLE "A", 5', locality: "LINEA\nDOS" })];

    // Act
    const csv = rowsToCsv(rows);

    // Assert
    expect(csv).toContain('"CALLE ""A"", 5"');
    expect(csv).toContain('"LINEA\nDOS"');
  });

  it("should quote cells with leading or trailing spaces", () => {
    // Arrange
    const rows = [makeRow({ street_name: " PADDED ", locality: "PLAIN" })];

    // Act
    const csv = rowsToCsv(rows);

    // Assert
    expect(csv).toContain('" PADDED "');
    expect(csv).not.toContain('"PLAIN"');
  });

  it("should render null values as empty cells", () => {
    // Arrange
    const rows = [makeRow({ street_name: null, lat: null })];

    // Act
    const [line] = bodyLines(rowsToCsv(rows));
    const cells = line.split(",");

    // Assert
    expect(cells[EXPORT_COLUMNS.indexOf("street_name")]).toBe("");
    expect(cells[EXPORT_COLUMNS.indexOf("lat")]).toBe("");
  });
});

describe("rowsToGeoJsonPoints", () => {
  it("should leave the match key display columns out of the Point properties", () => {
    // Arrange
    const rows = [makeRow({ urn: "ok" })];

    // Act
    const properties = rowsToGeoJsonPoints(rows).featureCollection.features[0].properties ?? {};

    // Assert
    expect(Object.keys(properties)).toEqual([...EXPORT_COLUMNS]);
  });

  it("should emit Points in [lng, lat] order with every field and decision_reason in properties", () => {
    // Arrange
    const rows = [makeRow({ lat: -33.5, lng: -56.7 })];

    // Act
    const { featureCollection, skippedWithoutCoordinates } = rowsToGeoJsonPoints(rows);

    // Assert
    expect(featureCollection.features).toHaveLength(1);
    expect(featureCollection.features[0].geometry.coordinates).toEqual([-56.7, -33.5]);
    expect(featureCollection.features[0].properties).toMatchObject({
      urn: rows[0].urn,
      decision: rows[0].decision,
      decision_reason: rows[0].decision_reason,
    });
    expect(skippedWithoutCoordinates).toBe(0);
  });

  it("should skip null and NaN coordinates and count them", () => {
    // Arrange
    const rows = [
      makeRow({ urn: "ok" }),
      makeRow({ urn: "null-lat", lat: null }),
      makeRow({ urn: "null-lng", lng: null }),
      makeRow({ urn: "nan", lat: Number.NaN }),
    ];

    // Act
    const { featureCollection, skippedWithoutCoordinates } = rowsToGeoJsonPoints(rows);

    // Assert
    expect(featureCollection.features.map((feature) => feature.properties?.urn)).toEqual(["ok"]);
    expect(skippedWithoutCoordinates).toBe(3);
    expect(countWithoutCoordinates(rows)).toBe(3);
  });

  it("should return an empty collection for empty input", () => {
    // Arrange & Act
    const { featureCollection, skippedWithoutCoordinates } = rowsToGeoJsonPoints([]);

    // Assert
    expect(featureCollection.features).toEqual([]);
    expect(skippedWithoutCoordinates).toBe(0);
  });
});

describe("groupsToGeoJsonLinks", () => {
  it("should emit one LineString per group with two or more locatable members", () => {
    // Arrange
    const groups = groupRows([
      makeRow({ group_id: 1, urn: "a", lat: -33.1, lng: -56.1 }),
      makeRow({ group_id: 1, urn: "b", lat: -33.2, lng: -56.2 }),
      makeRow({ group_id: 1, urn: "c", lat: -33.3, lng: -56.3 }),
    ]);

    // Act
    const links = groupsToGeoJsonLinks(groups);

    // Assert
    expect(links.features).toHaveLength(1);
    expect(links.features[0].geometry.coordinates).toEqual([
      [-56.1, -33.1],
      [-56.2, -33.2],
      [-56.3, -33.3],
    ]);
    expect(links.features[0].properties).toEqual({ groupId: 1, size: 3 });
  });

  it("should skip groups with fewer than two locatable members", () => {
    // Arrange
    const groups = groupRows([
      makeRow({ group_id: 1, urn: "a" }),
      makeRow({ group_id: 1, urn: "b", lat: null }),
      makeRow({ group_id: 2, urn: "c", lat: null }),
      makeRow({ group_id: 2, urn: "d", lng: Number.NaN }),
    ]);

    // Act
    const links = groupsToGeoJsonLinks(groups);

    // Assert
    expect(links.features).toEqual([]);
  });

  it("should return an empty collection for no groups", () => {
    // Arrange & Act & Assert
    expect(groupsToGeoJsonLinks([]).features).toEqual([]);
  });
});

describe("buildExportFilename", () => {
  it.each([
    [ExportFormat.CSV, "address-dedup-provincia-7.csv"],
    [ExportFormat.GEOJSON, "address-dedup-provincia-7.geojson"],
    [ExportFormat.LINKS, "address-dedup-provincia-7_links.geojson"],
  ])("should name the %s export file", (format, expected) => {
    // Arrange & Act & Assert
    expect(buildExportFilename(7, format)).toBe(expected);
  });
});
