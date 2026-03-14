import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";

const SYSTEM_PROMPT = `You are a project planner for a software builder tool. The user will describe something they want built. Break it into 5-10 concrete, small, buildable tasks. Each task must be specific and verifiable — not vague. Return ONLY a valid JSON array, no markdown, no explanation. Each item has: label (string), estimated_seconds (number between 15 and 60), order_index (number starting at 1)`;

interface RawTask {
  label: unknown;
  estimated_seconds: unknown;
  order_index: unknown;
}

function validateTasks(
  raw: unknown
): { label: string; estimated_seconds: number; order_index: number }[] | null {
  if (!Array.isArray(raw) || raw.length === 0) return null;

  const validated = [];
  for (const item of raw as RawTask[]) {
    if (
      typeof item.label !== "string" ||
      typeof item.estimated_seconds !== "number" ||
      typeof item.order_index !== "number"
    ) {
      return null;
    }
    validated.push({
      label: item.label,
      estimated_seconds: Math.max(15, Math.min(60, item.estimated_seconds)),
      order_index: item.order_index,
    });
  }

  return validated;
}

export async function POST(request: Request) {
  let body: { description?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body" },
      { status: 400 }
    );
  }

  const { description } = body;

  if (
    !description ||
    typeof description !== "string" ||
    description.trim().length < 10
  ) {
    return NextResponse.json(
      { error: "description is required and must be at least 10 characters" },
      { status: 400 }
    );
  }

  try {
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

    const message = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: description.trim() }],
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
