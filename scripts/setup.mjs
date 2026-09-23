import { existsSync, copyFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
if (!existsSync(".env")) copyFileSync(".env.example", ".env");
const command = process.platform === "win32" ? "prisma.cmd" : "prisma";
const result = spawnSync(command, ["db", "push"], { stdio: "inherit", shell: process.platform === "win32" });
if (result.status !== 0) process.exit(result.status || 1);
