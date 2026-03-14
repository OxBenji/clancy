import Anthropic from "@anthropic-ai/sdk";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import {
  createProjectSandbox,
  writeFiles,
  runCommandStreaming,
  getPreviewUrl,
} from "@/lib/sandbox";

const SYSTEM_PROMPT = `You are an autonomous software agent building a web project inside a Linux sandbox.

CRITICAL: Your response must be a single valid JSON object — nothing else. No markdown, no explanation, no code fences, no text before or after the JSON.

Required JSON format:
{"files":[{"path":"/home/user/project/filename","content":"file content"}],"commands":["cd /home/user/project && npm install"],"summary":"One-line description"}

Rules:
- All file paths must be absolute, under /home/user/project/
- Write complete, working code — not pseudocode or placeholders
- For web projects, use vanilla HTML/CSS/JS by default, or a simple framework if the task requires it
- Include a package.json if you need npm packages
- Include an index.html as the entry point
- Keep files small and focused
- Commands run in a Linux environment with Node.js, npm, and Python available
- RESPOND WITH ONLY RAW JSON. Any non-JSON text will cause a system error.`;

interface Task {
  id: string;
  label: string;
  order_index: number;
}

interface AgentAction {
  files?: { path: string; content: string }[];
  commands?: string[];
  summary?: string;
}

function sseEvent(event: string, data: Record<string, unknown>): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

function parseAgentResponse(text: string): AgentAction | null {
  let jsonText = text.trim();

  if (jsonText.startsWith("```")) {
    jsonText = jsonText
      .replace(/^```(?:json)?\s*\n?/, "")
      .replace(/\n?\s*```$/, "");
  }

  try {
    return JSON.parse(jsonText);
  } catch {
    const match = jsonText.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        return JSON.parse(match[0]);
      } catch {
        return null;
      }
    }
    return null;
  }
}

