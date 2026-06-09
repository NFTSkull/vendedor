import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabaseAdmin", () => ({
  getSupabaseAdmin: () => ({
    from: () => ({
      select: () => ({
        eq: () => Promise.resolve({ data: [], error: null }),
      }),
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
