import { startServer } from "./src/app.js";

try {
  const s = await startServer();
  const { cfg } = s;
  for (const w of cfg.warnings) console.warn(`[setup] ${w}`);
  console.log("");
  console.log("  পাটিপত্র  Patipatra backend is running");
  console.log(`  Website pages : http://localhost:${s.port}/booking   /gallery`);
  console.log(`  Admin panel   : http://localhost:${s.port}/admin`);
  console.log(`  Alerts        : ${cfg.telegramToken && cfg.telegramChatId ? "Telegram ON" : "Telegram off"} | live panel alerts ON`);
  console.log("");

  let closing = false;
  const stop = async (signal) => {
    if (closing) return;
    closing = true;
    console.log(`\n${signal} received, shutting down...`);
    try {
      await s.close();
    } finally {
      process.exit(0);
    }
  };
  process.on("SIGINT", () => stop("SIGINT"));
  process.on("SIGTERM", () => stop("SIGTERM"));
} catch (err) {
  if (err?.code === "EADDRINUSE") {
    console.error(`\nPort ${process.env.PORT || 3000} is already in use. Close the other program or set a different PORT in .env.\n`);
  } else {
    console.error("\nCould not start the server:", err?.message || err, "\n");
  }
  process.exit(1);
}
