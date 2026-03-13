import Anthropic from "@anthropic-ai/sdk";
import { supabase } from "@/lib/supabase";

const SYSTEM_PROMPT = `You are an autonomous software agent. You are executing one task from a larger project. Describe exactly what you are doing step by step as you work. Be specific and technical. Output 3-5 short action lines.`;

interface Task {
  id: string;
  label: string;
  order_index: number;
}

function sseEvent(event: string, data: Record<string, unknown>): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

export async function POST(request: Request) {
  let body: { project_id?: string; tasks?: Task[] };
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const { project_id, tasks } = body;

  if (!project_id || typeof project_id !== "string") {
    return new Response(JSON.stringify({ error: "project_id is required" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  if (!Array.isArray(tasks) || tasks.length === 0) {
    return new Response(JSON.stringify({ error: "tasks array is required and must not be empty" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const sorted = [...tasks].sort((a, b) => a.order_index - b.order_index);

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      const send = (event: string, data: Record<string, unknown>) => {
        controller.enqueue(encoder.encode(sseEvent(event, data)));
      };

      const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

      for (const task of sorted) {
        const startTime = Date.now();

        send("task_start", { task_id: task.id, label: task.label });

        // Mark task as active in Supabase
        await supabase
          .from("tasks")
          .update({ status: "active" })
          .eq("id", task.id);

        try {
          const response = await client.messages.create({
            model: "claude-sonnet-4-6",
            max_tokens: 512,
            system: SYSTEM_PROMPT,
            messages: [
              {
                role: "user",
                content: `Execute this task: "${task.label}"`,
              },
            ],
          });

          const textBlock = response.content.find((b) => b.type === "text");
          if (textBlock && textBlock.type === "text") {
            const lines = textBlock.text
              .split("\n")
              .map((l) => l.trim())
              .filter(Boolean);

            for (const line of lines) {
              send("agent_log", { task_id: task.id, log: line });
            }
          }

          const duration = Math.round((Date.now() - startTime) / 1000);

          // Mark task as done in Supabase
          await supabase
            .from("tasks")
            .update({ status: "done", duration_seconds: duration })
            .eq("id", task.id);

          send("task_complete", { task_id: task.id, duration });
        } catch (err: unknown) {
          const message =
            err instanceof Error ? err.message : "Unknown error";

          // Mark task as failed in Supabase
          await supabase
            .from("tasks")
            .update({ status: "error" })
            .eq("id", task.id);

          send("task_error", { task_id: task.id, error: message });
        }
      }

      // Update project status
      await supabase
        .from("projects")
        .update({ status: "complete" })
        .eq("id", project_id);

      send("build_complete", { message: "Your project is ready." });

      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
