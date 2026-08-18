import { Hono } from "hono";
import { serve } from "bun";
import { getLeads, getLeadStats, getSetting, setSetting } from "./db";
import { runScrape } from "./scrape";
import { sendTelegramNotification, sendSummary } from "./telegram";

const app = new Hono();

// --- API Routes ---

// Get dashboard stats
app.get("/api/stats", (c) => {
  const stats = getLeadStats();
  return c.json(stats);
});

// Get leads
app.get("/api/leads", (c) => {
  const category = c.req.query("category") || "all";
  const source = c.req.query("source") || "all";
  const search = c.req.query("search") || "";
  const limit = parseInt(c.req.query("limit") || "50");
  const offset = parseInt(c.req.query("offset") || "0");

  const leads = getLeads({ category, source, search, limit, offset });
  return c.json(leads);
});

// Get settings
app.get("/api/settings", (c) => {
  const keys = [
    "telegram_bot_token", "telegram_chat_id", "subreddits",
    "keywords", "scrape_interval_minutes", "min_score_threshold",
  ];
  const settings: Record<string, string> = {};
  for (const key of keys) {
    settings[key] = getSetting(key);
  }
  // Mask token
  if (settings.telegram_bot_token) {
    settings.telegram_bot_token = settings.telegram_bot_token.slice(0, 10) + "..." + settings.telegram_bot_token.slice(-4);
  }
  return c.json(settings);
});

// Update settings
app.post("/api/settings", async (c) => {
  const body = await c.req.json();
  for (const [key, value] of Object.entries(body)) {
    if (typeof value === "string") {
      setSetting(key, value);
    }
  }
  return c.json({ ok: true });
});

// Trigger manual scrape
app.post("/api/scrape", async (c) => {
  // Run scrape in background
  runScrape().catch(console.error);
  return c.json({ ok: true, message: "Scrape started" });
});

// Trigger notification
app.post("/api/notify", async (c) => {
  const count = await sendTelegramNotification();
  return c.json({ ok: true, sent: count });
});

// Mark lead category
app.post("/api/leads/:id/category", async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json();
  const { category } = body;

  if (!["hot", "warm", "cold", "spam"].includes(category)) {
    return c.json({ error: "Invalid category" }, 400);
  }

  db.prepare("UPDATE leads SET category = ? WHERE id = ?").run(category, id);
  return c.json({ ok: true });
});

// Delete lead
app.delete("/api/leads/:id", (c) => {
  const id = c.req.param("id");
  db.prepare("DELETE FROM leads WHERE id = ?").run(id);
  return c.json({ ok: true });
});

// --- Dashboard HTML ---

app.get("/", (c) => {
  return c.html(DASHBOARD_HTML);
});

// --- Start Server ---

const PORT = parseInt(process.env.PORT || "8889");

serve({
  fetch: app.fetch,
  port: PORT,
});

console.log(`\n🎯 LeadHunt running at http://localhost:${PORT}`);
console.log(`📊 Dashboard: http://localhost:${PORT}`);
console.log(`🔍 Manual scrape: POST http://localhost:${PORT}/api/scrape`);

// Auto-scrape on startup
setTimeout(() => {
  console.log("🔄 Running initial scrape...");
  runScrape().catch(console.error);
}, 5000);

// Periodic scrape
const interval = parseInt(getSetting("scrape_interval_minutes") || "30") * 60 * 1000;
setInterval(() => {
  runScrape().catch(console.error);
}, interval);

// Daily summary at 9am
const now = new Date();
const next9am = new Date(now);
next9am.setHours(9, 0, 0, 0);
if (next9am <= now) next9am.setDate(next9am.getDate() + 1);
setTimeout(() => {
  sendSummary().catch(console.error);
  setInterval(() => sendSummary().catch(console.error), 24 * 60 * 60 * 1000);
}, next9am.getTime() - now.getTime());

// --- Dashboard HTML ---

