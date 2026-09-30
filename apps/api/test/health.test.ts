import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { pool } from "../src/db/pool.ts";
import { buildTestApp } from "./helpers.ts";

describe("health", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildTestApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  // 🚨 o ping do cron-job.org chama o /health a cada 10 min: se ele tocar no
  // banco, o Neon fica acordado o dia todo e estoura as 100 CU-h do mês
  it("responde sem tocar no banco", async () => {
    const query = vi.spyOn(pool, "query");
    const res = await app.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
    expect(query).not.toHaveBeenCalled();
    query.mockRestore();
  });
});
