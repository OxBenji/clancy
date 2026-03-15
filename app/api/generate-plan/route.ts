import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { rateLimitTiered } from "@/lib/rate-limit";
import { safeAuth } from "@/lib/safe-auth";
import { validateDescription } from "@/lib/sanitize";

export const maxDuration = 30;

const SYSTEM_PROMPT = `You are a project planner. Break the user's description into 5-8 tasks. Each task must be:
1. Small enough to complete in one context window
2. Have binary verifiable success criteria — things that can be checked by reading the files
3. Ordered by dependency — tasks that depend on earlier work get a higher order_index

STRICT RULE: Each task creates or modifies exactly ONE file. A task that touches index.html must ONLY touch index.html. Never combine multiple files in one task. If unsure, make it smaller.

IMPORTANT: Tasks that are independent of each other SHOULD share the same order_index so they can run in parallel. For example, creating HTML structure and creating CSS base styles can both be order_index 1 since they don't depend on each other. Only increase order_index when a task truly depends on a previous one.

For each task return:
- label: one clear action sentence
- success_criteria: array of 3-5 conditions. CRITICAL FORMAT: every criterion MUST use the pattern "filename contains literal_text_to_find". Examples:
  - "index.html contains <nav"
  - "index.html contains class=\\"profile\\""
  - "styles.css contains .hero"
  - "styles.css contains border-radius"
  - "index.html contains <!DOCTYPE html>"
  Do NOT use natural language like "has a", "exists with", "includes a section for". Only use "contains" with a literal code snippet that will appear in the file.
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
  // Tiered rate limit
  const { userId } = await safeAuth();
  const rl = rateLimitTiered(request, "generate-plan", { userId });
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

  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json(
      { error: "Server configuration error: ANTHROPIC_API_KEY is not set" },
      { status: 500 }
    );
  }

  try {
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, timeout: 5 * 60 * 1000 });

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
