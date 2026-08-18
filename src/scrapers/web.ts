import db, { getSetting } from "../db";
import puppeteer from "puppeteer";

// --- Intent-based prefilter ---
// Strong buying-intent phrases (people looking to HIRE)
const BUY_INTENT = [
  /where (can|do) i (find|get|hire)/i,
  /how to find someone to (build|make|develop|create|design)/i,
  /need (someone to|help) (build|make|develop|create|design)/i,
  /looking for (someone|a developer|a freelancer|a web (developer|designer)|help) (to|with)/i,
  /want to hire/i,
  /hire (a|someone|a freelance|a web)/i,
  /looking to (build|create|develop|launch|make)/i,
  /need (a|my|help).*(website|web ?app|ecommerce|saas|landing page|store|site)/i,
  /someone to (build|make|develop|create|design) (a|my|an)/i,
  /(budget|price).*(website|web ?app|developer|freelancer)/i,
  /best place to (find|hire)/i,
  /find a (developer|freelancer|web)/i,
  /pay someone to (build|make|develop)/i,
  /need a (developer|programmer|web)/i,
  /looking for a developer/i,
];

// Offering/job-seeking/discussion phrases (NOT leads)
const OFFER_INTENT = [
  /how to become/i,
  /i am a \w+ developer/i,
  /i'?m a \w+ developer/i,
  /my journey/i,
  /portfolio/i,
  /career advice/i,
  /tips for/i,
  /tutorial/i,
  /learn (to|how)/i,
  /am i too old/i,
  /can'?t (get|find) a dev job/i,
  /developer jobs/i,
  /jobs board/i,
  /remote jobs/i,
  /hiring (process|season|practices)/i,
  /interview (tips|questions|process)/i,
  /resume/i,
  /salary/i,
  /bootcamp/i,
  /course/i,
  /developer roadmap/i,
  /who is hiring/i, // HN-style, that's employers hiring employees, not freelancer leads
];

const JUNK_DOMAINS = [
  "developer.x.com", "docs.x.com", "about.x.com", "help.x.com",
  "business.x.com", "blog.x.com", "x.com/xdevelopers", "x.com/amazonappdev",
  "x.com/ibmdeveloper", "x.com/buildinpublic", "x.com/xopensource",
  "developer.twitter.com", "twitter.com/twitterdev", "twitter.com/xdevelopers",
  "indeed.com", "linkedin.com/jobs", "glassdoor.com", "ziprecruiter.com",
  "upwork.com/jobs", "freelancer.com/jobs", "fiverr.com",
];

export async function scrapeWeb(): Promise<{ found: number; new: number }> {
  const keywords = getSetting("keywords").split(",").map((k) => k.trim()).filter(Boolean);
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

    // Search queries designed to surface BUYING intent (Reddit threads, forums)
    const searchQueries = [
      '"looking for" "web developer" site:reddit.com',
      '"need someone to build" website',
      '"help me build" website OR "web app"',
      '"where to find" "web developer" reddit',
      '"hire" "freelance web developer" reddit',
      '"need a website" help forum',
      '"looking to build" "web app"',
      '"someone to build" ecommerce OR "landing page"',
      '"find a freelancer" "build" website',
      '"pay someone" "build" website',
    ];

    for (const query of searchQueries) {
      try {
        const url = `https://duckduckgo.com/html/?q=${encodeURIComponent(query)}`;

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
          const url = result.url.toLowerCase();
          // Skip junk domains
          if (JUNK_DOMAINS.some((d) => url.includes(d))) continue;

          const text = `${result.title} ${result.snippet}`;

          // Prefilter: must have buying intent, must NOT be offering/job-seeking
          const hasBuyIntent = BUY_INTENT.some((re) => re.test(text));
          const hasOfferIntent = OFFER_INTENT.some((re) => re.test(text));
          if (!hasBuyIntent || hasOfferIntent) continue;

          totalFound++;
          const sourceId = Buffer.from(result.url).toString("base64url").slice(0, 64);
          const exists = db.prepare("SELECT id FROM leads WHERE source = 'web' AND source_id = ?").get(sourceId);
          if (exists) continue;

          let platform = "web";
          if (url.includes("reddit.com")) platform = "reddit";
          else if (url.includes("x.com") || url.includes("twitter.com")) platform = "twitter";

          db.prepare(`
            INSERT OR IGNORE INTO leads (source, source_id, source_url, title, body, score, category, platform)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          `).run(
            "web",
            sourceId,
            result.url,
            result.title,
            result.snippet,
            0.5, // LLM will re-score
            "unreviewed",
            platform
          );

          newLeads++;
        }

        await new Promise((r) => setTimeout(r, 2500));
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