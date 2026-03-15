import Anthropic from "@anthropic-ai/sdk";
import {
  reconnectSandbox,
  writeFiles,
  runCommandStreaming,
  getPreviewUrl,
} from "@/lib/sandbox";
import { readAllProjectFiles } from "@/lib/ralph";
import { rateLimitTiered } from "@/lib/rate-limit";
import { safeAuth } from "@/lib/safe-auth";
import { clampString } from "@/lib/sanitize";

export const maxDuration = 120;

const EDIT_SYSTEM_PROMPT = `You are an AI assistant helping edit an existing web project in a sandbox. The user will request changes. You can read existing files and modify them.

RESPONSE FORMAT — return ONLY a JSON object, no markdown fences:
{
  "files": [{"path": "/home/user/project/filename", "content": "raw file content here"}],
  "commands": [],
  "summary": "One-line description of what you changed",
  "status": "complete"
}

RULES:
- "content" is the RAW file content as a JSON string (escape newlines as \\n, quotes as \\")
- Do NOT base64 encode anything — use plain text
- All file paths must be absolute under /home/user/project/
- When modifying a file, output the COMPLETE updated content, not just the diff
- Only include files that need changes
- Keep the project working after your changes`;

interface EditAction {
  files: { path: string; content: string }[];
  commands: string[];
  summary: string;
}

function parseResponse(text: string): EditAction | null {
  let cleaned = text.trim();
  cleaned = cleaned.replace(/```(?:json)?\s*\n?/g, "").replace(/\n?\s*```/g, "").trim();

  // Try JSON.parse directly
  try {
    const parsed = JSON.parse(cleaned);
    const files: { path: string; content: string }[] = [];
    if (parsed.files && Array.isArray(parsed.files)) {
      for (const f of parsed.files) {
        if (f.path && typeof f.content === "string" && f.content.length > 0) {
          files.push({ path: f.path, content: f.content });
        }
      }
    }

    const commands: string[] = [];
    if (parsed.commands && Array.isArray(parsed.commands)) {
      for (const cmd of parsed.commands) {
        if (typeof cmd === "string") commands.push(cmd);
      }
    }

    const summary = typeof parsed.summary === "string" ? parsed.summary : (files.length > 0 ? `Updated ${files.length} file(s)` : "");

    if (files.length === 0 && commands.length === 0) return null;

    return { files, commands, summary };
  } catch {
    // JSON.parse failed
    return null;
  }
}

export async function POST(request: Request) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return new Response(
      JSON.stringify({ error: "Server configuration error: ANTHROPIC_API_KEY is not set" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }

  const { userId } = await safeAuth();
  const rl = rateLimitTiered(request, "edit-project", { userId });
  if (!rl.allowed) {
    return new Response(JSON.stringify({ error: "Too many requests" }), {
      status: 429,
      headers: { "Content-Type": "application/json" },
    });
  }

  let body: {
    sandbox_id?: string;
    message?: string;
    context?: { path: string; content: string }[];
  };
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const { sandbox_id, message, context } = body;

  if (!sandbox_id || typeof sandbox_id !== "string") {
    return new Response(
      JSON.stringify({ error: "sandbox_id is required" }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  if (!message || typeof message !== "string") {
    return new Response(
      JSON.stringify({ error: "message is required" }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  // Clamp user message to 2000 chars
  const safeMessage = clampString(message, 2000);

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      const send = (event: string, data: Record<string, unknown>) => {
        try {
          controller.enqueue(
            encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
          );
        } catch {
          // closed
        }
      };

      try {
        send("agent_log", { log: "Connecting to sandbox..." });

        let sandbox;
        try {
          sandbox = await reconnectSandbox(sandbox_id);
        } catch (connectErr) {
          const msg = connectErr instanceof Error ? connectErr.message : String(connectErr);
          if (msg.toLowerCase().includes("not found") || msg.toLowerCase().includes("404")) {
            send("sandbox_expired", { error: "Sandbox has expired. Please rebuild the project to make further edits." });
            controller.close();
            return;
          }
          throw connectErr;
        }

        send("agent_log", { log: "Reading current project files..." });

        // Read key project files for context (including subdirectories)
        let fileContext = "";
        if (context && context.length > 0) {
          fileContext = context
            .slice(0, 10)
            .map((f) => `--- ${f.path} ---\n${clampString(f.content, 10000)}`)
            .join("\n\n");
        } else {
          try {
            const fileContents = await readAllProjectFiles(sandbox);
            fileContext = Object.entries(fileContents)
              .slice(0, 15)
              .map(([path, content]) => `--- ${path} ---\n${content}`)
              .join("\n\n");
          } catch {
            fileContext = "(Could not read project files)";
          }
        }

        send("agent_log", { log: `Applying changes: "${safeMessage}"` });

        const anthropic = new Anthropic({
          apiKey: process.env.ANTHROPIC_API_KEY,
          timeout: 5 * 60 * 1000,
        });

        const response = await anthropic.messages.create({
          model: "claude-sonnet-4-6",
          max_tokens: 16384,
          system: EDIT_SYSTEM_PROMPT,
          messages: [
            {
              role: "user",
              content: `Current project files:\n\n${fileContext}\n\nUser request: "${safeMessage}"\n\nRespond with ONLY the JSON object. Use plain text for file content (NOT base64).`,
            },
          ],
        });

        const textBlock = response.content.find((b) => b.type === "text");
        if (!textBlock || textBlock.type !== "text") {
          throw new Error("No response from AI");
        }

        const action = parseResponse(textBlock.text);
        if (!action) {
          throw new Error("AI returned no files or commands");
        }

        // Apply file changes
        if (action.files.length > 0) {
          await writeFiles(
            sandbox,
            action.files.map((f) => ({ path: f.path, data: f.content }))
          );

          for (const file of action.files) {
            const shortPath = file.path.replace("/home/user/project/", "");
            send("file_updated", { path: shortPath, content: file.content });
            send("agent_log", { log: `Updated ${shortPath}` });
          }
        }

        // Run any commands
        if (action.commands.length > 0) {
          for (const cmd of action.commands.slice(0, 5)) {
            send("agent_log", { log: `$ ${cmd}` });
            try {
              await runCommandStreaming(sandbox, cmd, { timeoutMs: 60_000 });
            } catch {
              send("agent_log", { log: `Command warning: ${cmd} may have failed` });
            }
          }
        }

        // Refresh preview
        const previewUrl = getPreviewUrl(sandbox, 3000);
        send("preview_refresh", { url: previewUrl });

        send("edit_complete", {
          summary: action.summary || "Changes applied",
        });
      } catch (err: unknown) {
        const errMsg =
          err instanceof Error ? err.message : "Edit failed";
        send("edit_error", { error: errMsg });
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
