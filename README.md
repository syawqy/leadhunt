# 🎯 LeadHunt

Automated lead generation for web developers. Monitors Reddit, Twitter, and web search to find people who need web app development services.

## Features

- 🔍 **Multi-source scraping** — Reddit, Twitter/X, DuckDuckGo web search
- 🧠 **Smart scoring** — keyword-based lead quality scoring
- 📊 **Web dashboard** — dark-themed real-time dashboard
- 📬 **Telegram notifications** — auto-notify on hot leads
- ⏰ **Auto-scrape** — configurable interval (default: 30 min)
- 🏷️ **Lead categorization** — hot/warm/cold/spam
- 🔎 **Search & filter** — full-text search + category filters

## Stack

- **Runtime:** Bun
- **Server:** Hono
- **Database:** SQLite (bun:sqlite)
- **Scraping:** Reddit JSON API + Puppeteer (DDG)
- **Notifications:** Grammy (Telegram Bot)

## Quick Start

```bash
git clone https://github.com/syawqy/leadhunt.git
cd leadhunt
bun install
bun run dev
```

Dashboard: http://localhost:8890

## Configuration

### Via Dashboard

Open Settings panel (⚙️) in the dashboard to configure:
- Telegram Bot Token + Chat ID
- Subreddits to monitor
- Keywords for lead matching
- Scrape interval

### Via API

```bash
# Update settings
curl -X POST http://localhost:8890/api/settings \
  -H "Content-Type: application/json" \
  -d '{"telegram_bot_token":"YOUR_TOKEN","telegram_chat_id":"YOUR_CHAT_ID"}'

# Manual scrape
curl -X POST http://localhost:8890/api/scrape

# Get leads
curl http://localhost:8890/api/leads?category=hot
```

## Monitored Sources

### Reddit
- r/forhire, r/webdev, r/freelance
- r/startups, r/smallbusiness, r/entrepreneur
- r/SaaS, r/IndieBiz

### Web Search
- DuckDuckGo HTML search
- Keywords: "need web app", "looking for developer", etc.

### Twitter/X
- Via DuckDuckGo site search
- Keywords: "hire web developer", "need website", etc.

## API

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/stats` | GET | Dashboard statistics |
| `/api/leads` | GET | List leads (filter: category, source, search) |
| `/api/settings` | GET/POST | Get/update settings |
| `/api/scrape` | POST | Trigger manual scrape |
| `/api/notify` | POST | Send Telegram notifications |
| `/api/leads/:id/category` | POST | Update lead category |
| `/api/leads/:id` | DELETE | Delete a lead |

## Telegram Setup

1. Create a bot via [@BotFather](https://t.me/BotFather)
2. Get your chat ID via [@userinfobot](https://t.me/userinfobot)
3. Add credentials in dashboard Settings or via API

## License

MIT
