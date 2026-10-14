import { configFromEnv } from "./config.ts";
import { startGateway } from "./app.ts";

const config = configFromEnv();
const gateway = await startGateway(config);

async function shutdown() {
  await gateway.close();
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown());
process.on("SIGINT", () => void shutdown());
