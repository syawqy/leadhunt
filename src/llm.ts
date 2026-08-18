import db from "./db";

const BASE_URL = process.env.LEADHUNT_LLM_BASE_URL || "https://kenari.id/v1";
const API_KEY = process.env.LEADHUNT_LLM_API_KEY || process.env.KENARI_API_KEY || "";
const MODEL = process.env.LEADHUNT_LLM_MODEL || "deepseek-v4-flash:free";
const BATCH_SIZE = parseInt(process.env.LEADHUNT_TRIAGE_BATCH || "3");

const SYSTEM_PROMPT = `You are a lead qualification AI for a freelance web developer. Your job: read posts and decide if each author is a POTENTIAL CLIENT who wants to HIRE someone to build a website or web app.

CRITICAL — distinguish these intents:
- "hiring" = author WANTS someone to build/make/develop a website, web app, ecommerce, SaaS, landing page FOR THEM (or their business). THIS IS A LEAD.
- "offering" = author IS a developer offering services, portfolio, or selling something. NOT a lead.
- "job_seeking" = author wants to BECOME a web developer / learn / find a dev job. NOT a lead.
- "discussing" = general discussion, advice, news, no clear buying intent. NOT a lead.
- "spam" = promotions, ads, irrelevant.

I will send a JSON array of posts. Respond with a JSON ARRAY of results, SAME ORDER as input. NO markdown, NO code fences, ONLY the JSON array:

[
  {
    "id": <input id>,
    "is_lead": true|false,
    "intent": "hiring"|"offering"|"job_seeking"|"discussing"|"spam",
    "budget": "none"|"low"|"medium"|"high",     // low=<$500, medium=$500-3000, high=>$3000
    "urgency": "none"|"low"|"medium"|"high",    // do they mention time pressure?
    "project_type": "landing_page"|"web_app"|"ecommerce"|"saas"|"blog"|"redesign"|"other"|"unknown",
    "score": 0-100,                               // 0-30 not lead, 31-60 weak lead, 61-80 good lead, 81-100 hot lead
    "reasoning": "one sentence why",
    "pitch": "one sentence personalized outreach (only if is_lead, otherwise empty string)"
  }
]`;

export interface TriageResult {
  id: number;
  is_lead: boolean;
  intent: string;
  budget: string;
  urgency: string;
  project_type: string;
  score: number;
  reasoning: string;
  pitch: string;
}

export interface TriageCandidate {
  id: number;
  title: string;
  body?: string;
}

export async function triageBatch(candidates: TriageCandidate[]): Promise<Map<number, TriageResult>> {
  const results = new Map<number, TriageResult>();
  if (candidates.length === 0) return results;
  if (!API_KEY) {
    console.warn("[LLM] No API key set. Set LEADHUNT_LLM_API_KEY or KENARI_API_KEY");
    return results;
  }

  const input = candidates.map((c) => ({
    id: c.id,
    text: `${c.title}\n\n${(c.body || "").slice(0, 1200)}`.slice(0, 1500),
  }));

  const payload = {
    model: MODEL,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: `Posts: ${JSON.stringify(input)}` },
    ],
    temperature: 0.2,
    // Reasoning models (deepseek-v4) eat tokens on chain-of-thought BEFORE content.
    // Give generous headroom so the JSON content actually gets emitted.
    max_tokens: 600 * candidates.length + 1200,
    reasoning_effort: "low",
  };

  try {
    const res = await fetch(`${BASE_URL}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${API_KEY}`,
      },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const body = await res.text();
      if (res.status === 429) console.error("[LLM] HTTP 429 rate limited");
      else console.error(`[LLM] HTTP ${res.status}: ${body.slice(0, 200)}`);
      return results;
    }

    const data = await res.json() as any;
    const content = data?.choices?.[0]?.message?.content ?? "";
    const parsed = parseJsonArray(content);

    for (const item of parsed ?? []) {
      const id = Number(item.id ?? item?.input_id);
      if (!id || !candidates.some((c) => c.id === id)) continue;
      results.set(id, {
        id,
        is_lead: Boolean(item.is_lead),
        intent: item.intent || "unknown",
        budget: item.budget || "none",
        urgency: item.urgency || "none",
        project_type: item.project_type || "unknown",
        score: Math.max(0, Math.min(100, Number(item.score) || 0)),
        reasoning: item.reasoning || "",
        pitch: item.pitch || "",
      });
    }

    if (results.size < candidates.length) {
      console.warn(`[LLM] Batch partial: got ${results.size}/${candidates.length}`);
    }
  } catch (err: any) {
    console.error(`[LLM] Batch error:`, err.message);
  }

  return results;
}

