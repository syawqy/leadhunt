import { Database } from "bun:sqlite";
import { join } from "path";
import { mkdirSync } from "fs";

const DB_PATH = join(import.meta.dir, "..", "data", "leads.db");

// Ensure data directory exists
mkdirSync(join(import.meta.dir, "..", "data"), { recursive: true });

const db = new Database(DB_PATH);

// Enable WAL mode for better concurrent reads
db.exec("PRAGMA journal_mode = WAL");
db.exec("PRAGMA foreign_keys = ON");

// Create tables
db.exec(`
  CREATE TABLE IF NOT EXISTS leads (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source TEXT NOT NULL,          -- 'reddit', 'twitter', 'web'
    source_id TEXT NOT NULL,       -- unique ID from source platform
    source_url TEXT NOT NULL,      -- original URL
    title TEXT NOT NULL,           -- post title or tweet text
    body TEXT,                     -- full body text
    author TEXT,                   -- username
    score REAL DEFAULT 0,         -- AI classification score 0-1
    category TEXT DEFAULT 'unreviewed', -- 'hot', 'warm', 'cold', 'spam', 'unreviewed'
    platform TEXT,                 -- specific subreddit, twitter, etc.
    tags TEXT,                     -- JSON array of tags
    notified INTEGER DEFAULT 0,   -- 1 = already sent to Telegram
    created_at TEXT DEFAULT (datetime('now')),
    scraped_at TEXT DEFAULT (datetime('now')),
    UNIQUE(source, source_id)
  );

  CREATE TABLE IF NOT EXISTS scrape_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source TEXT NOT NULL,
    total_found INTEGER DEFAULT 0,
    new_leads INTEGER DEFAULT 0,
    error TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_leads_category ON leads(category);
  CREATE INDEX IF NOT EXISTS idx_leads_source ON leads(source);
  CREATE INDEX IF NOT EXISTS idx_leads_notified ON leads(notified);
  CREATE INDEX IF NOT EXISTS idx_leads_created ON leads(created_at DESC);
`);

// Migrate: add LLM classification columns if missing
const cols = db.prepare("PRAGMA table_info(leads)").all() as any[];
const has = (name: string) => cols.some((c: any) => c.name === name);
if (!has("llm_intent")) db.exec("ALTER TABLE leads ADD COLUMN llm_intent TEXT DEFAULT ''");
if (!has("llm_budget")) db.exec("ALTER TABLE leads ADD COLUMN llm_budget TEXT DEFAULT ''");
if (!has("llm_urgency")) db.exec("ALTER TABLE leads ADD COLUMN llm_urgency TEXT DEFAULT ''");
if (!has("llm_project_type")) db.exec("ALTER TABLE leads ADD COLUMN llm_project_type TEXT DEFAULT ''");
if (!has("llm_reasoning")) db.exec("ALTER TABLE leads ADD COLUMN llm_reasoning TEXT DEFAULT ''");
if (!has("llm_pitch")) db.exec("ALTER TABLE leads ADD COLUMN llm_pitch TEXT DEFAULT ''");
if (!has("llm_triaged")) db.exec("ALTER TABLE leads ADD COLUMN llm_triaged INTEGER DEFAULT 0");

// Seed default settings
const defaultSettings: Record<string, string> = {
  telegram_bot_token: "",
  telegram_chat_id: "",
  scrape_interval_minutes: "30",
  min_score_threshold: "0.5",
  keywords: "need web app,looking for web developer,need website,need web developer,looking for someone to build,need someone to build,need help building,need a website,hire web developer,freelance web developer,need ecommerce,need landing page,need SaaS,looking for programmer,need app developer",
  subreddits: "forhire,webdev,freelance,startups,smallbusiness,entrepreneur,SaaS,IndieBiz",
};

for (const [key, value] of Object.entries(defaultSettings)) {
  db.exec(`INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)`);
  db.prepare("INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)").run(key, value);
}

export default db;

// Helper functions
export function getSetting(key: string): string {
  const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(key) as any;
  return row?.value ?? "";
}

export function setSetting(key: string, value: string): void {
  db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)").run(key, value);
}

export function getLeads(opts: {
  category?: string;
  source?: string;
  limit?: number;
  offset?: number;
  search?: string;
} = {}): any[] {
  let query = "SELECT * FROM leads WHERE 1=1";
  const params: any[] = [];

  if (opts.category && opts.category !== "all") {
    query += " AND category = ?";
    params.push(opts.category);
  }
  if (opts.source && opts.source !== "all") {
    query += " AND source = ?";
    params.push(opts.source);
  }
  if (opts.search) {
    query += " AND (title LIKE ? OR body LIKE ?)";
    params.push(`%${opts.search}%`, `%${opts.search}%`);
  }

  query += " ORDER BY created_at DESC";
  query += ` LIMIT ? OFFSET ?`;
  params.push(opts.limit ?? 50, opts.offset ?? 0);

  return db.prepare(query).all(...params);
}

export function getLeadStats(): any {
  return db.prepare(`
    SELECT
      COUNT(*) as total,
      SUM(CASE WHEN category = 'hot' THEN 1 ELSE 0 END) as hot,
      SUM(CASE WHEN category = 'warm' THEN 1 ELSE 0 END) as warm,
      SUM(CASE WHEN category = 'cold' THEN 1 ELSE 0 END) as cold,
      SUM(CASE WHEN category = 'spam' THEN 1 ELSE 0 END) as spam,
      SUM(CASE WHEN category = 'unreviewed' THEN 1 ELSE 0 END) as unreviewed,
      SUM(CASE WHEN notified = 1 THEN 1 ELSE 0 END) as notified,
      SUM(CASE WHEN source = 'reddit' THEN 1 ELSE 0 END) as from_reddit,
      SUM(CASE WHEN source = 'twitter' THEN 1 ELSE 0 END) as from_twitter,
      SUM(CASE WHEN source = 'web' THEN 1 ELSE 0 END) as from_web,
      SUM(CASE WHEN source = 'hn' THEN 1 ELSE 0 END) as from_hn,
      SUM(CASE WHEN llm_triaged = 1 AND llm_intent = 'hiring' THEN 1 ELSE 0 END) as real_leads
    FROM leads
  `).get();
}
