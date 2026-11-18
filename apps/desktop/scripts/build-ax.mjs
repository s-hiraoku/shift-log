import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { join } from "node:path";

if (process.platform === "darwin") {
  const source = fileURLToPath(new URL("../native/ax-snapshot.swift", import.meta.url));
  const destination = fileURLToPath(new URL("../dist/ax-snapshot", import.meta.url));
  mkdirSync(fileURLToPath(new URL("../dist", import.meta.url)), { recursive: true });
  execFileSync("/usr/bin/xcrun", ["swiftc", "-O", "-module-cache-path", join(tmpdir(), "shiftlog-swift-cache"), source, "-o", destination], { stdio: "inherit" });
}
