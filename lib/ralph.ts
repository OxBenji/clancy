import Anthropic from "@anthropic-ai/sdk";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import {
  writeFiles,
  runCommandStreaming,
  readFile,
  listFiles,
} from "@/lib/sandbox";
import { stripHtml } from "@/lib/sanitize";
import type { Sandbox } from "e2b";

// ── Cost constants ──
const INPUT_COST_PER_MILLION = 3; // $3 per 1M input tokens (sonnet)
const OUTPUT_COST_PER_MILLION = 15; // $15 per 1M output tokens (sonnet)
const HAIKU_INPUT_COST = 0.80; // $0.80 per 1M input tokens (haiku)
const HAIKU_OUTPUT_COST = 4; // $4 per 1M output tokens (haiku)
const BUDGET_LIMIT_USD = parseFloat(process.env.BUDGET_LIMIT_USD || "2.00");
const MAX_ITERATIONS = parseInt(process.env.MAX_ITERATIONS || "10", 10);
const MAX_RETRIES_PER_TASK = 3;

// ── Types ──

export interface RalphTask {
  id: string;
  label: string;
  order_index: number;
  success_criteria?: string[];
}

export interface RalphEvent {
  event: string;
  data: Record<string, unknown>;
}

interface AgentAction {
  files?: { path: string; content: string }[];
  commands?: string[];
  summary?: string;
}

// ── System prompt — plain text file contents (NO base64) ──

const TASK_SYSTEM_PROMPT = `You are an autonomous software agent executing ONE specific task inside a Linux sandbox.

Read the guardrails carefully — these are lessons from previous attempts that you MUST follow.

RESPONSE FORMAT — return ONLY a JSON object, no markdown fences, no explanation:
{
  "files": [
    {"path": "/home/user/project/index.html", "content": "<!DOCTYPE html>\\n<html>...</html>"},
    {"path": "/home/user/project/css/styles.css", "content": "body { margin: 0; }"}
  ],
  "commands": ["cd /home/user/project && npm install"],
  "summary": "What you did",
  "status": "complete"
}

RULES:
- STRICT: Each task creates or modifies exactly ONE file. A task that touches index.html must ONLY touch index.html. Never combine multiple files in one task. If unsure, make it smaller.
- "content" is the RAW file content as a JSON string (escape newlines as \\n, quotes as \\")
- Do NOT base64 encode anything — use plain text
- All file paths must be absolute, under /home/user/project/
- Write complete, working code — not pseudocode or placeholders
- For web projects, use vanilla HTML/CSS/JS by default
- Include index.html as the entry point
- Keep files small and focused
- Commands run in a Linux environment with Node.js, npm, and Python available
- If you cannot complete the task, use "status": "failed" with a "reason" field`;

const REVIEWER_SYSTEM_PROMPT = `You are a code reviewer. You will be given a task label, success criteria, and the actual file contents from a sandbox. Your job is to verify whether the code satisfies ALL the success criteria.

Reply with EXACTLY one of:
- PASS
- FAIL: [specific reason what is missing or wrong]

Be strict. Check each criterion literally against the file contents. If a criterion says "index.html contains <nav>", check that the string "<nav" actually appears in index.html.`;

// ── Parser: JSON.parse with fallback ──

