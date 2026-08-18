# 🎯 LeadHunt

Automated lead generation for web developers. Monitors Reddit, Hacker News, and web search to find people who **want to hire** someone to build a website/web app — then uses an LLM to verify intent and score lead quality.

## Features

- 🔍 **Multi-source scraping** — Reddit (OAuth), Hacker News (Algolia API), DuckDuckGo web search
- 🧠 **LLM triage** — `deepseek-v4-flash:free` (Kenari) classifies every lead: intent, budget, urgency, project type, score 0-100
- 🎯 **Intent detection** — distinguishes *hiring* (real lead) vs *offering* / *job-seeking* / *discussing* / *spam*
- 💬 **Auto-draft pitches** — LLM writes a personalized outreach message per lead
- 📊 **Web dashboard** — dark-themed real-time dashboard
- 📬 **Telegram notifications** — only LLM-verified hiring leads
- ⏰ **Auto-scrape** — configurable interval (default: 30 min)

## Stack

- **Runtime:** Bun
- **Server:** Hono
- **Database:** SQLite (bun:sqlite)
- **Scraping:** Reddit OAuth API + HN Algolia API + Puppeteer (DDG)
- **LLM:** OpenAI-compatible endpoint (default: Kenari `deepseek-v4-flash:free`)
- **Notifications:** Grammy (Telegram Bot)

## Quick Start

```bash
git clone https://github.com/syawqy/leadhunt.git
cd leadhunt
bun install
cp .env.example .env   # set your LLM API key
bun run dev
```

Dashboard: http://localhost:8890

## Configuration

### `.env`

| Variable | Default | Description |
|----------|---------|-------------|
| `LEADHUNT_LLM_BASE_URL` | `https://kenari.id/v1` | OpenAI-compatible endpoint |
| `LEADHUNT_LLM_API_KEY` | — | API key (required for triage) |
| `LEADHUNT_LLM_MODEL` | `deepseek-v4-flash:free` | Model for classification |
| `REDDIT_CLIENT_ID` | — | Reddit script app ID (optional) |
| `REDDIT_CLIENT_SECRET` | — | Reddit script app secret (optional) |

### Via Dashboard

Open Settings (⚙️):
- Telegram Bot Token + Chat ID
- Subreddits to monitor (Reddit OAuth)
- Keywords
- Scrape interval

## Pipeline

```
┌────────────┐ ┌────────────┐ ┌────────────┐
│   Reddit   │ │  Hacker    │ │  Web scan  │
│  (OAuth)   │ │   News     │ │   (DDG)    │
└─────┬──────┘ └─────┬──────┘ └─────┬──────┘
      └──────────────┼──────────────┘
                     ▼
           ┌─────────────────┐
           │  Pre-filter     │  buying-intent regex, junk-domain blocklist
           └────────┬────────┘
                    ▼
           ┌─────────────────┐
           │   LLM triage    │  intent / budget / urgency / score / pitch
           └────────┬────────┘
                    ▼
           ┌─────────────────┐
           │  SQLite +        │
           │  Dashboard       │
           └────────┬────────┘
                    ▼
           ┌─────────────────┐
           │  Telegram        │  only hot + warm + intent=hiring
           └─────────────────┘
```

## Notes on Sources

- **Reddit** blocks anonymous/cloud IPs — use a free Reddit script app (https://www.reddit.com/prefs/apps). Without credentials, Reddit leads still arrive via the web-search scraper (DDG indexes Reddit threads).
- **Twitter** scraping was removed — DDG `site:twitter.com` returns platform docs, not tweets; and API free tier is unreliable. HN Algolia covers similar community signals reliably.
- **HN Algolia** is free, no auth, no rate limits.

## API

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/stats` | GET | Dashboard statistics |
| `/api/leads` | GET | List leads (filter: category, source, search) |
| `/api/settings` | GET/POST | Get/update settings |
| `/api/scrape` | POST | Trigger manual scrape + triage |
| `/api/notify` | POST | Send Telegram notifications |
| `/api/leads/:id/category` | POST | Update lead category |
| `/api/leads/:id` | DELETE | Delete a lead |

## License

MIT