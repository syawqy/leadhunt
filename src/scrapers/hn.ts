import db, { normalizePostDate, normalizeUrl } from "../db";

// Hacker News Algolia API — free, reliable, no auth.
// Sources: "Ask HN: Who is hiring?" comments, "Seeking Freelancer" threads,
// and posts where people explicitly ask for help building things.

// Only keep posts newer than this many days (HN has real timestamps)
const MAX_AGE_DAYS = 30;

interface HNItem {
  objectID: string;
  title?: string;
  text?: string;
  author?: string;
  url?: string;
  created_at?: string;
  story_title?: string;
}

const SEARCH_QUERIES = [
  // People seeking freelancers / looking to hire a dev
  { query: "looking for a freelancer", tags: "story", title: "HN: Looking for freelancer" },
  { query: "seeking freelancer", tags: "story", title: "HN: Seeking freelancer" },
  { query: "need a developer to build", tags: "comment", title: "HN: Need developer" },
  { query: "looking for someone to build", tags: "comment", title: "HN: Looking for builder" },
  { query: "need help building a website", tags: "comment", title: "HN: Need website help" },
  { query: "hire a web developer", tags: "comment", title: "HN: Hire web dev" },
];

export async function scrapeHN(): Promise<{ found: number; new: number }> {
  let totalFound = 0;
  let newLeads = 0;

  for (const { query, tags } of SEARCH_QUERIES) {
    try {
      const encoded = encodeURIComponent(query);
      // search_by_date = newest first
      const url = `https://hn.algolia.com/api/v1/search_by_date?query=${encoded}&tags=${tags}&hitsPerPage=20`;

      const res = await fetch(url, {
        headers: { "User-Agent": "LeadHunt/1.0" },
      });

      if (!res.ok) {
        console.log(`[HN] Query "${query}": HTTP ${res.status}`);
        continue;
      }

      const data = await res.json() as any;
      const hits: HNItem[] = data?.hits ?? [];

      for (const hit of hits) {
        // Skip old posts — HN created_at is the post date
        if (hit.created_at) {
          const ageDays = (Date.now() - Date.parse(hit.created_at)) / 86400000;
          if (ageDays > MAX_AGE_DAYS) continue;
        }

        // Comments: use story_title + text; Stories: use title + text
        const title = hit.title || hit.story_title || "";
        const body = hit.text?.replace(/<[^>]+>/g, "").slice(0, 1500) || "";
        const author = hit.author || "";
        const url = normalizeUrl(hit.url || `https://news.ycombinator.com/item?id=${hit.objectID}`);
        const postDate = normalizePostDate(hit.created_at);

        const text = `${title} ${body}`;
        // Quick prefilter — must look like someone wants to BUILD something
        if (!/(need|looking for|want|hire|help|seek|budget|build|develop|create)/i.test(text)) continue;

        totalFound++;
        const exists = db.prepare("SELECT id FROM leads WHERE source = 'hn' AND source_id = ?").get(hit.objectID);
        if (exists) continue;

        db.prepare(`
          INSERT OR IGNORE INTO leads (source, source_id, source_url, title, body, author, score, category, platform, post_date)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          "hn",
          hit.objectID,
          url,
          title.slice(0, 200) || `HN comment by ${author}`,
          body,
          author,
          0.5,
          "unreviewed",
          "hackernews",
          postDate
        );

        newLeads++;
      }
    } catch (err: any) {
      console.error(`[HN] Query "${query}" error:`, err.message);
    }
  }

  db.prepare("INSERT INTO scrape_log (source, total_found, new_leads) VALUES (?, ?, ?)").run("hn", totalFound, newLeads);
  return { found: totalFound, new: newLeads };
}