// Messages to your phone when you're not looking at HQ.
//
//   ntfy (free, easiest): install the "ntfy" app, subscribe to a topic name only
//     you know (e.g. eka-hq-7f3k2q9), and put it in NTFY_TOPIC.
//   Telegram: make a bot with @BotFather (TELEGRAM_BOT_TOKEN), send it a message,
//     then put your chat id in TELEGRAM_CHAT_ID (HQ's Settings tab can find it).
//   Email: OWNER_EMAIL, using the SMTP settings.

export function createNotifier({ env = process.env, mailer, fetchImpl = fetch } = {}) {
  const ntfy = (env.NTFY_TOPIC || "").trim();
  const ntfyServer = (env.NTFY_SERVER || "https://ntfy.sh").replace(/\/+$/, "");
  const tgToken = (env.TELEGRAM_BOT_TOKEN || "").trim();
  const tgChat = (env.TELEGRAM_CHAT_ID || "").trim();
  const email = (env.OWNER_EMAIL || "").trim();
  const channels = [ntfy && "ntfy", tgToken && tgChat && "telegram", email && mailer?.enabled && "email"].filter(Boolean);

  async function send({ title, text, url = "", urgent = false }) {
    const results = [];
    if (ntfy) {
      results.push(fetchImpl(`${ntfyServer}/${encodeURIComponent(ntfy)}`, {
        method: "POST", body: text,
        // Header values must be plain text.
        headers: { Title: title.replace(/[^\x20-\x7e]/g, ""), Priority: urgent ? "high" : "default", Tags: urgent ? "rotating_light" : "briefcase", ...(url ? { Click: url } : {}) },
        signal: AbortSignal.timeout(15_000),
      }).then((r) => { if (!r.ok) throw new Error(`ntfy said ${r.status}`); return "ntfy"; }));
    }
    if (tgToken && tgChat) {
      results.push(fetchImpl(`https://api.telegram.org/bot${tgToken}/sendMessage`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: tgChat, text: `${title}\n\n${text}${url ? `\n\n${url}` : ""}`, disable_web_page_preview: true }),
        signal: AbortSignal.timeout(15_000),
      }).then(async (r) => { const d = await r.json().catch(() => ({})); if (!d.ok) throw new Error(`Telegram: ${d.description || r.status}`); return "telegram"; }));
    }
    if (email && mailer?.enabled) results.push(mailer.send({ to: email, subject: title, text: `${text}${url ? `\n\n${url}` : ""}`, fromName: "Henry at EKA HQ" }).then(() => "email"));
    const out = await Promise.allSettled(results);
    const errors = out.filter((r) => r.status === "rejected").map((r) => r.reason.message);
    if (errors.length) console.warn("Notification problem:", errors.join("; "));
    return { sent: out.filter((r) => r.status === "fulfilled").map((r) => r.value), errors };
  }

  // Telegram: the chat id of whoever last messaged the bot (for setting it up).
  async function telegramChatId() {
    if (!tgToken) throw new Error("Add TELEGRAM_BOT_TOKEN first.");
    const d = await (await fetchImpl(`https://api.telegram.org/bot${tgToken}/getUpdates`, { signal: AbortSignal.timeout(15_000) })).json();
    const m = (d.result || []).map((u) => u.message || u.channel_post).filter(Boolean).at(-1);
    if (!m) throw new Error("Send your bot a message in Telegram first, then try again.");
    return String(m.chat.id);
  }

  return { channels, enabled: channels.length > 0, send, telegramChatId };
}
