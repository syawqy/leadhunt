import db, { getSetting, normalizePostDate, normalizeUrl } from "../db";

// Reddit OAuth (script app): https://www.reddit.com/prefs/apps
// Set REDDIT_CLIENT_ID and REDDIT_CLIENT_SECRET in env.
// Without credentials, this scraper is skipped (Reddit blocks anonymous from cloud IPs).
const CLIENT_ID = process.env.REDDIT_CLIENT_ID || "";
const CLIENT_SECRET = process.env.REDDIT_CLIENT_SECRET || "";
const USER_AGENT = "linux:leadhunt:v1.0 (by /u/leadhunt_bot)";

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
  link_flair_text: string | null;
}

async function getToken(): Promise<string | null> {
  if (!CLIENT_ID || !CLIENT_SECRET) return null;
  try {
    const res = await fetch("https://www.reddit.com/api/v1/access_token", {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": USER_AGENT,
      },
      body: "grant_type=client_credentials",
    });
    if (!res.ok) return null;
    const data = await res.json() as any;
    return data?.access_token || null;
  } catch {
    return null;
  }
}

export async function scrapeReddit(): Promise<{ found: number; new: number; skipped: boolean }> {
  const token = await getToken();
  if (!token) {
    console.log("[Reddit] No OAuth credentials (REDDIT_CLIENT_ID/SECRET) or token failed — REDDIT LEADS COME VIA WEB SEARCH INSTEAD");
    return { found: 0, new: 0, skipped: true };
  }

  const subreddits = getSetting("subreddits").split(",").map((s) => s.trim());
  const base = "https://oauth.reddit.com";
  let totalFound = 0;
  let newLeads = 0;

  for (const sub of subreddits) {
    try {
      // Fetch new posts; prefer [Hiring] flairs in forhire-like subs
      const res = await fetch(`${base}/r/${sub}/new?limit=50`, {
        headers: {
          Authorization: `Bearer ${token}`,
          "User-Agent": USER_AGENT,
        },
      });
      if (!res.ok) {
        console.log(`[Reddit] r/${sub}: HTTP ${res.status}`);
        continue;
      }

      const data = await res.json() as any;
      const posts: RedditPost[] = data?.data?.children?.map((c: any) => c.data) ?? [];
      const now = Date.now() / 1000;

      for (const post of posts) {
        // Skip posts older than 7 days
        if (now - post.created_utc > 7 * 24 * 3600) continue;

        // Strong signal: [Hiring] flair (in forhire) or self posts mentioning hire/need
        const flair = (post.link_flair_text || "").toLowerCase();
        const title = post.title.toLowerCase();
        const isHiringFlair = flair.includes("hiring") && !flair.includes("for hire");
        const hiringText = /(need|looking for|want to hire|hire|help.*build|someone to (build|make|develop|create)|budget)/.test(title);

        if (!isHiringFlair && !hiringText) continue;
        // Exclude "[For Hire]" (devs offering services)
        if (flair.includes("for hire")) continue;

        totalFound++;
        const exists = db.prepare("SELECT id FROM leads WHERE source = 'reddit' AND source_id = ?").get(post.id);
        if (exists) continue;

        // Preliminary score: flair is a strong signal
        const score = isHiringFlair ? 0.7 : 0.5;
        const postDate = normalizePostDate(post.created_utc * 1000);

        db.prepare(`
          INSERT OR IGNORE INTO leads (source, source_id, source_url, title, body, author, score, category, platform, tags, post_date)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          "reddit",
          post.id,
          normalizeUrl(`https://reddit.com${post.permalink}`),
          post.title,
          post.selftext?.slice(0, 2000) || "",
          post.author || "",
          score,
          isHiringFlair ? "hot" : "warm", // LLM will re-score later
          `r/${sub}`,
          JSON.stringify(isHiringFlair ? ["[Hiring]"] : ["hiring-text"]),
          postDate
        );

        newLeads++;
      }
    } catch (err: any) {
      console.error(`[Reddit] r/${sub} error:`, err.message);
    }
  }

  db.prepare("INSERT INTO scrape_log (source, total_found, new_leads) VALUES (?, ?, ?)").run("reddit", totalFound, newLeads);
  return { found: totalFound, new: newLeads, skipped: false };
}