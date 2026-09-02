import { clearApiToken, getApiToken, setApiToken } from "./credentials.js";

async function main(): Promise<void> {
  const [cmd, value] = process.argv.slice(2);
  if (cmd === "set") {
    const token = value ?? process.env.SHIFTLOG_API_TOKEN;
    if (!token) {
      console.error("usage: credentials set <token>  (or SHIFTLOG_API_TOKEN=...)");
      process.exit(1);
    }
    const where = await setApiToken(token);
    console.log(`stored API token in ${where}`);
    return;
  }
  if (cmd === "get") {
    const token = await getApiToken();
    if (!token) {
      console.error("no token stored");
      process.exit(1);
    }
    console.log(token);
    return;
  }
  if (cmd === "clear") {
    await clearApiToken();
    console.log("cleared API token");
    return;
  }
  console.error("usage: credentials <set|get|clear> [token]");
  process.exit(1);
}

void main();
