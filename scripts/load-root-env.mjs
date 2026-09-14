import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export function parseEnvFile(text) {
  /** @type {Record<string, string>} */
  const values = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    values[key] = value;
  }
  return values;
}

export function applyEnvValues(values, env = process.env) {
  let applied = 0;
  for (const [key, value] of Object.entries(values)) {
    if (env[key] === undefined) {
      env[key] = value;
      applied += 1;
    }
  }
  return applied;
}

export function loadRootEnv(rootDir = ROOT) {
  const file = resolve(rootDir, ".env");
  if (!existsSync(file)) return { file, loaded: false, applied: 0 };
  const applied = applyEnvValues(parseEnvFile(readFileSync(file, "utf8")));
  return { file, loaded: true, applied };
}

loadRootEnv();
