import { createApp } from "./app.js";
import { loadConfig } from "./config.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const server = createApp({
    dataDir: config.dataDir,
    maxBodyBytes: config.maxBodyBytes,
    ...(config.apiKey ? { apiKey: config.apiKey } : {})
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(config.port, config.host, () => {
      server.off("error", reject);
      resolve();
    });
  });

  console.log(
    JSON.stringify({
      level: "info",
      time: new Date().toISOString(),
      event: "server.started",
      host: config.host,
      port: config.port,
      dataDir: config.dataDir,
      authentication: config.apiKey ? "bearer" : "disabled"
    })
  );

  let stopping = false;
  const stop = (signal: string): void => {
    if (stopping) return;
    stopping = true;
    console.log(JSON.stringify({ level: "info", time: new Date().toISOString(), event: "server.stopping", signal }));
    const timeout = setTimeout(() => {
      server.closeAllConnections();
    }, config.shutdownTimeoutMs);
    timeout.unref();
    server.close((error) => {
      clearTimeout(timeout);
      if (error) {
        console.error(
          JSON.stringify({
            level: "error",
            time: new Date().toISOString(),
            event: "server.stop_failed",
            error: error.message
          })
        );
        process.exitCode = 1;
      }
    });
  };

  process.on("SIGTERM", () => stop("SIGTERM"));
  process.on("SIGINT", () => stop("SIGINT"));
}

main().catch((error: unknown) => {
  const failure = error instanceof Error ? error : new Error(String(error));
  console.error(
    JSON.stringify({
      level: "error",
      time: new Date().toISOString(),
      event: "server.start_failed",
      error: failure.message,
      stack: failure.stack
    })
  );
  process.exitCode = 1;
});
