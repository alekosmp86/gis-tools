import { describe, expect, it } from "vitest";
import { createDedupHandlers } from "@/modules/address-dedup/api/handlers";
import { Decision, DecisionReason, DedupScope } from "@/modules/address-dedup/constants";
import { DedupOrchestrator } from "@/modules/address-dedup/services/DedupOrchestrator";
import type { AddressRepository } from "@/modules/address-dedup/services/AddressRepository";
import type { AnalysisRow, RepositoryRequest } from "@/modules/address-dedup/types";
import { makeRow } from "./rowFactory";

const PASSWORD = "hunter2-very-secret";
const BASE_URL = "http://localhost/api/m/address-dedup";

const VALID_BODY = {
  connection: { host: "db.example", port: "5432", db_name: "carto", user: "reader", password: PASSWORD },
  provinceId: 7,
};

class FakeRepository implements AddressRepository {
  public readonly received: RepositoryRequest[] = [];

  constructor(private readonly rows: AnalysisRow[] = [], private readonly failure?: Error) {}

  async runDuplicateAnalysis(request: RepositoryRequest): Promise<AnalysisRow[]> {
    this.received.push(request);
    if (this.failure) throw this.failure;
    return this.rows;
  }
}

function handlersFor(repository: FakeRepository) {
  return createDedupHandlers(new DedupOrchestrator(repository));
}

