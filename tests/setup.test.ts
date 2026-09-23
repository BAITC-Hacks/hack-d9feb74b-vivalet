import { existsSync, mkdtempSync, readdirSync, rmdirSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { PrismaClient } from "@prisma/client";
import { expect, it } from "vitest";

it("initializes a new SQLite database without RUST_LOG and preserves data on repeat setup", async () => {
  const directory = mkdtempSync(join(tmpdir(), "vivalet-setup-"));
  const database = join(directory, "test.db");
  const url = `file:${database.replaceAll("\\", "/")}`;
  const env: NodeJS.ProcessEnv = { ...process.env, DATABASE_URL: url };
  delete env.RUST_LOG;
  const setup = () => {
    const result = spawnSync(process.execPath, ["scripts/setup.mjs"], { cwd: process.cwd(), env, encoding: "utf8", timeout: 20_000 });
    expect(result.error).toBeUndefined();
    expect(result.status, result.stderr + result.stdout).toBe(0);
  };
  const client = new PrismaClient({ datasourceUrl: url });
  try {
    expect(existsSync(database)).toBe(false);
    setup();
    const analysis = await client.analysis.create({ data: { stage: "Проверка сохранности данных" } });
    await client.$disconnect();
    setup();
    expect((await client.analysis.findUnique({ where: { id: analysis.id } }))?.stage).toBe("Проверка сохранности данных");
  } finally {
    await client.$disconnect();
    // Only remove files in the unique temporary directory created by this test.
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.isFile()) unlinkSync(join(directory, entry.name));
    }
    rmdirSync(directory);
  }
}, 50_000);
