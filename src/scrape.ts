import { scrapeReddit } from "./scrapers/reddit";
import { scrapeWeb } from "./scrapers/web";
import { scrapeTwitter } from "./scrapers/twitter";
import { sendTelegramNotification } from "./telegram";
import db from "./db";

export async function runScrape(): Promise<void> {
  console.log(`\n🔍 [${new Date().toISOString()}] Starting scrape...`);

  // Run all scrapers
  const results = await Promise.allSettled([
    scrapeReddit(),
    scrapeWeb(),
    scrapeTwitter(),
  ]);

  let totalFound = 0;
  let totalNew = 0;

  for (const r of results) {
    if (r.status === "fulfilled") {
      totalFound += r.value.found;
      totalNew += r.value.new;
    }
  }

  console.log(`✅ Scrape complete: ${totalFound} found, ${totalNew} new leads`);

  // Send notifications for new leads
  if (totalNew > 0) {
    const notified = await sendTelegramNotification();
    console.log(`📬 Sent ${notified} Telegram notifications`);
  }
}

// Run if called directly
if (import.meta.main) {
  await runScrape();
}
