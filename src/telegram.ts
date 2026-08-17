import { Bot } from "grammy";
import db, { getSetting } from "./db";

let bot: Bot | null = null;

function getBot(): Bot | null {
  const token = getSetting("telegram_bot_token");
  if (!token) return null;
  if (!bot || (bot as any)._token !== token) {
    bot = new Bot(token);
    (bot as any)._token = token;
  }
  return bot;
}

export async function sendTelegramNotification(): Promise<number> {
  const chatId = getSetting("telegram_chat_id");
  const b = getBot();
  if (!b || !chatId) {
    console.log("[Telegram] Bot token or chat ID not configured");
    return 0;
  }

  // Get unnotified hot/warm leads
  const leads = db.prepare(`
    SELECT * FROM leads
    WHERE notified = 0 AND category IN ('hot', 'warm')
    ORDER BY score DESC, created_at DESC
    LIMIT 10
  `).all() as any[];

  if (leads.length === 0) return 0;

  let sent = 0;
  for (const lead of leads) {
    try {
      const emoji = lead.category === "hot" ? "🔥" : "🟡";
      const scoreBar = "█".repeat(Math.round(lead.score * 10)) + "░".repeat(10 - Math.round(lead.score * 10));

      const msg = [
        `${emoji} *New Lead!* (${lead.source})`,
        "",
        `*${escapeMarkdown(lead.title)}*`,
        lead.body ? `\n${escapeMarkdown(lead.body.slice(0, 300))}` : "",
        "",
        `📊 Score: \`${scoreBar}\` ${(lead.score * 100).toFixed(0)}%`,
        `🏷️ ${lead.category.toUpperCase()} | ${lead.platform || lead.source}`,
        `👤 u/${lead.author || "unknown"}`,
        "",
        `🔗 [View Lead](${lead.source_url})`,
      ].join("\n");

      await b.api.sendMessage(chatId, msg, {
        parse_mode: "Markdown",
        disable_web_page_preview: true,
      });

      db.prepare("UPDATE leads SET notified = 1 WHERE id = ?").run(lead.id);
      sent++;

      // Rate limit: max 20 messages per minute
      await new Promise((r) => setTimeout(r, 3000));
    } catch (err: any) {
      console.error(`[Telegram] Send error:`, err.message);
    }
  }

  return sent;
}

function escapeMarkdown(text: string): string {
  return text.replace(/[_*\[\]()~`>#+\-=|{}.!]/g, "\\$&");
}

export async function sendSummary(): Promise<void> {
  const chatId = getSetting("telegram_chat_id");
  const b = getBot();
  if (!b || !chatId) return;

  const stats = db.prepare(`
    SELECT
      COUNT(*) as total,
      SUM(CASE WHEN category = 'hot' THEN 1 ELSE 0 END) as hot,
      SUM(CASE WHEN category = 'warm' THEN 1 ELSE 0 END) as warm,
      SUM(CASE WHEN notified = 0 AND category IN ('hot','warm') THEN 1 ELSE 0 END) as pending
    FROM leads
  `).get() as any;

  const msg = [
    "📊 *LeadHunt Daily Summary*",
    "",
    `Total leads: *${stats.total}*`,
    `🔥 Hot: *${stats.hot}* | 🟡 Warm: *${stats.warm}*`,
    `📬 Pending notify: *${stats.pending}*`,
    "",
    `_Updated: ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC_`,
  ].join("\n");

  try {
    await b.api.sendMessage(chatId, msg, { parse_mode: "Markdown" });
  } catch (err: any) {
    console.error("[Telegram] Summary error:", err.message);
  }
}
