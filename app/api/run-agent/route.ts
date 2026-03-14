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
  success_criteria?: string[];
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

  // Validate task labels + pass through success_criteria
  const ralphTasks: RalphTask[] = tasks.map((t) => ({
    id: t.id,
    label: clampString(t.label || "", 200),
    order_index: t.order_index,
    success_criteria: Array.isArray(t.success_criteria) ? t.success_criteria : undefined,
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

        let previewUrl: string | null = null;

        try {
          await runCommandStreaming(
            sandbox,
            "cd /home/user/project && python3 -m http.server 3000 &",
            { timeoutMs: 5_000 }
          );

          // Give server a moment to bind
          await new Promise((r) => setTimeout(r, 2000));
          previewUrl = getPreviewUrl(sandbox, 3000);
        } catch {
          // Even if the server command "fails" (background process), still try the URL
          try {
            previewUrl = getPreviewUrl(sandbox, 3000);
          } catch {
            // no preview available
          }
        }

        // ── Auto-heal: check if preview is reachable ──
        if (previewUrl) {
          let previewHealthy = false;

          try {
            const healthCheck = await runCommandStreaming(
              sandbox,
              `curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/`,
              { timeoutMs: 10_000 }
            );
            previewHealthy = healthCheck.stdout.trim() === "200";
          } catch {
            previewHealthy = false;
          }

          if (!previewHealthy) {
            send("agent_log", {
              task_id: "system",
              log: "Preview health check failed — running auto-heal...",
            });

            // Run one more Ralph iteration to fix deployment
            const healTask: RalphTask = {
              id: crypto.randomUUID(),
              label: "Fix preview server: ensure index.html exists at /home/user/project/index.html and the python3 http.server can serve it on port 3000. Check for missing files or syntax errors.",
              order_index: 99,
              success_criteria: ["index.html contains <!DOCTYPE html>", "index.html contains </html>"],
            };

            await runRalphLoop(
              project_id,
              safeDescription,
              [healTask],
              sandbox,
              ({ event, data }) => send(event, data)
            );

            // Restart preview server after heal
            try {
              await runCommandStreaming(sandbox, "pkill -f 'python3 -m http.server' || true", { timeoutMs: 5_000 });
              await runCommandStreaming(
                sandbox,
                "cd /home/user/project && python3 -m http.server 3000 &",
                { timeoutMs: 5_000 }
              );
              await new Promise((r) => setTimeout(r, 2000));
            } catch {
              // best effort
            }

            // Re-check
            try {
              const recheck = await runCommandStreaming(
                sandbox,
                `curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/`,
                { timeoutMs: 10_000 }
              );
              if (recheck.stdout.trim() === "200") {
                send("agent_log", { task_id: "system", log: "Auto-heal successful — preview is live" });
              } else {
                send("agent_log", { task_id: "system", log: "Auto-heal attempted but preview may still have issues" });
              }
            } catch {
              send("agent_log", { task_id: "system", log: "Could not verify preview after heal" });
            }
          }

          send("preview_url", { url: previewUrl });
          send("agent_log", {
            task_id: "system",
            log: `Preview: ${previewUrl}`,
          });
        } else {
          send("agent_log", {
            task_id: "system",
            log: "Could not start preview server",
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