/** Robust JSON array extraction. */
function parseJsonArray(content: string): any[] | null {
  if (!content) return null;
  const cleaned = content.replace(/```json|```/g, "").trim();

  try {
    const parsed = JSON.parse(cleaned);
    return Array.isArray(parsed) ? parsed : null;
  } catch { /* fall through */ }

  // Find first [ ... ] block
  const start = cleaned.indexOf("[");
  const end = cleaned.lastIndexOf("]");
  if (start !== -1 && end > start) {
    try {
      const parsed = JSON.parse(cleaned.slice(start, end + 1));
      return Array.isArray(parsed) ? parsed : null;
    } catch { /* fall through */ }
  }

  return null;
}

/** Triage all leads that haven't been triaged yet. Returns count processed. */
export async function triagePendingLeads(): Promise<number> {
  const pending = db.prepare("SELECT * FROM leads WHERE llm_triaged = 0 ORDER BY id").all() as any[];
  if (pending.length === 0) return 0;

  console.log(`[LLM] Triaging ${pending.length} leads in batches of ${BATCH_SIZE}...`);
  let processed = 0;

  for (let i = 0; i < pending.length; i += BATCH_SIZE) {
    const batch = pending.slice(i, i + BATCH_SIZE).map((l) => ({
      id: l.id,
      title: l.title,
      body: l.body,
    }));

    let results = await triageBatch(batch);

    // On total failure, retry once with longer delay
    if (results.size < batch.length) {
      await new Promise((r) => setTimeout(r, 5000));
      const retryBatch = batch.filter((b) => !results.has(b.id));
      const retryResults = await triageBatch(retryBatch);
      for (const [id, r] of retryResults) results.set(id, r);
    }

    for (const lead of batch) {
      const result = results.get(lead.id);

      if (result) {
        // Map LLM score to category
        let category = "cold";
        if (result.score >= 75 && result.is_lead) category = "hot";
        else if (result.score >= 50 && result.is_lead) category = "warm";
        else if (!result.is_lead) category = "spam";

        db.prepare(`
          UPDATE leads SET
            score = ?, category = ?,
            llm_intent = ?, llm_budget = ?, llm_urgency = ?,
            llm_project_type = ?, llm_reasoning = ?, llm_pitch = ?,
            llm_triaged = 1
          WHERE id = ?
        `).run(
          result.score / 100, // normalize to 0-1
          category,
          result.intent,
          result.budget,
          result.urgency,
          result.project_type,
          result.reasoning,
          result.pitch,
          lead.id
        );
        processed++;
      } else {
        // Leave untriaged so a future run retries (rate-limited batch)
        // Intentionally NOT marking llm_triaged = 1
        console.warn(`[LLM] Lead ${lead.id} skipped (will retry next run)`);
      }
    }

    // Gentle pacing between batches
    await new Promise((r) => setTimeout(r, 1500));
  }

  const remaining = db.prepare("SELECT COUNT(*) as n FROM leads WHERE llm_triaged = 0").get() as any;
  if (remaining.n > 0) {
    console.warn(`[LLM] ${remaining.n} leads still untriaged. Run again to retry.`);
  }

  return processed;
}