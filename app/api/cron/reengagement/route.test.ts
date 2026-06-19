import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabaseAdmin", () => ({
  getSupabaseAdmin: () => ({
    from: () => ({
      select: () => {
        const empty = { data: [] as unknown[], error: null };
        const chain = {
          eq: () => chain,
          in: () => chain,
          neq: () => Promise.resolve(empty),
          then: (
            resolve: (v: typeof empty) => void,
            reject?: (e: unknown) => void,
          ) => Promise.resolve(empty).then(resolve, reject),
        };
        return chain;
      },
    }),
  }),
}));

import { GET } from "@/app/api/cron/reengagement/route";

describe("GET /api/cron/reengagement", () => {
  beforeEach(() => {
    process.env.CRON_SECRET = "cron-test-secret";
  });

  afterEach(() => {
    delete process.env.CRON_SECRET;
  });

  it("rechaza sin autorización", async () => {
    const res = await GET(new Request("http://localhost/api/cron/reengagement"));
    expect(res.status).toBe(401);
  });

  it("acepta header x-vercel-cron", async () => {
    const res = await GET(
      new Request("http://localhost/api/cron/reengagement", {
        headers: { "x-vercel-cron": "1" },
      }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.procesados).toBe(0);
  });

  it("acepta Bearer CRON_SECRET", async () => {
    const res = await GET(
      new Request("http://localhost/api/cron/reengagement", {
        headers: { Authorization: "Bearer cron-test-secret" },
      }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
  });
});