function parseAgentResponse(text: string): { action: AgentAction | null; complete: boolean; failReason: string | null } {
  let complete = false;
  let failReason: string | null = null;

  // Strip markdown code fences if present
  let cleaned = text.trim();
  cleaned = cleaned.replace(/```(?:json)?\s*\n?/g, "").replace(/\n?\s*```/g, "").trim();

  // Strip preamble text before JSON — models sometimes add explanation before the JSON object
  const firstBrace = cleaned.indexOf("{");
  if (firstBrace > 0) {
    cleaned = cleaned.slice(firstBrace);
  }

  // Strip trailing text after the JSON object closes
  // Find the matching closing brace by counting braces (respecting strings)
  let braceDepth = 0;
  let inStr = false;
  let jsonEnd = -1;
  for (let j = 0; j < cleaned.length; j++) {
    const c = cleaned[j];
    if (c === '"' && (j === 0 || cleaned[j - 1] !== '\\')) {
      inStr = !inStr;
    } else if (!inStr) {
      if (c === '{') braceDepth++;
      else if (c === '}') {
        braceDepth--;
        if (braceDepth === 0) {
          jsonEnd = j;
          break;
        }
      }
    }
  }
  if (jsonEnd > 0 && jsonEnd < cleaned.length - 1) {
    cleaned = cleaned.slice(0, jsonEnd + 1);
  }

  // Fix literal newlines/tabs inside JSON string values — models often emit these
  // instead of proper \n escapes, which breaks JSON.parse.
  // Walk through the string and escape raw newlines/tabs only when inside a JSON string.
  function fixLiteralNewlines(json: string): string {
    let result = "";
    let inString = false;
    let i = 0;
    while (i < json.length) {
      const ch = json[i];
      if (ch === '"') {
        // Count preceding backslashes to determine if the quote is escaped
        let backslashes = 0;
        for (let k = i - 1; k >= 0 && json[k] === '\\'; k--) backslashes++;
        if (backslashes % 2 === 0) {
          // Even number of backslashes = quote is NOT escaped
          inString = !inString;
        }
        result += ch;
      } else if (inString && ch === '\n') {
        result += '\\n';
      } else if (inString && ch === '\r') {
        result += '\\r';
      } else if (inString && ch === '\t') {
        result += '\\t';
      } else {
        result += ch;
      }
      i++;
    }
    return result;
  }

  // Try JSON.parse directly — this is the expected path now
  try {
    const parsed = JSON.parse(fixLiteralNewlines(cleaned));

    // Extract files
    const files: { path: string; content: string }[] = [];
    if (parsed.files && Array.isArray(parsed.files)) {
      for (const f of parsed.files) {
        if (!f.path || typeof f.content !== "string") continue;
        files.push({ path: f.path, content: f.content });
      }
    }

    // Extract commands
    const commands: string[] = [];
    if (parsed.commands && Array.isArray(parsed.commands)) {
      for (const cmd of parsed.commands) {
        if (typeof cmd === "string") commands.push(cmd);
      }
    }

    // Extract summary
    const summary = typeof parsed.summary === "string" ? parsed.summary : "";

    // Check status
    if (parsed.status === "complete") complete = true;
    if (parsed.status === "failed") {
      failReason = typeof parsed.reason === "string" ? parsed.reason : "Unknown failure";
    }

    if (files.length === 0 && commands.length === 0 && !failReason) {
      return { action: null, complete: false, failReason: null };
    }

    if (files.length > 0 && !failReason) complete = true;

    return { action: { files, commands, summary }, complete, failReason };
  } catch {
    // JSON.parse failed — try to extract what we can with regex
  }

  // Regex fallback: try to find file objects in malformed JSON
  const files: { path: string; content: string }[] = [];

  // Match path + content pairs (handles both plain text and base64)
  const fileRegex = /"path"\s*:\s*"([^"]+)"\s*,\s*"content"\s*:\s*"((?:[^"\\]|\\.)*)"/g;
  let match;
  while ((match = fileRegex.exec(cleaned)) !== null) {
    const path = match[1];
    // Unescape JSON string escapes
    const content = match[2]
      .replace(/\\n/g, "\n")
      .replace(/\\t/g, "\t")
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, "\\");
    if (content.length > 0) {
      files.push({ path, content });
    }
  }

  // Extract commands
  const commands: string[] = [];
  const cmdRegex = /"commands"\s*:\s*\[([\s\S]*?)\]/;
  const cmdMatch = cleaned.match(cmdRegex);
  if (cmdMatch) {
    const cmdItemRegex = /"((?:[^"\\]|\\.)*)"/g;
    let cm;
    while ((cm = cmdItemRegex.exec(cmdMatch[1])) !== null) {
      commands.push(cm[1].replace(/\\"/g, '"').replace(/\\\\/g, "\\"));
    }
  }

  // Extract summary
  let summary = "";
  const summaryMatch = cleaned.match(/"summary"\s*:\s*"((?:[^"\\]|\\.)*)"/);
  if (summaryMatch) {
    summary = summaryMatch[1].replace(/\\"/g, '"').replace(/\\\\/g, "\\");
  }

  // Check status
  const statusMatch = cleaned.match(/"status"\s*:\s*"(\w+)"/);
  if (statusMatch) {
    if (statusMatch[1] === "complete") complete = true;
    else if (statusMatch[1] === "failed") {
      const reasonMatch = cleaned.match(/"reason"\s*:\s*"((?:[^"\\]|\\.)*)"/);
      failReason = reasonMatch ? reasonMatch[1].replace(/\\"/g, '"') : "Unknown failure";
    }
  }

  if (files.length === 0 && commands.length === 0 && !failReason) {
    return { action: null, complete: false, failReason: null };
  }

  if (files.length > 0 && !failReason) complete = true;

  return { action: { files, commands, summary }, complete, failReason };
}

