/**
 * Admin notifications:
 *  1. Live (Server-Sent Events) to every open admin panel  -> pop-up + sound
 *  2. Telegram message (optional, works even when the panel is closed)
 *  3. Webhook (optional)
 */
export function createNotifier(cfg) {
  const clients = new Set();

  const heartbeat = setInterval(() => {
    for (const res of clients) {
      try {
        res.write(": ping\n\n");
      } catch {
        clients.delete(res);
      }
    }
  }, 25_000);
  heartbeat.unref();

  function addClient(req, res) {
    res.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    res.write("retry: 5000\n\n");
    res.write("event: hello\ndata: {}\n\n");
    clients.add(res);
    req.on("close", () => clients.delete(res));
  }

  function broadcast(event, data) {
    const frame = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const res of clients) {
      try {
        res.write(frame);
      } catch {
        clients.delete(res);
      }
    }
  }

  async function postJson(url, payload) {
    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(8000),
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
  }

  /** Never throws: a failing Telegram/webhook must not break a customer's booking. */
  async function deliverExternal(kind, title, body) {
    const jobs = [];
    if (cfg.telegramToken && cfg.telegramChatId) {
      jobs.push(
        postJson(`https://api.telegram.org/bot${cfg.telegramToken}/sendMessage`, {
          chat_id: cfg.telegramChatId,
          text: `${title}\n\n${body}`.slice(0, 4000),
          disable_web_page_preview: true,
        }).catch((e) => console.warn(`[notify] Telegram failed: ${e.message}`))
      );
    }
    if (cfg.webhookUrl) {
      jobs.push(
        postJson(cfg.webhookUrl, { event: kind, title, body }).catch((e) =>
          console.warn(`[notify] Webhook failed: ${e.message}`)
        )
      );
    }
    await Promise.all(jobs);
  }

  return {
    addClient,
    broadcast,
    deliverExternal,
    clientCount: () => clients.size,
    close() {
      clearInterval(heartbeat);
      for (const res of clients) {
        try {
          res.end();
        } catch {
          /* ignore */
        }
      }
      clients.clear();
    },
  };
}
