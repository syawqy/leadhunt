import { scrapeReddit } from "./scrapers/reddit";
import { scrapeWeb } from "./scrapers/web";
import { scrapeHN } from "./scrapers/hn";
import { triagePendingLeads } from "./llm";
import { sendTelegramNotification } from "./telegram";

export async function runScrape(): Promise<void> {
  console.log(`\n🔍 [${new Date().toISOString()}] Starting scrape...`);

  // Run all scrapers
  const results = await Promise.allSettled([
    scrapeReddit(),
    scrapeWeb(),
    scrapeHN(),
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

  // Phase 2: LLM triage all untriaged leads
  if (totalNew > 0) {
    console.log("🧠 Running LLM triage...");
    const triaged = await triagePendingLeads();
    console.log(`🧠 Triaged ${triaged} leads`);
  }

  // Send notifications for hot/warm leads
  const notified = await sendTelegramNotification();
  console.log(`📬 Telegram: ${notified} notifications`);
}

// Run if called directly
if (import.meta.main) {
  await runScrape();
}