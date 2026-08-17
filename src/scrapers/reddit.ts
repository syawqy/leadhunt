import db, { getSetting } from "../db";

const USER_AGENT = "LeadHunt/1.0 (lead generation bot)";

interface RedditPost {
  id: string;
  title: string;
  selftext: string;
  author: string;
  subreddit: string;
  permalink: string;
  url: string;
  score: number;
  created_utc: number;
}

export async function scrapeReddit(): Promise<{ found: number; new: number }> {
  const subreddits = getSetting("subreddits").split(",").map((s) => s.trim());
  const keywords = getSetting("keywords").split(",").map((k) => k.trim().toLowerCase());
  let totalFound = 0;
  let newLeads = 0;

  for (const sub of subreddits) {
    try {
      // Search within subreddit for web dev related posts
      const searchQuery = "web app OR website OR developer OR programmer OR build OR SaaS OR landing page";
      const url = `https://www.reddit.com/r/${sub}/new.json?limit=50`;

      const res = await fetch(url, {
        headers: { "User-Agent": USER_AGENT },
      });

      if (!res.ok) {
        console.log(`[Reddit] r/${sub}: HTTP ${res.status}`);
        continue;
      }

      const data = await res.json() as any;
      const posts: RedditPost[] = data?.data?.children?.map((c: any) => c.data) ?? [];

      for (const post of posts) {
        const text = `${post.title} ${post.selftext}`.toLowerCase();

        // Check if post matches any keyword
        const matchedKeywords = keywords.filter((kw) => text.includes(kw));
        if (matchedKeywords.length === 0) continue;

        totalFound++;

        // Check if already exists
        const exists = db.prepare("SELECT id FROM leads WHERE source = 'reddit' AND source_id = ?").get(post.id);
        if (exists) continue;

        // Calculate score based on keyword matches + post quality
        const score = Math.min(1, (matchedKeywords.length * 0.2) + (post.score > 0 ? 0.1 : 0));

        // Categorize
        let category = "unreviewed";
        if (score >= 0.6) category = "hot";
        else if (score >= 0.3) category = "warm";
        else category = "cold";

        const tags = JSON.stringify(matchedKeywords.slice(0, 5));

        db.prepare(`
          INSERT OR IGNORE INTO leads (source, source_id, source_url, title, body, author, score, category, platform, tags)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          "reddit",
          post.id,
          `https://reddit.com${post.permalink}`,
          post.title,
          post.selftext?.slice(0, 2000) || "",
          post.author,
          score,
          category,
          `r/${sub}`,
          tags
        );

        newLeads++;
      }
    } catch (err: any) {
      console.error(`[Reddit] r/${sub} error:`, err.message);
    }
  }

  // Log scrape
  db.prepare("INSERT INTO scrape_log (source, total_found, new_leads) VALUES (?, ?, ?)").run("reddit", totalFound, newLeads);

  return { found: totalFound, new: newLeads };
}
