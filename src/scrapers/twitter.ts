import db, { getSetting } from "../db";
import puppeteer from "puppeteer";

export async function scrapeTwitter(): Promise<{ found: number; new: number }> {
  let totalFound = 0;
  let newLeads = 0;

  const searchQueries = [
    "need web app developer",
    "looking for web developer",
    "need someone to build website",
    "hire web developer",
    "need SaaS developer",
    "looking for programmer to build",
    "need ecommerce website",
    "freelance web developer needed",
  ];

  let browser: any;
  try {
    browser = await puppeteer.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
      executablePath: "/usr/bin/google-chrome",
    });

    const page = await browser.newPage();
    await page.setUserAgent(
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    );

    // Use DuckDuckGo to find tweets (avoids X login wall)
    for (const query of searchQueries.slice(0, 4)) {
      try {
        const searchQuery = `${query} site:twitter.com OR site:x.com`;
        const url = `https://duckduckgo.com/html/?q=${encodeURIComponent(searchQuery)}`;

        await page.goto(url, { waitUntil: "domcontentloaded", timeout: 15000 });
        await page.waitForSelector(".result__body", { timeout: 5000 }).catch(() => {});

        const results = await page.evaluate(() => {
          const items = document.querySelectorAll(".result");
          return Array.from(items).slice(0, 8).map((item: any) => {
            const titleEl = item.querySelector(".result__a");
            const snippetEl = item.querySelector(".result__snippet");
            const urlEl = item.querySelector(".result__url");
            return {
              title: titleEl?.textContent?.trim() || "",
              snippet: snippetEl?.textContent?.trim() || "",
              url: urlEl?.textContent?.trim() || titleEl?.href || "",
            };
          });
        });

        for (const result of results) {
          if (!result.url.includes("twitter.com") && !result.url.includes("x.com")) continue;

          totalFound++;
          const sourceId = Buffer.from(result.url).toString("base64url").slice(0, 64);

          const exists = db.prepare("SELECT id FROM leads WHERE source = 'twitter' AND source_id = ?").get(sourceId);
          if (exists) continue;

          const text = `${result.title} ${result.snippet}`.toLowerCase();
          const keywords = getSetting("keywords").split(",").map((k) => k.trim());
          const matchedKeywords = keywords.filter((kw) => text.includes(kw));
          const score = Math.min(1, matchedKeywords.length * 0.15 + 0.3);

          let category = "unreviewed";
          if (score >= 0.5) category = "hot";
          else if (score >= 0.3) category = "warm";
          else category = "cold";

          db.prepare(`
            INSERT OR IGNORE INTO leads (source, source_id, source_url, title, body, score, category, platform, tags)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          `).run(
            "twitter",
            sourceId,
            result.url,
            result.title,
            result.snippet,
            score,
            category,
            "twitter",
            JSON.stringify(matchedKeywords.slice(0, 5))
          );

          newLeads++;
        }

        await new Promise((r) => setTimeout(r, 2000));
      } catch (err: any) {
        console.error(`[Twitter] Query error:`, err.message);
      }
    }
  } catch (err: any) {
    console.error("[Twitter] Browser error:", err.message);
  } finally {
    if (browser) await browser.close().catch(() => {});
  }

  db.prepare("INSERT INTO scrape_log (source, total_found, new_leads) VALUES (?, ?, ?)").run("twitter", totalFound, newLeads);

  return { found: totalFound, new: newLeads };
}