// ── Shared helper: recursively read all project files (up to 2 levels deep) ──

export async function readAllProjectFiles(
  sandbox: Sandbox,
  extensionPattern = /\.(html|css|js|ts|tsx|jsx|json|md|txt)$/
): Promise<Record<string, string>> {
  const fileContents: Record<string, string> = {};

  let topLevel: string[] = [];
  try {
    topLevel = await listFiles(sandbox, "/home/user/project");
  } catch {
    return fileContents;
  }

  for (const fname of topLevel) {
    if (extensionPattern.test(fname)) {
      try {
        fileContents[fname] = await readFile(sandbox, `/home/user/project/${fname}`);
      } catch { /* skip */ }
    } else if (!fname.includes(".")) {
      // Likely a directory — read one level deeper
      try {
        const subFiles = await listFiles(sandbox, `/home/user/project/${fname}`);
        for (const sf of subFiles) {
          if (extensionPattern.test(sf)) {
            try {
              fileContents[`${fname}/${sf}`] = await readFile(sandbox, `/home/user/project/${fname}/${sf}`);
            } catch { /* skip */ }
          }
        }
      } catch { /* not a directory */ }
    }
  }

  return fileContents;
}

// ── Success criteria verification (lightweight — no LLM call) ──

function verifyCriteriaLocally(
  fileContents: Record<string, string>,
  criteria: string[],
  emit: (event: RalphEvent) => void,
  taskId: string
): { passed: boolean; failures: string[] } {
  const failures: string[] = [];

  if (Object.keys(fileContents).length === 0) {
    return { passed: false, failures: ["Could not read project files"] };
  }

  // Helper: find file content by exact name or basename match
  const findFile = (name: string): string | undefined => {
    if (fileContents[name]) return fileContents[name];
    const byBasename = Object.entries(fileContents).find(
      ([path]) => path.endsWith(`/${name}`) || path === name
    );
    return byBasename?.[1];
  };

  // Pattern: "filename contains literal_text"
  const fileContainsPattern = /^(\S+?\.\w+)\s+contains?\s+(.+)$/i;

  for (const criterion of criteria) {
    const match = criterion.match(fileContainsPattern);
    if (match) {
      const targetFile = match[1];
      const needle = match[2].trim();
      const content = findFile(targetFile);

      if (!content) {
        failures.push(`${targetFile} not found`);
        emit({ event: "agent_log", data: { task_id: taskId, log: `[VERIFY] FAIL: ${targetFile} not found` } });
        continue;
      }

      // Normalize HTML quotes (single ↔ double) so class='x' matches class="x"
      const normalize = (s: string) => s.toLowerCase().replace(/['"]/g, '"');
      if (normalize(content).includes(normalize(needle))) {
        emit({ event: "agent_log", data: { task_id: taskId, log: `[VERIFY] PASS: ${targetFile} contains "${needle.slice(0, 40)}"` } });
      } else {
        failures.push(`${targetFile} missing: ${needle}`);
        emit({ event: "agent_log", data: { task_id: taskId, log: `[VERIFY] FAIL: ${targetFile} missing "${needle.slice(0, 40)}"` } });
      }
    } else {
      // Generic: look for the criterion text in any file
      const allContent = Object.values(fileContents).join("\n").toLowerCase();
      if (allContent.includes(criterion.toLowerCase())) {
        emit({ event: "agent_log", data: { task_id: taskId, log: `[VERIFY] PASS: found "${criterion.slice(0, 50)}"` } });
      } else {
        failures.push(criterion);
        emit({ event: "agent_log", data: { task_id: taskId, log: `[VERIFY] FAIL: "${criterion.slice(0, 50)}" not found` } });
      }
    }
  }

  return { passed: failures.length === 0, failures };
}

// ── Haiku reviewer agent (only used on final retry) ──

async function runReview(
  anthropic: Anthropic,
  taskLabel: string,
  criteria: string[],
  fileContents: Record<string, string>,
): Promise<{ passed: boolean; reason: string; cost: number }> {
  const filesText = Object.entries(fileContents)
    .map(([path, content]) => `--- ${path} ---\n${content.slice(0, 8000)}`)
    .join("\n\n");

  const criteriaText = criteria.map((c, i) => `${i + 1}. ${c}`).join("\n");

  const response = await anthropic.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 256,
    system: REVIEWER_SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: `Task: "${taskLabel}"\n\nSuccess criteria:\n${criteriaText}\n\nActual file contents:\n${filesText}`,
      },
    ],
  });

  const inputTokens = response.usage?.input_tokens ?? 0;
  const outputTokens = response.usage?.output_tokens ?? 0;
  const cost = (inputTokens / 1_000_000) * HAIKU_INPUT_COST + (outputTokens / 1_000_000) * HAIKU_OUTPUT_COST;

  const textBlock = response.content.find((b) => b.type === "text");
  const text = textBlock && textBlock.type === "text" ? textBlock.text.trim() : "FAIL: No response";

  if (text.startsWith("PASS")) {
    return { passed: true, reason: "All criteria satisfied", cost };
  }

  const reason = text.startsWith("FAIL:") ? text.slice(5).trim() : text;
  return { passed: false, reason, cost };
}

