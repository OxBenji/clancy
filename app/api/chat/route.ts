import Anthropic from "@anthropic-ai/sdk";
import { rateLimitTiered } from "@/lib/rate-limit";
import { auth } from "@clerk/nextjs/server";
import { validateMessages } from "@/lib/sanitize";

export const maxDuration = 60;

const CHAT_SYSTEM_PROMPT = `You are Clancy, a friendly and knowledgeable coding assistant. You help users with programming questions, debugging, code reviews, and technical guidance.

Guidelines:
- Be concise and direct
- Use code blocks with language tags for code examples
- Explain concepts simply — many users are beginners or non-developers
- If asked about building something, give practical step-by-step guidance
- You can help with HTML, CSS, JavaScript, TypeScript, React, Next.js, Python, and general programming
- Always be encouraging — users are learning and building
- If a question is vague, ask a clarifying question`;

export async function POST(request: Request) {
  const { userId } = await auth();
  const rl = rateLimitTiered(request, "chat", { userId });
  if (!rl.allowed) {
    return new Response(JSON.stringify({ error: "Too many requests" }), {
      status: 429,
      headers: { "Content-Type": "application/json" },
    });
  }

  let body: { messages?: unknown };
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const msgResult = validateMessages(body.messages);
  if (!msgResult.valid) {
    return new Response(JSON.stringify({ error: msgResult.error }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return new Response(
      JSON.stringify({ error: "Server configuration error: ANTHROPIC_API_KEY is not set" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }

  try {
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, timeout: 5 * 60 * 1000 });

    const stream = client.messages.stream({
      model: "claude-sonnet-4-6",
      max_tokens: 2048,
      system: CHAT_SYSTEM_PROMPT,
      messages: msgResult.value,
    });

    const readableStream = new ReadableStream({
      async start(controller) {
        const encoder = new TextEncoder();

        stream.on("text", (text) => {
          try {
            controller.enqueue(
              encoder.encode(
                `event: text\ndata: ${JSON.stringify({ text })}\n\n`
              )
            );
          } catch {
            // closed
          }
        });

        stream.on("end", () => {
          try {
            controller.enqueue(
              encoder.encode(`event: done\ndata: {}\n\n`)
            );
            controller.close();
          } catch {
            // closed
          }
        });

        stream.on("error", (err) => {
          try {
            controller.enqueue(
              encoder.encode(
                `event: error\ndata: ${JSON.stringify({ error: err.message })}\n\n`
              )
            );
            controller.close();
          } catch {
            // closed
          }
        });
      },
    });

    return new Response(readableStream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  } catch (err: unknown) {
    const errorMessage =
      err instanceof Error ? err.message : "Unknown error";
    return new Response(JSON.stringify({ error: errorMessage }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}
