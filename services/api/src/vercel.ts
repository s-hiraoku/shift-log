import { handle } from "hono/vercel";
import { createApp } from "./app.js";

const app = createApp();

export default handle(app);