export async function POST(request: Request) {
  let body: { project_id?: string; tasks?: Task[]; description?: string };
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

  if (!Array.isArray(tasks) || tasks.length === 0) {
    return new Response(
      JSON.stringify({
        error: "tasks array is required and must not be empty",
      }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  const sorted = [...tasks].sort((a, b) => a.order_index - b.order_index);

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

      const db = getSupabaseAdmin();

      const taskRows = sorted.map((t) => ({
        id: t.id,
        project_id,
        label: t.label,
        order_index: t.order_index,
        status: "pending",
      }));
      await db.from("tasks").insert(taskRows);

      try {
        send("agent_log", {
          task_id: "system",
          log: "Spinning up sandbox environment...",
        });

        const sandbox = await createProjectSandbox();

        // Send sandbox ID so client can reconnect later
        send("sandbox_id", { id: sandbox.sandboxId });

        send("agent_log", {
          task_id: "system",
          log: `Sandbox ready (${sandbox.sandboxId}). Starting build...`,
        });

        await runCommandStreaming(sandbox, "mkdir -p /home/user/project");

        const anthropic = new Anthropic({
          apiKey: process.env.ANTHROPIC_API_KEY,
        });

        const completedActions: string[] = [];

        for (const task of sorted) {
          const startTime = Date.now();

          send("task_start", { task_id: task.id, label: task.label });

          await db
            .from("tasks")
            .update({ status: "active" })
            .eq("id", task.id);

          try {
            const contextMsg =
              completedActions.length > 0
                ? `\n\nPrevious tasks completed:\n${completedActions.join("\n")}`
                : "";

            const response = await anthropic.messages.create({
              model: "claude-sonnet-4-6",
              max_tokens: 4096,
              system: SYSTEM_PROMPT,
              messages: [
                {
                  role: "user",
                  content: `Project description: "${description || "A web project"}"\n\nExecute this task: "${task.label}"${contextMsg}`,
                },
              ],
            });

            const textBlock = response.content.find(
              (b) => b.type === "text"
            );
            if (!textBlock || textBlock.type !== "text") {
              throw new Error("No response from AI");
            }

            const action = parseAgentResponse(textBlock.text);
            if (!action) {
              throw new Error("AI returned invalid format");
            }

            // Write files to sandbox (batch)
            if (action.files && Array.isArray(action.files)) {
              const validFiles = action.files.filter(
                (f) => f.path && f.content
              );
              if (validFiles.length > 0) {
                await writeFiles(
                  sandbox,
                  validFiles.map((f) => ({ path: f.path, data: f.content }))
                );
                for (const file of validFiles) {
                  const shortPath = file.path.replace(
                    "/home/user/project/",
                    ""
                  );
                  send("agent_log", {
                    task_id: task.id,
                    log: `Created ${shortPath}`,
                  });
                  send("file_created", {
                    task_id: task.id,
                    path: shortPath,
                    content: file.content,
                  });
                }
              }
            }

            // Run commands with real-time streaming
            if (action.commands && Array.isArray(action.commands)) {
              for (const cmd of action.commands) {
                send("agent_log", {
                  task_id: task.id,
                  log: `$ ${cmd}`,
                });
                try {
                  let stdoutBuf = "";
                  let stderrBuf = "";
                  const result = await runCommandStreaming(sandbox, cmd, {
                    timeoutMs: 120_000,
                    onStdout: (chunk) => {
                      stdoutBuf += chunk;
                      const lines = stdoutBuf.split("\n");
                      stdoutBuf = lines.pop() || "";
                      for (const line of lines) {
                        if (line.trim()) {
                          send("agent_log", {
                            task_id: task.id,
                            log: line.trim(),
                          });
                        }
                      }
                    },
                    onStderr: (chunk) => {
                      stderrBuf += chunk;
                      const lines = stderrBuf.split("\n");
                      stderrBuf = lines.pop() || "";
                      for (const line of lines) {
                        if (line.trim()) {
                          send("agent_log", {
                            task_id: task.id,
                            log: `stderr: ${line.trim()}`,
                          });
                        }
                      }
                    },
                  });
                  // Flush remaining buffers
                  if (stdoutBuf.trim()) {
                    send("agent_log", {
                      task_id: task.id,
                      log: stdoutBuf.trim(),
                    });
                  }
                  if (stderrBuf.trim()) {
                    send("agent_log", {
                      task_id: task.id,
                      log: `stderr: ${stderrBuf.trim()}`,
                    });
                  }
                  if (result.exitCode !== 0) {
                    send("agent_log", {
                      task_id: task.id,
                      log: `Exit code: ${result.exitCode}`,
                    });
                  }
                } catch (cmdErr) {
                  const msg =
                    cmdErr instanceof Error
                      ? cmdErr.message
                      : "Command failed";
                  send("agent_log", {
                    task_id: task.id,
                    log: `Command error: ${msg}`,
                  });
                }
              }
            }

            if (action.summary) {
              send("agent_log", {
                task_id: task.id,
                log: action.summary,
              });
              completedActions.push(
                `- Task ${task.order_index}: ${action.summary}`
              );
            }

            const duration = Math.round((Date.now() - startTime) / 1000);

            await db
              .from("tasks")
              .update({ status: "done", duration_seconds: duration })
              .eq("id", task.id);

            send("task_complete", { task_id: task.id, duration });
          } catch (err: unknown) {
            const message =
              err instanceof Error ? err.message : "Unknown error";

            await db
              .from("tasks")
              .update({ status: "error" })
              .eq("id", task.id);

            send("task_error", { task_id: task.id, error: message });
          }
        }

        // Start preview server
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
            // Install serve first, then run it in background
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

          // Wait for server to bind
          await new Promise((r) => setTimeout(r, 3000));

          const previewUrl = getPreviewUrl(sandbox, 3000);
          send("preview_url", { url: previewUrl });
          send("agent_log", {
            task_id: "system",
            log: `Preview available at ${previewUrl}`,
          });
        } catch (previewErr) {
          const msg =
            previewErr instanceof Error
              ? previewErr.message
              : "Unknown error";
          send("agent_log", {
            task_id: "system",
            log: `Could not start preview server: ${msg}. Project files were created successfully.`,
          });
        }

        await db
          .from("projects")
          .update({ status: "complete" })
          .eq("id", project_id);

        send("build_complete", {
          message: "Your project is ready!",
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
