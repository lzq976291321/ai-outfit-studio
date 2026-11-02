/** Development checks only; the application has no package dependencies. */
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
const cwd = fileURLToPath(new URL("../", import.meta.url));
for (const name of ["state", "save", "gallery", "app", "tasks"]) {
  const result = spawnSync(
    process.execPath,
    ["--check", "prototype/" + name + ".js"],
    { cwd, stdio: "inherit" },
  );
  if (result.status !== 0) process.exit(result.status || 1);
}
const result = spawnSync(
  process.execPath,
  [
    "--test",
    "prototype/test_chatgpt_images.mjs",
    "prototype/test_frontend.mjs",
  ],
  { cwd, stdio: "inherit" },
);
process.exit(result.status ?? 1);
