import Anthropic from "@anthropic-ai/sdk";
import {
  reconnectSandbox,
  writeFiles,
  runCommandStreaming,
  readFile,
  listFiles,
  getPreviewUrl,
} from "@/lib/sandbox";

const EDIT_SYSTEM_PROMPT = `You are an AI assistant helping edit an existing web project in a sandbox. The user will request changes. You can read existing files and modify them.

Output a JSON object with this structure:
{
  "files": [
    { "path": "/home/user/project/filename", "content": "full updated file content" }
  ],
  "commands": [],
  "summary": "One-line description of what you changed"
}

Rules:
- All file paths must be absolute under /home/user/project/
- When modifying a file, output the COMPLETE updated content, not just the diff
- Only include files that need changes
- Keep the project working after your changes
- Return ONLY the JSON object, no markdown, no explanation`;

interface EditAction {
  files?: { path: string; content: string }[];
  commands?: string[];
  summary?: string;
}

function parseResponse(text: string): EditAction | null {
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

  if (!sandbox_id || !message) {
    return new Response(
      JSON.stringify({ error: "sandbox_id and message are required" }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

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
            .map((f) => `--- ${f.path} ---\n${f.content}`)
            .join("\n\n");
        } else {
          // Try to read main files
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

        send("agent_log", { log: `Applying changes: "${message}"` });

        const anthropic = new Anthropic({
          apiKey: process.env.ANTHROPIC_API_KEY,
        });

        const response = await anthropic.messages.create({
          model: "claude-sonnet-4-6",
          max_tokens: 4096,
          system: EDIT_SYSTEM_PROMPT,
          messages: [
            {
              role: "user",
              content: `Current project files:\n\n${fileContext}\n\nUser request: "${message}"`,
            },
          ],
        });

        const textBlock = response.content.find((b) => b.type === "text");
        if (!textBlock || textBlock.type !== "text") {
          throw new Error("No response from AI");
        }

        const action = parseResponse(textBlock.text);
        if (!action) {
          throw new Error("AI returned invalid format");
        }

        // Apply file changes
        if (action.files && action.files.length > 0) {
          const validFiles = action.files.filter((f) => f.path && f.content);
          await writeFiles(
            sandbox,
            validFiles.map((f) => ({ path: f.path, data: f.content }))
          );

          for (const file of validFiles) {
            const shortPath = file.path.replace("/home/user/project/", "");
            send("file_updated", { path: shortPath, content: file.content });
            send("agent_log", { log: `Updated ${shortPath}` });
          }
        }

        // Run any commands
        if (action.commands && action.commands.length > 0) {
          for (const cmd of action.commands) {
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
        const message =
          err instanceof Error ? err.message : "Edit failed";
        send("edit_error", { error: message });
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
