import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import router from "./routes/index.js";
import { logger } from "./lib/logger.js";
import { startTelegramBot } from "./lib/telegram.js";
import { createMCPRouter } from "./lib/mcp.js";

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) { return { id: req.id, method: req.method, url: req.url?.split("?")[0] }; },
      res(res) { return { statusCode: res.statusCode }; },
    },
  }),
);

app.use(cors({ origin: true }));
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true, limit: "50mb" }));

app.use("/api", router);

// MCP Server — JSON-RPC 2.0 compatible
app.use("/mcp", createMCPRouter());

// Start Telegram bot after DB is ready
setTimeout(() => {
  startTelegramBot();
}, 2000);

export default app;
