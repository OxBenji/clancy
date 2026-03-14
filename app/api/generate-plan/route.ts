import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { rateLimit, getRequestIP } from "@/lib/rate-limit";
import { validateDescription } from "@/lib/sanitize";

export const maxDuration = 30;

const SYSTEM_PROMPT = `You are a project planner. Break the user's description into 5-8 tasks. Each task must be:
1. Small enough to complete in one context window
2. Have binary verifiable success criteria — things that can be checked by reading the files
3. Ordered by dependency — each task builds on the previous

For each task return:
- label: one clear action sentence
- success_criteria: array of 3-5 file-checkable conditions (e.g. "index.html contains <nav>", "styles.css contains .hero class")
- estimated_seconds: 20-60
- order_index: number starting at 1

Return JSON array only. No markdown.`;

interface RawTask {
  label: unknown;
  estimated_seconds: unknown;
  order_index: unknown;
  success_criteria: unknown;
}

function validateTasks(
  raw: unknown
): { label: string; estimated_seconds: number; order_index: number; success_criteria: string[] }[] | null {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > 20) return null;

  const validated = [];
  for (const item of raw as RawTask[]) {
    if (
      typeof item.label !== "string" ||
      typeof item.estimated_seconds !== "number" ||
      typeof item.order_index !== "number"
    ) {
      return null;
    }

    // Parse success_criteria — default to empty array if missing
    let criteria: string[] = [];
    if (Array.isArray(item.success_criteria)) {
      criteria = item.success_criteria
        .filter((c): c is string => typeof c === "string")
        .slice(0, 10)
        .map((c) => c.slice(0, 200));
    }

    validated.push({
      label: item.label.slice(0, 200),
      estimated_seconds: Math.max(15, Math.min(60, item.estimated_seconds)),
      order_index: item.order_index,
      success_criteria: criteria,
    });
  }

  return validated;
}

export async function POST(request: Request) {
  // Rate limit: 10 requests per IP per minute
  const ip = getRequestIP(request);
  const rl = rateLimit(`generate-plan:${ip}`, { maxRequests: 10, windowMs: 60_000 });
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "Too many requests. Please wait before trying again." },
      { status: 429 }
    );
  }

  let body: { description?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body" },
      { status: 400 }
    );
  }

  const descResult = validateDescription(body.description);
  if (!descResult.valid) {
    return NextResponse.json({ error: descResult.error }, { status: 400 });
  }

  try {
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

    const message = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 2048,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: descResult.value }],
    });

    const textBlock = message.content.find((block) => block.type === "text");
    if (!textBlock || textBlock.type !== "text") {
      return NextResponse.json(
        { error: "No text response from Anthropic" },
        { status: 500 }
      );
    }

    // Strip potential markdown code fences before parsing
    let jsonText = textBlock.text.trim();
    if (jsonText.startsWith("```")) {
      jsonText = jsonText
        .replace(/^```(?:json)?\s*\n?/, "")
        .replace(/\n?\s*```$/, "");
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(jsonText);
    } catch {
      return NextResponse.json(
        { error: "AI returned invalid JSON. Please try again." },
        { status: 502 }
      );
    }

    const tasks = validateTasks(parsed);
    if (!tasks) {
      return NextResponse.json(
        { error: "AI returned unexpected format. Please try again." },
        { status: 502 }
      );
    }

    return NextResponse.json({ tasks });
  } catch (err: unknown) {
    const errorMessage =
      err instanceof Error ? err.message : "Unknown error calling Anthropic";
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}
