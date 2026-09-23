import { existsSync, copyFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
if (!existsSync(".env")) copyFileSync(".env.example", ".env");
const result = spawnSync(process.execPath, ["node_modules/prisma/build/index.js", "db", "push", "--skip-generate"], {
  stdio: "inherit",
  // Prisma 6 can fail to initialize SQLite with an empty "Schema engine error"
  // when engine logging is unset: https://github.com/prisma/prisma/issues/29355
  env: { ...process.env, RUST_LOG: process.env.RUST_LOG ?? "info" },
});
if (result.error) console.error("Не удалось запустить подготовку базы данных:", result.error.message);
if (result.status !== 0) process.exit(result.status || 1);
