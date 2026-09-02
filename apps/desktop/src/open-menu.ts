import { execFile } from "node:child_process";

const port = process.env.SHIFTLOG_CONTROL_PORT ?? "8791";
const url = `http://127.0.0.1:${port}/`;
const opener = process.platform === "darwin" ? "open" : "xdg-open";

execFile(opener, [url], (err) => {
  if (err) {
    console.error(`Open ${url} in a browser to pause / resume / quit.`);
    return;
  }
  console.log(`opened ${url}`);
});