function calculateCost(inputTokens: number, outputTokens: number): number {
  return (
    (inputTokens / 1_000_000) * INPUT_COST_PER_MILLION +
    (outputTokens / 1_000_000) * OUTPUT_COST_PER_MILLION
  );
}

// ── Main Ralph Loop ──

export async function runRalphLoop(
  projectId: string,
  description: string,
  tasks: RalphTask[],
  sandbox: Sandbox,
  emit: (event: RalphEvent) => void
): Promise<{ totalCostUsd: number; totalIterations: number }> {
  const db = getSupabaseAdmin();

  if (!process.env.ANTHROPIC_API_KEY) {
    emit({
      event: "agent_log",
      data: { task_id: "system", log: "Error: ANTHROPIC_API_KEY is not set" },
    });
    return { totalCostUsd: 0, totalIterations: 0 };
  }

  const anthropic = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY,
    timeout: 5 * 60 * 1000, // 5 minutes — large code gen can take a while
  });

  let totalCostUsd = 0;
  let totalIterations = 0;
  const completedActions: string[] = [];
  const sorted = [...tasks].sort((a, b) => a.order_index - b.order_index);

  // Insert task rows
  const taskRows = sorted.map((t) => ({
    id: t.id,
    project_id: projectId,
    label: t.label,
    order_index: t.order_index,
    status: "pending",
  }));
  await db.from("tasks").insert(taskRows);

  // Shared mutable state for parallel task execution
  const sharedState = {
    totalCostUsd,
    totalIterations,
  };

  // ── Execute a single task (with retries) ──
  async function executeTask(
    task: RalphTask,
    taskIdx: number,
    totalTasks: number
  ): Promise<{ complete: boolean; costAdded: number; iterationsUsed: number; summary?: string }> {
    const startTime = Date.now();
    const hasCriteria = task.success_criteria && task.success_criteria.length > 0;
    let taskComplete = false;
    let costAdded = 0;
    let iterationsUsed = 0;
    let taskSummary: string | undefined;

    emit({
      event: "task_start",
      data: {
        task_id: task.id,
        label: task.label,
        task_index: taskIdx + 1,
        total_tasks: totalTasks,
      },
    });

    await db
      .from("tasks")
      .update({ status: "active" })
      .eq("id", task.id);

    for (let attempt = 1; attempt <= MAX_RETRIES_PER_TASK; attempt++) {
      if (sharedState.totalIterations >= MAX_ITERATIONS) break;
      if (sharedState.totalCostUsd >= BUDGET_LIMIT_USD) break;

      sharedState.totalIterations++;
      iterationsUsed++;

      emit({
        event: "agent_log",
        data: {
          task_id: task.id,
          log: `Task ${taskIdx + 1}/${totalTasks} · Attempt ${attempt}/${MAX_RETRIES_PER_TASK}`,
        },
      });

      try {
        // ── Read guardrails for this project ──
        emit({
          event: "agent_log",
          data: { task_id: task.id, log: "Loading context..." },
        });

        const { data: guardrails, error: guardrailsError } = await db
          .from("guardrails")
          .select("task_label, sign")
          .eq("project_id", projectId);

        if (guardrailsError) {
          emit({
            event: "agent_log",
            data: { task_id: task.id, log: `Guardrails query error: ${guardrailsError.message} — continuing without guardrails` },
          });
        }

        // Filter out stale base64 guardrails — we use plain text now
        const filteredGuardrails = (guardrails ?? []).filter(
          (g) => !(g.sign as string).toLowerCase().includes("base64")
        );

        const guardrailsText =
          filteredGuardrails.length > 0
            ? `\n\nGUARDRAILS (lessons from previous attempts — follow these):\n${filteredGuardrails
                .map((g) => `- [${g.task_label}]: ${g.sign}`)
                .join("\n")}`
            : "";

        const previousContext =
          completedActions.length > 0
            ? `\n\nPrevious tasks completed:\n${completedActions.join("\n")}`
            : "";

        const criteriaText = hasCriteria
          ? `\n\nSUCCESS CRITERIA (your output MUST satisfy all of these):\n${task.success_criteria!.map((c, i) => `${i + 1}. ${c}`).join("\n")}`
          : "";

        // ── Streaming API call — no timeout needed ──
        emit({
          event: "agent_log",
          data: { task_id: task.id, log: "Generating code..." },
        });

        let fullText = "";
        let inputTokens = 0;
        let outputTokens = 0;

        const stream = anthropic.messages.stream({
          model: "claude-sonnet-4-6",
          max_tokens: 16384,
          system: TASK_SYSTEM_PROMPT,
          messages: [
            {
              role: "user",
              content: `Project description: "${description}"\n\nExecute this task: "${task.label}"${criteriaText}${previousContext}${guardrailsText}\n\nRespond with ONLY the JSON object. Use plain text for file content (NOT base64).`,
            },
          ],
        });

        // Stream tokens — emit periodic heartbeats so the UI stays alive
        let lastHeartbeat = Date.now();
        stream.on("text", (text) => {
          fullText += text;
          const now = Date.now();
          if (now - lastHeartbeat > 5000) {
            lastHeartbeat = now;
            emit({
              event: "agent_log",
              data: { task_id: task.id, log: "..." },
            });
          }
        });

        const finalMessage = await stream.finalMessage();
        inputTokens = finalMessage.usage?.input_tokens ?? 0;
        outputTokens = finalMessage.usage?.output_tokens ?? 0;

        // ── Track cost ──
        const callCost = calculateCost(inputTokens, outputTokens);
        costAdded += callCost;
        sharedState.totalCostUsd += callCost;

        emit({
          event: "cost_update",
          data: {
            cost_usd: sharedState.totalCostUsd,
            limit_usd: BUDGET_LIMIT_USD,
            call_tokens: { input: inputTokens, output: outputTokens },
          },
        });

        // ── Parse response ──
        const { action, failReason } = parseAgentResponse(fullText);

        // Debug: log start of response when parse fails
        if (!action && !failReason) {
          const preview = stripHtml(fullText.slice(0, 300)).replace(/\n/g, " ");
          emit({
            event: "agent_log",
            data: {
              task_id: task.id,
              log: `[DEBUG] Response starts with: ${preview}`,
            },
          });
        }

        if (failReason) {
          // Replace any base64 references — the model sometimes tries to base64 on its own
          const cleanReason = failReason.toLowerCase().includes("base64")
            ? "Use plain text for file content in JSON — do NOT base64 encode"
            : failReason;
          await db.from("guardrails").insert({
            project_id: projectId,
            task_label: task.label,
            sign: cleanReason,
          });

          emit({
            event: "agent_log",
            data: {
              task_id: task.id,
              log: `Attempt ${attempt} failed: ${stripHtml(failReason)}`,
            },
          });
          continue;
        }

        if (!action) {
          await db.from("guardrails").insert({
            project_id: projectId,
            task_label: task.label,
            sign: "AI returned unparseable response — return a valid JSON object with plain text file content",
          });

          emit({
            event: "agent_log",
            data: { task_id: task.id, log: `Attempt ${attempt}: invalid response format, retrying...` },
          });
          continue;
        }

        // ── Execute action: write files ──
        if (action.files && action.files.length > 0) {
          const validFiles = action.files.filter((f) => f.path && f.content);
          if (validFiles.length > 0) {
            await writeFiles(
              sandbox,
              validFiles.map((f) => ({ path: f.path, data: f.content }))
            );
            for (const file of validFiles) {
              const shortPath = file.path.replace("/home/user/project/", "");
              emit({
                event: "agent_log",
                data: { task_id: task.id, log: `Created ${shortPath}` },
              });
              emit({
                event: "file_created",
                data: { task_id: task.id, path: shortPath, content: file.content },
              });
            }
          }
        }

        // ── Execute action: run commands ──
        if (action.commands && action.commands.length > 0) {
          for (const cmd of action.commands.slice(0, 5)) {
            const shortCmd = cmd.length > 80 ? cmd.slice(0, 77) + "..." : cmd;
            emit({
              event: "agent_log",
              data: { task_id: task.id, log: `$ ${stripHtml(shortCmd)}` },
            });
            try {
              const result = await runCommandStreaming(sandbox, cmd, {
                timeoutMs: 120_000,
              });
              if (result.exitCode !== 0) {
                const errLines = result.stderr.trim().split("\n").slice(-3).join("\n");
                emit({
                  event: "agent_log",
                  data: { task_id: task.id, log: `Exit ${result.exitCode}: ${stripHtml(errLines || "command failed")}` },
                });
              } else {
                emit({
                  event: "agent_log",
                  data: { task_id: task.id, log: "Done" },
                });
              }
            } catch (cmdErr) {
              const msg = cmdErr instanceof Error ? cmdErr.message : "Command failed";
              emit({
                event: "agent_log",
                data: { task_id: task.id, log: `Command error: ${stripHtml(msg)}` },
              });
            }
          }
        }

        if (action.summary) {
          emit({
            event: "agent_log",
            data: { task_id: task.id, log: stripHtml(action.summary) },
          });
          taskSummary = action.summary;
        }

        // ── VERIFICATION ──
        if (hasCriteria) {
          emit({
            event: "agent_log",
            data: { task_id: task.id, log: "Verifying success criteria..." },
          });

          // Build file map: start with what we just wrote, then overlay sandbox reads
          const writtenFiles: Record<string, string> = {};
          if (action.files) {
            for (const f of action.files) {
              const shortPath = f.path.replace("/home/user/project/", "");
              writtenFiles[shortPath] = f.content;
            }
          }

          const sandboxFiles = await readAllProjectFiles(sandbox);
          const allFiles = { ...writtenFiles, ...sandboxFiles };

          const { passed, failures } = verifyCriteriaLocally(
            allFiles,
            task.success_criteria!,
            emit,
            task.id
          );

          if (!passed) {
            // Only call the expensive reviewer on the LAST retry attempt
            if (attempt === MAX_RETRIES_PER_TASK) {
              emit({
                event: "agent_log",
                data: { task_id: task.id, log: "Running reviewer agent (final check)..." },
              });

              try {
                const review = await runReview(anthropic, task.label, task.success_criteria!, allFiles);
                costAdded += review.cost;
                sharedState.totalCostUsd += review.cost;

                if (review.passed) {
                  emit({
                    event: "agent_log",
                    data: { task_id: task.id, log: "Reviewer: PASS — criteria satisfied" },
                  });
                  taskComplete = true;
                  break;
                } else {
                  emit({
                    event: "agent_log",
                    data: { task_id: task.id, log: `Reviewer: FAIL — ${stripHtml(review.reason)}` },
                  });
                }
              } catch (reviewErr) {
                const msg = reviewErr instanceof Error ? reviewErr.message : "Review failed";
                emit({
                  event: "agent_log",
                  data: { task_id: task.id, log: `Reviewer error: ${stripHtml(msg)}` },
                });
              }
            }

            // Add failure as guardrail for retry
            const failDetail = failures.join("; ");
            await db.from("guardrails").insert({
              project_id: projectId,
              task_label: task.label,
              sign: `Verification failed: ${failDetail}`,
            });
            continue;
          }

          emit({
            event: "agent_log",
            data: { task_id: task.id, log: "All criteria verified" },
          });
        }

        taskComplete = true;
        break;
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : "Unknown error";

        await db.from("guardrails").insert({
          project_id: projectId,
          task_label: task.label,
          sign: `Runtime error: ${message}`,
        });

        emit({
          event: "agent_log",
          data: { task_id: task.id, log: `Attempt ${attempt} error: ${stripHtml(message)}` },
        });
      }
    }

    // ── Update task status ──
    const duration = Math.round((Date.now() - startTime) / 1000);

    if (taskComplete) {
      await db
        .from("tasks")
        .update({ status: "done", duration_seconds: duration })
        .eq("id", task.id);
      emit({ event: "task_complete", data: { task_id: task.id, duration } });
    } else {
      await db
        .from("tasks")
        .update({ status: "error" })
        .eq("id", task.id);
      emit({
        event: "task_error",
        data: { task_id: task.id, error: `Failed after ${MAX_RETRIES_PER_TASK} attempts` },
      });
    }

    return { complete: taskComplete, costAdded, iterationsUsed, summary: taskSummary };
  }

  // ── Group tasks by order_index for parallel execution ──
  const groups: Map<number, { task: RalphTask; globalIdx: number }[]> = new Map();
  for (let i = 0; i < sorted.length; i++) {
    const orderIdx = sorted[i].order_index;
    if (!groups.has(orderIdx)) groups.set(orderIdx, []);
    groups.get(orderIdx)!.push({ task: sorted[i], globalIdx: i });
  }

  const sortedGroupKeys = Array.from(groups.keys()).sort((a, b) => a - b);

  for (const groupKey of sortedGroupKeys) {
    // ── Budget + iteration checks before each group ──
    if (sharedState.totalCostUsd >= BUDGET_LIMIT_USD) {
      emit({
        event: "budget_exceeded",
        data: { cost_usd: sharedState.totalCostUsd, limit_usd: BUDGET_LIMIT_USD },
      });
      await db
        .from("projects")
        .update({ status: "budget_exceeded" })
        .eq("id", projectId);
      break;
    }

    if (sharedState.totalIterations >= MAX_ITERATIONS) {
      emit({
        event: "agent_log",
        data: {
          task_id: "system",
          log: `Hard stop: reached ${MAX_ITERATIONS} total iterations.`,
        },
      });
      break;
    }

    const group = groups.get(groupKey)!;

    if (group.length === 1) {
      const { task, globalIdx } = group[0];
      const result = await executeTask(task, globalIdx, sorted.length);
      if (result.summary) {
        completedActions.push(`- Task ${task.order_index}: ${result.summary}`);
      }
    } else {
      // Multiple tasks at same order_index — run in parallel
      emit({
        event: "agent_log",
        data: {
          task_id: "system",
          log: `Running ${group.length} tasks in parallel (order_index ${groupKey})`,
        },
      });

      const results = await Promise.all(
        group.map(({ task, globalIdx }) =>
          executeTask(task, globalIdx, sorted.length)
        )
      );

      for (let i = 0; i < results.length; i++) {
        if (results[i].summary) {
          completedActions.push(
            `- Task ${group[i].task.order_index}: ${results[i].summary}`
          );
        }
      }
    }
  }

  totalCostUsd = sharedState.totalCostUsd;
  totalIterations = sharedState.totalIterations;

  // ── Update project cost in DB ──
  await db
    .from("projects")
    .update({
      total_tokens_used: totalIterations,
      total_cost_usd: totalCostUsd,
    })
    .eq("id", projectId);

  return { totalCostUsd, totalIterations };
}
