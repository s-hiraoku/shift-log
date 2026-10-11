import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { applyEnvValues, parseEnvFile } from "./env-file.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export { applyEnvValues, parseEnvFile };

export function loadRootEnv(rootDir = ROOT) {
  const file = resolve(rootDir, ".env");
  if (!existsSync(file)) return { file, loaded: false, applied: 0 };
  const applied = applyEnvValues(parseEnvFile(readFileSync(file, "utf8")));
  return { file, loaded: true, applied };
}

loadRootEnv();
