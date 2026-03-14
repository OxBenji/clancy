import {
  createProjectSandbox,
  runCommandStreaming,
  getPreviewUrl,
} from "@/lib/sandbox";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { runRalphLoop } from "@/lib/ralph";
import { rateLimit, getRequestIP } from "@/lib/rate-limit";
import { validateDescription, clampString } from "@/lib/sanitize";
import type { RalphTask } from "@/lib/ralph";

interface TaskInput {
  id: string;
  label: string;
  order_index: number;
}

function sseEvent(event: string, data: Record<string, unknown>): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

export async function POST(request: Request) {
  // Rate limit: 10 requests per IP per minute
  const ip = getRequestIP(request);
  const rl = rateLimit(`run-agent:${ip}`, { maxRequests: 10, windowMs: 60_000 });
  if (!rl.allowed) {
    return new Response(
      JSON.stringify({ error: "Too many requests. Please wait before trying again." }),
      { status: 429, headers: { "Content-Type": "application/json" } }
    );
  }

  let body: { project_id?: string; tasks?: TaskInput[]; description?: string };
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const { project_id, tasks, description } = body;

  if (!project_id || typeof project_id !== "string") {
    return new Response(JSON.stringify({ error: "project_id is required" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  if (!Array.isArray(tasks) || tasks.length === 0 || tasks.length > 20) {
    return new Response(
      JSON.stringify({ error: "tasks array is required (1-20 items)" }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  // Validate description
  const descResult = validateDescription(description ?? "A web project");
  const safeDescription = descResult.valid ? descResult.value : "A web project";

  // Validate task labels
  const ralphTasks: RalphTask[] = tasks.map((t) => ({
    id: t.id,
    label: clampString(t.label || "", 200),
    order_index: t.order_index,
  }));

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      const send = (event: string, data: Record<string, unknown>) => {
        try {
          controller.enqueue(encoder.encode(sseEvent(event, data)));
        } catch {
          // Controller may be closed
        }
      };

      try {
        send("agent_log", {
          task_id: "system",
          log: "Spinning up sandbox environment...",
        });

        const sandbox = await createProjectSandbox();

        send("sandbox_id", { id: sandbox.sandboxId });
        send("agent_log", {
          task_id: "system",
          log: `Sandbox ready (${sandbox.sandboxId}). Starting Ralph loop...`,
        });

        await runCommandStreaming(sandbox, "mkdir -p /home/user/project");

        // ── Run the Ralph loop ──
        const { totalCostUsd } = await runRalphLoop(
          project_id,
          safeDescription,
          ralphTasks,
          sandbox,
          ({ event, data }) => send(event, data)
        );

        // ── Start preview server ──
        send("agent_log", {
          task_id: "system",
          log: "Starting preview server...",
        });

        try {
          const checkPkg = await runCommandStreaming(
            sandbox,
            "cat /home/user/project/package.json 2>/dev/null || echo '{}'"
          );
          const hasPkg = checkPkg.stdout.includes('"scripts"');

          if (hasPkg) {
            send("agent_log", {
              task_id: "system",
              log: "Detected package.json with scripts, starting dev server...",
            });
            await runCommandStreaming(
              sandbox,
              "cd /home/user/project && npm run dev -- --port 3000",
              { background: true, timeoutMs: 10_000 }
            ).catch(() =>
              runCommandStreaming(
                sandbox,
                "cd /home/user/project && npm start",
                { background: true, timeoutMs: 10_000 }
              )
            );
          } else {
            send("agent_log", {
              task_id: "system",
              log: "Starting static file server...",
            });
            await runCommandStreaming(
              sandbox,
              "cd /home/user/project && npm install -g serve",
              { timeoutMs: 30_000 }
            ).catch(() => {});
            await runCommandStreaming(
              sandbox,
              "cd /home/user/project && serve -l 3000",
              { background: true, timeoutMs: 10_000 }
            ).catch(() =>
              runCommandStreaming(
                sandbox,
                "cd /home/user/project && python3 -m http.server 3000",
                { background: true, timeoutMs: 10_000 }
              )
            );
          }

          await new Promise((r) => setTimeout(r, 3000));

          const previewUrl = getPreviewUrl(sandbox, 3000);
          send("preview_url", { url: previewUrl });
          send("agent_log", {
            task_id: "system",
            log: `Preview available at ${previewUrl}`,
          });
        } catch (previewErr) {
          const msg =
            previewErr instanceof Error ? previewErr.message : "Unknown error";
          send("agent_log", {
            task_id: "system",
            log: `Could not start preview server: ${msg}. Project files were created successfully.`,
          });
        }

        const db = getSupabaseAdmin();
        await db
          .from("projects")
          .update({ status: "complete" })
          .eq("id", project_id);

        send("build_complete", {
          message: "Your project is ready!",
          cost_usd: totalCostUsd,
        });
      } catch (err: unknown) {
        const message =
          err instanceof Error ? err.message : "Sandbox creation failed";
        send("agent_log", {
          task_id: "system",
          log: `Error: ${message}`,
        });
        send("build_complete", {
          message: "Build encountered errors. Check the log above.",
        });
      }

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
