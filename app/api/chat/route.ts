import Anthropic from "@anthropic-ai/sdk";

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
  let body: {
    messages?: { role: "user" | "assistant"; content: string }[];
  };
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const { messages } = body;

  if (!Array.isArray(messages) || messages.length === 0) {
    return new Response(
      JSON.stringify({ error: "messages array is required" }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  try {
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

    const stream = client.messages.stream({
      model: "claude-sonnet-4-6",
      max_tokens: 2048,
      system: CHAT_SYSTEM_PROMPT,
      messages: messages.map((m) => ({
        role: m.role,
        content: m.content,
      })),
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