function post(path: string, body: unknown, query = ""): Request {
  return new Request(`${BASE_URL}/${path}${query}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

function withConnection(overrides: Record<string, unknown>) {
  return { ...VALID_BODY, connection: { ...VALID_BODY.connection, ...overrides } };
}

const PAIR = [
  makeRow({ group_id: 1, urn: "a", decision: Decision.KEEP, decision_reason: DecisionReason.LOWEST_URN_KEPT }),
  makeRow({ group_id: 1, urn: "b", decision: Decision.REMOVE, decision_reason: DecisionReason.REDUNDANT_NOT_LOWEST_URN, lat: null }),
];

describe("address dedup handlers", () => {
  describe("validation", () => {
    it.each([
      ["db_name", withConnection({ db_name: "" })],
      ["user", withConnection({ user: " " })],
      ["password", withConnection({ password: "" })],
    ])("should answer 400 in Spanish when %s is missing", async (_field, body) => {
      // Arrange
      const handlers = handlersFor(new FakeRepository());

      // Act
      const response = await handlers.analyze(post("analyze", body));
      const payload = await response.json();

      // Assert
      expect(response.status).toBe(400);
      expect(payload.success).toBe(false);
      expect(payload.error).toMatch(/obligatori/);
    });

    it.each([0, -3, 1.5, "7", null])("should answer 400 for provinceId %s", async (provinceId) => {
      // Arrange
      const handlers = handlersFor(new FakeRepository());

      // Act
      const response = await handlers.analyze(post("analyze", { ...VALID_BODY, provinceId }));

      // Assert
      expect(response.status).toBe(400);
      expect((await response.json()).error).toContain("provincia");
    });

    it("should answer 400 for an unknown scope", async () => {
      // Arrange
      const handlers = handlersFor(new FakeRepository());

      // Act
      const response = await handlers.analyze(post("analyze", { ...VALID_BODY, scope: "EVERYTHING" }));

      // Assert
      expect(response.status).toBe(400);
      expect((await response.json()).error).toContain("alcance");
    });

    it("should answer 400 for a non-boolean toggle", async () => {
      // Arrange
      const handlers = handlersFor(new FakeRepository());

      // Act
      const response = await handlers.analyze(post("analyze", { ...VALID_BODY, protectedSiblingRemovesLone: "yes" }));

      // Assert
      expect(response.status).toBe(400);
    });

    it.each(["{not json", "null", "[]", ""])("should answer 400, not 500, for the malformed body %j", async (body) => {
      // Arrange
      const handlers = handlersFor(new FakeRepository());

      // Act
      const analyzeResponse = await handlers.analyze(post("analyze", body));
      const exportResponse = await handlers.exportResult(post("export", body));

      // Assert
      expect(analyzeResponse.status).toBe(400);
      expect(exportResponse.status).toBe(400);
    });

    it("should answer 400 for an unknown export format", async () => {
      // Arrange
      const handlers = handlersFor(new FakeRepository());

      // Act
      const response = await handlers.exportResult(post("export", { ...VALID_BODY, format: "xlsx" }));

      // Assert
      expect(response.status).toBe(400);
      expect((await response.json()).error).toContain("formato");
    });

    it("should ignore credentials in the query string", async () => {
      // Arrange
      const repository = new FakeRepository();
      const handlers = handlersFor(repository);
      const query = `?db_name=carto&user=reader&password=${PASSWORD}&provinceId=7`;

      // Act
      const response = await handlers.analyze(post("analyze", {}, query));

      // Assert
      expect(response.status).toBe(400);
      expect(repository.received).toHaveLength(0);
    });
  });

  describe("analyze", () => {
    it("should answer the summary, grouped rows and the coordinate skip count", async () => {
      // Arrange
      const handlers = handlersFor(new FakeRepository(PAIR));

      // Act
      const response = await handlers.analyze(post("analyze", VALID_BODY));
      const payload = await response.json();

      // Assert
      expect(response.status).toBe(200);
      expect(payload.success).toBe(true);
      expect(payload.summary.rowCount).toBe(2);
      expect(payload.groups).toHaveLength(1);
      expect(payload.groups[0].rows).toHaveLength(2);
      expect(payload.skippedWithoutCoordinates).toBe(1);
    });

    it("should default host and port and forward the toggle and scope", async () => {
      // Arrange
      const repository = new FakeRepository();
      const handlers = handlersFor(repository);
      const body = {
        ...withConnection({ host: "", port: "" }),
        protectedSiblingRemovesLone: true,
        scope: DedupScope.ALL_DUPLICATE_GROUPS,
      };

      // Act
      await handlers.analyze(post("analyze", body));

      // Assert
      expect(repository.received[0].connection).toMatchObject({ host: "localhost", port: 5432 });
      expect(repository.received[0].parameters.protectedSiblingRemovesLone).toBe(true);
      expect(repository.received[0].parameters.scope).toBe(DedupScope.ALL_DUPLICATE_GROUPS);
    });

    it("should never echo the password in an error body, even when the error mentions it", async () => {
      // Arrange
      const failure = new Error(`connection to db.example failed using password ${PASSWORD}`);
      const handlers = handlersFor(new FakeRepository([], failure));

      // Act
      const response = await handlers.analyze(post("analyze", VALID_BODY));
      const text = await response.text();

      // Assert
      expect(response.status).toBe(500);
      expect(text).not.toContain(PASSWORD);
      expect(text).toContain("db.example");
    });
  });

  describe("export", () => {
    it.each([
      ["csv", "text/csv; charset=utf-8", "address-dedup-provincia-7.csv"],
      ["geojson", "application/geo+json; charset=utf-8", "address-dedup-provincia-7.geojson"],
      ["links", "application/geo+json; charset=utf-8", "address-dedup-provincia-7_links.geojson"],
    ])("should serve %s as an attachment with its content type", async (format, contentType, filename) => {
      // Arrange
      const handlers = handlersFor(new FakeRepository(PAIR.map((row) => ({ ...row, lat: -33.4 }))));

      // Act
      const response = await handlers.exportResult(post("export", { ...VALID_BODY, format }));

      // Assert
      expect(response.status).toBe(200);
      expect(response.headers.get("Content-Type")).toBe(contentType);
      expect(response.headers.get("Content-Disposition")).toBe(`attachment; filename="${filename}"`);
    });

    it("should serve the CSV with a header and one line per row", async () => {
      // Arrange
      const handlers = handlersFor(new FakeRepository(PAIR));

      // Act
      const response = await handlers.exportResult(post("export", { ...VALID_BODY, format: "csv" }));
      const lines = (await response.text()).split("\r\n");

      // Assert
      expect(lines[0]).toContain("decision_reason");
      expect(lines).toHaveLength(4);
    });

    it("should serve points for locatable rows and one link per qualifying group", async () => {
      // Arrange
      const rows = PAIR.map((row) => ({ ...row, lat: -33.4 }));
      const handlers = handlersFor(new FakeRepository(rows));

      // Act
      const points = await (await handlers.exportResult(post("export", { ...VALID_BODY, format: "geojson" }))).json();
      const links = await (await handlers.exportResult(post("export", { ...VALID_BODY, format: "links" }))).json();

      // Assert
      expect(points.features).toHaveLength(2);
      expect(links.features).toHaveLength(1);
      expect(links.features[0].geometry.type).toBe("LineString");
    });

    it("should never echo the password in an export error body", async () => {
      // Arrange
      const handlers = handlersFor(new FakeRepository([], new Error(`bad login ${PASSWORD}`)));

      // Act
      const response = await handlers.exportResult(post("export", { ...VALID_BODY, format: "csv" }));

      // Assert
      expect(response.status).toBe(500);
      expect(await response.text()).not.toContain(PASSWORD);
    });
  });
});
