import Anthropic from "@anthropic-ai/sdk";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import {
  createProjectSandbox,
  writeFile,
  runCommand,
  getPreviewUrl,
} from "@/lib/sandbox";

const SYSTEM_PROMPT = `You are an autonomous software agent building a web project inside a Linux sandbox. You have access to the filesystem and shell.

For each task, output a JSON object with exactly this structure:
{
  "files": [
    { "path": "/home/user/project/filename", "content": "file content here" }
  ],
  "commands": [
    "cd /home/user/project && npm install"
  ],
  "summary": "One-line description of what you did"
}

Rules:
- All file paths must be absolute, under /home/user/project/
- Write complete, working code — not pseudocode or placeholders
- For web projects, use vanilla HTML/CSS/JS by default, or a simple framework if the task requires it
- Include a package.json if you need npm packages
- Include an index.html as the entry point
- Keep files small and focused
- Commands run in a Linux environment with Node.js, npm, and Python available
- Return ONLY the JSON object, no markdown, no explanation`;

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

  // Strip markdown code fences
  if (jsonText.startsWith("```")) {
    jsonText = jsonText
      .replace(/^```(?:json)?\s*\n?/, "")
      .replace(/\n?\s*```$/, "");
  }

  try {
    return JSON.parse(jsonText);
  } catch {
    // Try to find JSON object within the text
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
          // Controller may be closed if client disconnected
        }
      };

      const db = getSupabaseAdmin();

      // Insert tasks into Supabase
      const taskRows = sorted.map((t) => ({
        id: t.id,
        project_id,
        label: t.label,
        order_index: t.order_index,
        status: "pending",
      }));
      await db.from("tasks").insert(taskRows);

      try {
        // Create E2B sandbox
        send("agent_log", {
          task_id: "system",
          log: "Spinning up sandbox environment...",
        });

        const sandbox = await createProjectSandbox();

        send("agent_log", {
          task_id: "system",
          log: "Sandbox ready. Starting build...",
        });

        // Create project directory
        await runCommand(sandbox, "mkdir -p /home/user/project");

        const anthropic = new Anthropic({
          apiKey: process.env.ANTHROPIC_API_KEY,
        });

        // Build context of what's been done so far
        const completedActions: string[] = [];

        for (const task of sorted) {
          const startTime = Date.now();

          send("task_start", { task_id: task.id, label: task.label });

          await db
            .from("tasks")
            .update({ status: "active" })
            .eq("id", task.id);

          try {
            // Ask Claude to generate code for this task
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

            // Write files to sandbox
            if (action.files && Array.isArray(action.files)) {
              for (const file of action.files) {
                if (file.path && file.content) {
                  // Ensure parent directory exists
                  const dir = file.path.substring(
                    0,
                    file.path.lastIndexOf("/")
                  );
                  await runCommand(sandbox, `mkdir -p ${dir}`);
                  await writeFile(sandbox, file.path, file.content);
                  send("agent_log", {
                    task_id: task.id,
                    log: `Created ${file.path.replace("/home/user/project/", "")}`,
                  });
                  // Send file content to client
                  send("file_created", {
                    task_id: task.id,
                    path: file.path.replace("/home/user/project/", ""),
                    content: file.content,
                  });
                }
              }
            }

            // Run commands in sandbox
            if (action.commands && Array.isArray(action.commands)) {
              for (const cmd of action.commands) {
                send("agent_log", {
                  task_id: task.id,
                  log: `$ ${cmd}`,
                });
                try {
                  const result = await runCommand(sandbox, cmd, {
                    timeoutMs: 120_000,
                  });
                  if (result.stdout.trim()) {
                    // Send first few lines of output
                    const lines = result.stdout.trim().split("\n");
                    const preview =
                      lines.length > 5
                        ? lines.slice(0, 5).join("\n") +
                          `\n... (${lines.length - 5} more lines)`
                        : result.stdout.trim();
                    send("agent_log", {
                      task_id: task.id,
                      log: preview,
                    });
                  }
                  if (result.exitCode !== 0 && result.stderr.trim()) {
                    send("agent_log", {
                      task_id: task.id,
                      log: `Warning: ${result.stderr.trim().split("\n").slice(0, 3).join("\n")}`,
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

        // Try to start a simple server and get preview URL
        send("agent_log", {
          task_id: "system",
          log: "Starting preview server...",
        });

        try {
          // Check if there's a package.json with a start/dev script
          const checkPkg = await runCommand(
            sandbox,
            "cat /home/user/project/package.json 2>/dev/null || echo '{}'"
          );
          const hasPkg = checkPkg.stdout.includes('"scripts"');

          if (hasPkg) {
            // Try npm start or npm run dev
            await runCommand(
              sandbox,
              "cd /home/user/project && npm run dev -- --port 3000 &>/dev/null &",
              { background: true, timeoutMs: 10_000 }
            ).catch(() => {
              // fallback: try npm start
              return runCommand(
                sandbox,
                "cd /home/user/project && npm start &>/dev/null &",
                { background: true, timeoutMs: 10_000 }
              );
            });
          } else {
            // Use a simple static server for HTML files
            await runCommand(
              sandbox,
              "cd /home/user/project && npx -y serve -l 3000 &>/dev/null &",
              { background: true, timeoutMs: 30_000 }
            ).catch(() => {
              // Fallback to python http server
              return runCommand(
                sandbox,
                "cd /home/user/project && python3 -m http.server 3000 &",
                { background: true, timeoutMs: 10_000 }
              );
            });
          }

          // Give the server a moment to start
          await new Promise((r) => setTimeout(r, 2000));

          const previewUrl = getPreviewUrl(sandbox, 3000);
          send("preview_url", { url: previewUrl });
          send("agent_log", {
            task_id: "system",
            log: `Preview available at ${previewUrl}`,
          });
        } catch {
          send("agent_log", {
            task_id: "system",
            log: "Could not start preview server — project files were created successfully.",
          });
        }

        // Update project status
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

      // Don't kill sandbox immediately — keep it alive for preview
      // It will auto-expire after the timeout (5 min)

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
