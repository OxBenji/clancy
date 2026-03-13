import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";

const SYSTEM_PROMPT = `You are a project planner for a software builder tool. The user will describe something they want built. Break it into 5-10 concrete, small, buildable tasks. Each task must be specific and verifiable — not vague. Return ONLY a valid JSON array, no markdown, no explanation. Each item has: label (string), estimated_seconds (number between 15 and 60), order_index (number starting at 1)`;

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

  if (!description || typeof description !== "string" || description.trim().length < 10) {
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

    const tasks = JSON.parse(textBlock.text);

    return NextResponse.json({ tasks });
  } catch (err: unknown) {
    const errorMessage =
      err instanceof Error ? err.message : "Unknown error calling Anthropic";
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}
