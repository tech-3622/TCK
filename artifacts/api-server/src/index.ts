import app from "./app";
import { logger } from "./lib/logger";
import { appSettingsTable, db } from "@workspace/db";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

async function start(): Promise<void> {
  await db
    .insert(appSettingsTable)
    .values({ id: 1, currentRate: 100, firstAdminAssigned: false })
    .onConflictDoNothing();

  app.listen(port, () => {
    logger.info({ port }, "Server listening");
  });
}

start().catch((error: unknown) => {
  logger.error({ err: error }, "Could not start API server");
  process.exit(1);
});
