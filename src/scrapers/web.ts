import db, { getSetting } from "../db";
import puppeteer from "puppeteer";

export async function scrapeWeb(): Promise<{ found: number; new: number }> {
  const keywords = getSetting("keywords").split(",").map((k) => k.trim());
  let totalFound = 0;
  let newLeads = 0;

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

    // Use a subset of keywords for web search (avoid too many requests)
    const searchQueries = [
      "need web app developer site:reddit.com OR site:twitter.com",
      "looking for someone to build website site:reddit.com",
      "hire web developer freelance site:reddit.com OR site:twitter.com",
      "need SaaS developer site:reddit.com",
      "looking for web developer site:twitter.com OR site:reddit.com",
    ];

    for (const query of searchQueries) {
      try {
        const encodedQuery = encodeURIComponent(query);
        const url = `https://duckduckgo.com/html/?q=${encodedQuery}`;

        await page.goto(url, { waitUntil: "domcontentloaded", timeout: 15000 });
        await page.waitForSelector(".result__body", { timeout: 5000 }).catch(() => {});

        const results = await page.evaluate(() => {
          const items = document.querySelectorAll(".result");
          return Array.from(items).slice(0, 10).map((item: any) => {
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
          totalFound++;

          // Generate a unique ID from URL
          const sourceId = Buffer.from(result.url).toString("base64url").slice(0, 64);

          // Check if already exists
          const exists = db.prepare("SELECT id FROM leads WHERE source = 'web' AND source_id = ?").get(sourceId);
          if (exists) continue;

          // Determine source platform from URL
          let platform = "web";
          if (result.url.includes("reddit.com")) platform = "reddit";
          else if (result.url.includes("twitter.com") || result.url.includes("x.com")) platform = "twitter";

          // Score based on keyword relevance
          const text = `${result.title} ${result.snippet}`.toLowerCase();
          const matchedKeywords = keywords.filter((kw) => text.includes(kw));
          const score = Math.min(1, matchedKeywords.length * 0.15 + 0.2);

          let category = "unreviewed";
          if (score >= 0.5) category = "hot";
          else if (score >= 0.3) category = "warm";
          else category = "cold";

          db.prepare(`
            INSERT OR IGNORE INTO leads (source, source_id, source_url, title, body, score, category, platform, tags)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          `).run(
            "web",
            sourceId,
            result.url,
            result.title,
            result.snippet,
            score,
            category,
            platform,
            JSON.stringify(matchedKeywords.slice(0, 5))
          );

          newLeads++;
        }

        // Be polite - wait between queries
        await new Promise((r) => setTimeout(r, 2000));
      } catch (err: any) {
        console.error(`[Web] Query error:`, err.message);
      }
    }
  } catch (err: any) {
    console.error("[Web] Browser error:", err.message);
  } finally {
    if (browser) await browser.close().catch(() => {});
  }

  db.prepare("INSERT INTO scrape_log (source, total_found, new_leads) VALUES (?, ?, ?)").run("web", totalFound, newLeads);

  return { found: totalFound, new: newLeads };
}
