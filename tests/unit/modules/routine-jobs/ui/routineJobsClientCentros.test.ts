import { describe, expect, it, vi } from "vitest";
import { createRoutineJobsClient } from "@/modules/routine-jobs/ui/routineJobsClient";
import type { CentrosAnepStartRequest } from "@/modules/routine-jobs/ui/clientTypes";
import { centrosTablesBody } from "../centros-anep/centrosFixtures";

const BASE = "/api/m/routine-jobs";

const request: CentrosAnepStartRequest = {
  connection: { host: "h", port: "5432", db_name: "d", user: "u", password: "pw" },
  tables: centrosTablesBody(),
  dryRun: true,
  confirm: false,
};

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

describe("routineJobsClient centros-anep (CA-2)", () => {
  it("should POST the request as JSON to centros-anep/start and return the jobId", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => jsonResponse({ success: true, jobId: "job-9" }));
    const client = createRoutineJobsClient({ fetch: fetchMock });

    const result = await client.startCentrosAnep(request);

    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe(`${BASE}/centros-anep/start`);
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body))).toEqual(request);
    expect(result).toEqual({ jobId: "job-9" });
  });

  it("should surface the Spanish server error of a refused start", async () => {
    const message = "Ya hay una carga de centros ANEP en curso para esta tabla.";
    const client = createRoutineJobsClient({ fetch: vi.fn<typeof fetch>(async () => jsonResponse({ success: false, error: message }, 409)) });

    await expect(client.startCentrosAnep(request)).rejects.toMatchObject({ message, status: 409 });
  });

  it("should GET centros-anep/status with the encoded jobId and unwrap the job", async () => {
    const job = { jobId: "a b", state: "RUNNING" };
    const fetchMock = vi.fn<typeof fetch>(async () => jsonResponse({ success: true, job }));
    const client = createRoutineJobsClient({ fetch: fetchMock });

    const view = await client.readCentrosAnepStatus("a b");

    expect(String(fetchMock.mock.calls[0][0])).toBe(`${BASE}/centros-anep/status?jobId=a%20b`);
    expect(view).toEqual(job);
  });
});