const DASHBOARD_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>🎯 LeadHunt — Web Dev Lead Generator</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0f172a; color: #e2e8f0; min-height: 100vh; }

    .header { background: linear-gradient(135deg, #1e293b 0%, #0f172a 100%); border-bottom: 1px solid #334155; padding: 16px 24px; display: flex; align-items: center; justify-content: space-between; }
    .header h1 { font-size: 20px; font-weight: 700; }
    .header h1 span { color: #f59e0b; }
    .header-actions { display: flex; gap: 8px; }

    .btn { padding: 8px 16px; border-radius: 8px; border: none; cursor: pointer; font-size: 13px; font-weight: 600; transition: all 0.2s; }
    .btn-primary { background: #3b82f6; color: white; }
    .btn-primary:hover { background: #2563eb; }
    .btn-warning { background: #f59e0b; color: #0f172a; }
    .btn-warning:hover { background: #d97706; }
    .btn-danger { background: #ef4444; color: white; }
    .btn-danger:hover { background: #dc2626; }
    .btn-sm { padding: 4px 10px; font-size: 12px; }

    .stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 12px; padding: 16px 24px; }
    .stat-card { background: #1e293b; border: 1px solid #334155; border-radius: 12px; padding: 16px; text-align: center; }
    .stat-card .value { font-size: 28px; font-weight: 800; }
    .stat-card .label { font-size: 12px; color: #94a3b8; margin-top: 4px; }
    .stat-hot .value { color: #ef4444; }
    .stat-warm .value { color: #f59e0b; }
    .stat-cold .value { color: #3b82f6; }

    .filters { padding: 0 24px 12px; display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
    .filter-btn { padding: 6px 14px; border-radius: 20px; border: 1px solid #475569; background: transparent; color: #94a3b8; cursor: pointer; font-size: 12px; font-weight: 500; transition: all 0.2s; }
    .filter-btn.active { background: #3b82f6; color: white; border-color: #3b82f6; }
    .search-input { background: #1e293b; border: 1px solid #475569; border-radius: 8px; padding: 6px 12px; color: #e2e8f0; font-size: 13px; width: 250px; }
    .search-input:focus { outline: none; border-color: #3b82f6; }

    .leads { padding: 0 24px 24px; }
    .lead-card { background: #1e293b; border: 1px solid #334155; border-radius: 12px; padding: 16px; margin-bottom: 8px; transition: all 0.2s; }
    .lead-card:hover { border-color: #475569; transform: translateY(-1px); }
    .lead-header { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
    .lead-badge { padding: 2px 8px; border-radius: 4px; font-size: 11px; font-weight: 700; text-transform: uppercase; }
    .badge-hot { background: #7f1d1d; color: #fca5a5; }
    .badge-warm { background: #78350f; color: #fcd34d; }
    .badge-cold { background: #1e3a5f; color: #93c5fd; }
    .badge-reddit { background: #7c2d12; color: #fdba74; }
    .badge-twitter { background: #1e3a5f; color: #93c5fd; }
    .badge-web { background: #14532d; color: #86efac; }
    .lead-title { font-size: 15px; font-weight: 600; flex: 1; }
    .lead-title a { color: #e2e8f0; text-decoration: none; }
    .lead-title a:hover { color: #3b82f6; }
    .lead-body { font-size: 13px; color: #94a3b8; line-height: 1.5; margin-bottom: 8px; }
    .lead-meta { display: flex; gap: 12px; font-size: 12px; color: #64748b; align-items: center; }
    .lead-actions { display: flex; gap: 4px; margin-left: auto; }

    .score-bar { width: 60px; height: 6px; background: #334155; border-radius: 3px; overflow: hidden; display: inline-block; vertical-align: middle; }
    .score-fill { height: 100%; border-radius: 3px; }
    .score-high { background: #ef4444; }
    .score-mid { background: #f59e0b; }
    .score-low { background: #3b82f6; }

    .empty { text-align: center; padding: 60px 24px; color: #64748b; }
    .empty h3 { font-size: 18px; margin-bottom: 8px; }

    .settings-panel { display: none; padding: 24px; }
    .settings-panel.show { display: block; }
    .settings-group { margin-bottom: 16px; }
    .settings-group label { display: block; font-size: 13px; color: #94a3b8; margin-bottom: 4px; }
    .settings-group input, .settings-group textarea { width: 100%; background: #1e293b; border: 1px solid #475569; border-radius: 8px; padding: 8px 12px; color: #e2e8f0; font-size: 13px; }
    .settings-group textarea { min-height: 80px; resize: vertical; }

    @media (max-width: 640px) {
      .stats { grid-template-columns: repeat(2, 1fr); }
      .header { flex-direction: column; gap: 12px; }
      .search-input { width: 100%; }
    }
  </style>
</head>
<body>
  <div class="header">
    <h1>🎯 <span>Lead</span>Hunt</h1>
    <div class="header-actions">
      <button class="btn btn-primary" onclick="triggerScrape()" id="scrapeBtn">🔍 Scrape Now</button>
      <button class="btn btn-warning" onclick="sendNotify()">📬 Notify</button>
      <button class="btn btn-sm" style="background:#334155;color:#94a3b8" onclick="toggleSettings()">⚙️</button>
    </div>
  </div>

  <div class="stats" id="stats"></div>

  <div id="settingsPanel" class="settings-panel">
    <h3 style="margin-bottom:16px">⚙️ Settings</h3>
    <div class="settings-group">
      <label>Telegram Bot Token</label>
      <input id="cfg_token" type="password" placeholder="123456:ABC..." />
    </div>
    <div class="settings-group">
      <label>Telegram Chat ID</label>
      <input id="cfg_chatid" placeholder="-100..." />
    </div>
    <div class="settings-group">
      <label>Subreddits (comma-separated)</label>
      <input id="cfg_subreddits" placeholder="forhire,webdev,freelance" />
    </div>
    <div class="settings-group">
      <label>Keywords (comma-separated)</label>
      <textarea id="cfg_keywords" placeholder="need web app,looking for developer..."></textarea>
    </div>
    <div class="settings-group">
      <label>Scrape Interval (minutes)</label>
      <input id="cfg_interval" type="number" value="30" />
    </div>
    <button class="btn btn-primary" onclick="saveSettings()">💾 Save Settings</button>
  </div>

  <div class="filters">
    <button class="filter-btn active" data-filter="all" onclick="setFilter('all',this)">All</button>
    <button class="filter-btn" data-filter="hot" onclick="setFilter('hot',this)">🔥 Hot</button>
    <button class="filter-btn" data-filter="warm" onclick="setFilter('warm',this)">🟡 Warm</button>
    <button class="filter-btn" data-filter="cold" onclick="setFilter('cold',this)">🔵 Cold</button>
    <button class="filter-btn" data-filter="spam" onclick="setFilter('spam',this)">🗑️ Spam</button>
    <input class="search-input" placeholder="🔍 Search leads..." oninput="debounceSearch(this.value)" />
  </div>

  <div class="leads" id="leads"></div>

  <script>
    let currentFilter = 'all';
    let searchQuery = '';
    let searchTimeout;

    async function loadStats() {
      const res = await fetch('/api/stats');
      const s = await res.json();
      document.getElementById('stats').innerHTML = \`
        <div class="stat-card"><div class="value">\${s.total || 0}</div><div class="label">Total Leads</div></div>
        <div class="stat-card"><div class="value" style="color:#22c55e">\${s.real_leads || 0}</div><div class="label">✅ Real Leads</div></div>
        <div class="stat-card stat-hot"><div class="value">\${s.hot || 0}</div><div class="label">🔥 Hot</div></div>
        <div class="stat-card stat-warm"><div class="value">\${s.warm || 0}</div><div class="label">🟡 Warm</div></div>
        <div class="stat-card stat-cold"><div class="value">\${s.cold || 0}</div><div class="label">🔵 Cold</div></div>
        <div class="stat-card"><div class="value">\${s.notified || 0}</div><div class="label">📬 Notified</div></div>
        <div class="stat-card"><div class="value">\${(s.from_reddit||0)}</div><div class="label">Reddit</div></div>
        <div class="stat-card"><div class="value">\${(s.from_web||0)}</div><div class="label">Web</div></div>
        <div class="stat-card"><div class="value">\${(s.from_hn||0)}</div><div class="label">HN</div></div>
      \`;
    }

    async function loadLeads() {
      const params = new URLSearchParams();
      if (currentFilter !== 'all') params.set('category', currentFilter);
      if (searchQuery) params.set('search', searchQuery);

      const res = await fetch('/api/leads?' + params);
      const leads = await res.json();

      if (leads.length === 0) {
        document.getElementById('leads').innerHTML = '<div class="empty"><h3>No leads found</h3><p>Click "Scrape Now" to start searching</p></div>';
        return;
      }

      document.getElementById('leads').innerHTML = leads.map(l => {
        const scorePct = Math.round(l.score * 100);
        const scoreClass = scorePct >= 60 ? 'score-high' : scorePct >= 30 ? 'score-mid' : 'score-low';
        const badgeClass = 'badge-' + l.category;
        const sourceClass = 'badge-' + l.source;

        const llmInfo = l.llm_triaged ? [
          l.llm_intent ? '<span style="color:#22c55e">🎯 ' + escHtml(l.llm_intent) + '</span>' : '',
          l.llm_project_type && l.llm_project_type !== 'unknown' ? '<span>🛠️ ' + escHtml(l.llm_project_type) + '</span>' : '',
          l.llm_budget && l.llm_budget !== 'none' ? '<span>💵 ' + escHtml(l.llm_budget) + '</span>' : '',
          l.llm_urgency && l.llm_urgency !== 'none' ? '<span>⚡ ' + escHtml(l.llm_urgency) + '</span>' : '',
        ].filter(Boolean).join(' · ') : '<span style="color:#64748b">⏳ pending LLM...</span>';

        return \`
          <div class="lead-card">
            <div class="lead-header">
              <span class="lead-badge \${badgeClass}">\${l.category}</span>
              <span class="lead-badge \${sourceClass}">\${l.source}</span>
              <div class="lead-title"><a href="\${l.source_url}" target="_blank">\${escHtml(l.title)}</a></div>
            </div>
            \${l.body ? '<div class="lead-body">' + escHtml(l.body.slice(0, 400)) + '</div>' : ''}
            <div class="lead-meta">
              <span>\${l.author ? '👤 u/' + escHtml(l.author) : ''}</span>
              <span>📍 \${escHtml(l.platform || l.source)}</span>
              <span>
                <span class="score-bar"><span class="score-fill \${scoreClass}" style="width:\${scorePct}%"></span></span>
                \${scorePct}%
              </span>
              <span>\${new Date(l.created_at).toLocaleDateString()}</span>
              <span>\${llmInfo}</span>
              <div class="lead-actions">
                <button class="btn btn-sm btn-primary" onclick="setCategory(\${l.id},'hot')">🔥</button>
                <button class="btn btn-sm btn-warning" onclick="setCategory(\${l.id},'warm')">🟡</button>
                <button class="btn btn-sm" style="background:#1e3a5f;color:#93c5fd" onclick="setCategory(\${l.id},'cold')">🔵</button>
                <button class="btn btn-sm btn-danger" onclick="deleteLead(\${l.id})">🗑</button>
              </div>
            </div>
          </div>
        \`;
      }).join('');
    }

    function escHtml(s) { const d = document.createElement('div'); d.textContent = s || ''; return d.innerHTML; }

    function setFilter(f, el) {
      currentFilter = f;
      document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
      el.classList.add('active');
      loadLeads();
    }

    function debounceSearch(v) {
      clearTimeout(searchTimeout);
      searchTimeout = setTimeout(() => { searchQuery = v; loadLeads(); }, 300);
    }

    async function setCategory(id, cat) {
      await fetch('/api/leads/' + id + '/category', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({category: cat}) });
      loadLeads(); loadStats();
    }

    async function deleteLead(id) {
      if (!confirm('Delete this lead?')) return;
      await fetch('/api/leads/' + id, { method: 'DELETE' });
      loadLeads(); loadStats();
    }

    async function triggerScrape() {
      const btn = document.getElementById('scrapeBtn');
      btn.textContent = '⏳ Scraping...';
      btn.disabled = true;
      await fetch('/api/scrape', { method: 'POST' });
      setTimeout(() => { btn.textContent = '🔍 Scrape Now'; btn.disabled = false; loadLeads(); loadStats(); }, 10000);
    }

    async function sendNotify() {
      const res = await fetch('/api/notify', { method: 'POST' });
      const data = await res.json();
      alert('Sent ' + data.sent + ' notifications');
    }

    function toggleSettings() {
      const p = document.getElementById('settingsPanel');
      p.classList.toggle('show');
      if (p.classList.contains('show')) loadSettings();
    }

    async function loadSettings() {
      const res = await fetch('/api/settings');
      const s = await res.json();
      document.getElementById('cfg_token').value = s.telegram_bot_token || '';
      document.getElementById('cfg_chatid').value = s.telegram_chat_id || '';
      document.getElementById('cfg_subreddits').value = s.subreddits || '';
      document.getElementById('cfg_keywords').value = s.keywords || '';
      document.getElementById('cfg_interval').value = s.scrape_interval_minutes || 30;
    }

    async function saveSettings() {
      await fetch('/api/settings', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({
        telegram_bot_token: document.getElementById('cfg_token').value,
        telegram_chat_id: document.getElementById('cfg_chatid').value,
        subreddits: document.getElementById('cfg_subreddits').value,
        keywords: document.getElementById('cfg_keywords').value,
        scrape_interval_minutes: document.getElementById('cfg_interval').value,
      })});
      alert('Settings saved!');
    }

    // Auto-refresh every 30s
    loadStats(); loadLeads();
    setInterval(() => { loadStats(); loadLeads(); }, 30000);
  </script>
</body>
</html>`;
