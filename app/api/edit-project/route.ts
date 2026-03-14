import Anthropic from "@anthropic-ai/sdk";
import {
  reconnectSandbox,
  writeFiles,
  runCommandStreaming,
  readFile,
  listFiles,
  getPreviewUrl,
} from "@/lib/sandbox";
import { rateLimit, getRequestIP } from "@/lib/rate-limit";
import { clampString } from "@/lib/sanitize";

export const maxDuration = 120;

const EDIT_SYSTEM_PROMPT = `You are an AI assistant helping edit an existing web project in a sandbox. The user will request changes. You can read existing files and modify them.

RESPONSE FORMAT:
Return your response as a JSON object where each file's content field is BASE64 ENCODED.

{"files":[{"path":"/home/user/project/filename","content":"BASE64_ENCODED_CONTENT"}],"commands":[],"summary":"One-line description of what you changed","status":"complete"}

CRITICAL RULES FOR BASE64:
- The "content" field of each file MUST be the base64-encoded version of the file content
- The "path" field is plain text (NOT base64)
- The "summary" field is plain text (NOT base64)
- The "commands" array contains plain text commands (NOT base64)
- ONLY the file content values are base64 encoded

Other rules:
- All file paths must be absolute under /home/user/project/
- When modifying a file, output the COMPLETE updated content (base64 encoded), not just the diff
- Only include files that need changes
- Keep the project working after your changes
- RESPOND WITH ONLY THE JSON OBJECT — no markdown fences, no extra text`;

interface EditAction {
  files: { path: string; content: string }[];
  commands: string[];
  summary: string;
}

function parseResponse(text: string): EditAction | null {
  let cleaned = text.trim();
  cleaned = cleaned.replace(/```(?:json)?\s*\n?/g, "").replace(/\n?\s*```/g, "").trim();

  const files: { path: string; content: string }[] = [];
  const fileRegex = /\{\s*"path"\s*:\s*"([^"]+)"\s*,\s*"content"\s*:\s*"([A-Za-z0-9+/=\s]+?)"\s*\}/g;
  let match;
  while ((match = fileRegex.exec(cleaned)) !== null) {
    const path = match[1];
    const b64Content = match[2].replace(/\s/g, "");
    try {
      const decoded = Buffer.from(b64Content, "base64").toString("utf-8");
      if (decoded.length > 0) {
        files.push({ path, content: decoded });
      }
    } catch {
      // skip files that fail to decode
    }
  }

  const commands: string[] = [];
  const cmdRegex = /"commands"\s*:\s*\[([\s\S]*?)\]/;
  const cmdMatch = cleaned.match(cmdRegex);
  if (cmdMatch) {
    const cmdArray = cmdMatch[1];
    const cmdItemRegex = /"((?:[^"\\]|\\.)*)"/g;
    let cm;
    while ((cm = cmdItemRegex.exec(cmdArray)) !== null) {
      commands.push(cm[1].replace(/\\"/g, '"').replace(/\\\\/g, "\\"));
    }
  }

  let summary = "";
  const summaryMatch = cleaned.match(/"summary"\s*:\s*"((?:[^"\\]|\\.)*)"/);
  if (summaryMatch) {
    summary = summaryMatch[1].replace(/\\"/g, '"').replace(/\\\\/g, "\\");
  }

  if (files.length === 0 && commands.length === 0) {
    return null;
  }

  if (!summary && files.length > 0) {
    summary = `Updated ${files.length} file(s)`;
  }

  return { files, commands, summary };
}

export async function POST(request: Request) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return new Response(
      JSON.stringify({ error: "Server configuration error: ANTHROPIC_API_KEY is not set" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }

  const ip = getRequestIP(request);
  const rl = rateLimit(`edit-project:${ip}`, { maxRequests: 15, windowMs: 60_000 });
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

        const sandbox = await reconnectSandbox(sandbox_id);

        send("agent_log", { log: "Reading current project files..." });

        // Read key project files for context
        let fileContext = "";
        if (context && context.length > 0) {
          fileContext = context
            .slice(0, 10)
            .map((f) => `--- ${f.path} ---\n${clampString(f.content, 10000)}`)
            .join("\n\n");
        } else {
          try {
            const projectFiles = await listFiles(
              sandbox,
              "/home/user/project"
            );
            const readableFiles = projectFiles.filter((f) =>
              /\.(html|css|js|ts|tsx|jsx|json|md)$/.test(f)
            );
            const contents = [];
            for (const fname of readableFiles.slice(0, 10)) {
              try {
                const content = await readFile(
                  sandbox,
                  `/home/user/project/${fname}`
                );
                contents.push(`--- ${fname} ---\n${content}`);
              } catch {
                // skip unreadable files
              }
            }
            fileContext = contents.join("\n\n");
          } catch {
            fileContext = "(Could not read project files)";
          }
        }

        send("agent_log", { log: `Applying changes: "${safeMessage}"` });

        const anthropic = new Anthropic({
          apiKey: process.env.ANTHROPIC_API_KEY,
        });

        const response = await anthropic.messages.create({
          model: "claude-sonnet-4-6",
          max_tokens: 16384,
          system: EDIT_SYSTEM_PROMPT,
          messages: [
            {
              role: "user",
              content: `Current project files:\n\n${fileContext}\n\nUser request: "${safeMessage}"\n\nIMPORTANT: Base64 encode ALL file content values. Respond with ONLY the JSON object.`,
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
