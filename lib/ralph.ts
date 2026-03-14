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

// ── System prompt — base64-encoded file contents ──

const TASK_SYSTEM_PROMPT = `You are an autonomous software agent executing ONE specific task inside a Linux sandbox. You have FRESH context — you do NOT remember previous interactions.

Read the guardrails carefully — these are lessons from previous attempts that you MUST follow.

RESPONSE FORMAT:
Return your response as a JSON object where each file's content field is BASE64 ENCODED.

{"files":[{"path":"/home/user/project/index.html","content":"BASE64_ENCODED_CONTENT"},{"path":"/home/user/project/css/styles.css","content":"BASE64_ENCODED_CONTENT"}],"commands":["cd /home/user/project && npm install"],"summary":"What you did"}

CRITICAL RULES FOR BASE64:
- The "content" field of each file MUST be the base64-encoded version of the file content
- The "path" field is plain text (NOT base64)
- The "summary" field is plain text (NOT base64)
- The "commands" array contains plain text commands (NOT base64)
- ONLY the file content values are base64 encoded
- To base64 encode: take the raw file content string and encode it to base64

Other rules:
- All file paths must be absolute, under /home/user/project/
- Write complete, working code — not pseudocode or placeholders
- For web projects, use vanilla HTML/CSS/JS by default
- Include index.html as the entry point
- Keep files small and focused
- Commands run in a Linux environment with Node.js, npm, and Python available
- RESPOND WITH ONLY THE JSON OBJECT — no markdown fences, no extra text before or after
- When complete, add "status":"complete" to the JSON
- If you cannot complete the task, add "status":"failed","reason":"explanation" to the JSON`;

const REVIEWER_SYSTEM_PROMPT = `You are a code reviewer. You will be given a task label, success criteria, and the actual file contents from a sandbox. Your job is to verify whether the code satisfies ALL the success criteria.

Reply with EXACTLY one of:
- PASS
- FAIL: [specific reason what is missing or wrong]

Be strict. Check each criterion literally against the file contents. If a criterion says "index.html contains <nav>", check that the string "<nav" actually appears in index.html.`;

// ── Parser: extract files via regex, decode base64 content ──

function parseAgentResponse(text: string): { action: AgentAction | null; complete: boolean; failReason: string | null } {
  let complete = false;
  let failReason: string | null = null;

  // Strip markdown code fences
  let cleaned = text.trim();
  cleaned = cleaned.replace(/```(?:json)?\s*\n?/g, "").replace(/\n?\s*```/g, "").trim();

  // Also support legacy <promise> tags
  const promiseMatch = cleaned.match(/<promise>([\s\S]*?)<\/promise>/);
  if (promiseMatch) {
    const promiseContent = promiseMatch[1].trim();
    if (promiseContent === "COMPLETE") complete = true;
    else if (promiseContent.startsWith("FAILED:")) failReason = promiseContent.slice(7).trim();
    cleaned = cleaned.replace(/<promise>[\s\S]*?<\/promise>/g, "").trim();
  }

  // Extract files using regex — more forgiving than JSON.parse on the whole object
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

  // Extract commands
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

  // Extract summary
  let summary = "";
  const summaryMatch = cleaned.match(/"summary"\s*:\s*"((?:[^"\\]|\\.)*)"/);
  if (summaryMatch) {
    summary = summaryMatch[1].replace(/\\"/g, '"').replace(/\\\\/g, "\\");
  }

  // Check status field
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

  if (files.length > 0 && !failReason) {
    complete = true;
  }

  const action: AgentAction = { files, commands, summary };
  return { action, complete, failReason };
}

// ── Shared helper: recursively read all project files (up to 2 levels deep) ──

async function readAllProjectFiles(
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

// ── Success criteria verification ──

async function verifyCriteria(
  sandbox: Sandbox,
  criteria: string[],
  emit: (event: RalphEvent) => void,
  taskId: string
): Promise<{ passed: boolean; failures: string[] }> {
  const failures: string[] = [];

  const fileContents = await readAllProjectFiles(sandbox);
  if (Object.keys(fileContents).length === 0) {
    return { passed: false, failures: ["Could not read project files"] };
  }

  // Helper: find file content by exact name or basename match (e.g. "styles.css" matches "css/styles.css")
  const findFile = (name: string): string | undefined => {
    if (fileContents[name]) return fileContents[name];
    // Try basename match
    const byBasename = Object.entries(fileContents).find(
      ([path]) => path.endsWith(`/${name}`) || path === name
    );
    return byBasename?.[1];
  };

  for (const criterion of criteria) {
    // Parse criterion: "filename contains pattern"
    const containsMatch = criterion.match(/^(\S+)\s+contains?\s+(.+)$/i);
    if (containsMatch) {
      const targetFile = containsMatch[1];
      const pattern = containsMatch[2].trim();
      const content = findFile(targetFile);
      if (!content) {
        failures.push(`${targetFile} not found`);
        emit({ event: "agent_log", data: { task_id: taskId, log: `[VERIFY] FAIL: ${targetFile} not found` } });
      } else if (!content.includes(pattern)) {
        failures.push(`${targetFile} missing: ${pattern}`);
        emit({ event: "agent_log", data: { task_id: taskId, log: `[VERIFY] FAIL: ${targetFile} missing ${pattern}` } });
      } else {
        emit({ event: "agent_log", data: { task_id: taskId, log: `[VERIFY] PASS: ${targetFile} contains ${pattern}` } });
      }
    } else {
      // Generic check — look for the criterion text in any file
      const found = Object.entries(fileContents).some(([, content]) => content.includes(criterion));
      if (found) {
        emit({ event: "agent_log", data: { task_id: taskId, log: `[VERIFY] PASS: found "${criterion.slice(0, 50)}"` } });
      } else {
        failures.push(`Not found in any file: ${criterion}`);
        emit({ event: "agent_log", data: { task_id: taskId, log: `[VERIFY] FAIL: "${criterion.slice(0, 50)}" not found` } });
      }
    }
  }

  return { passed: failures.length === 0, failures };
}

// ── Haiku reviewer agent ──

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
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

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

  for (let taskIdx = 0; taskIdx < sorted.length; taskIdx++) {
    const task = sorted[taskIdx];
    const startTime = Date.now();

    // ── Budget check ──
    if (totalCostUsd >= BUDGET_LIMIT_USD) {
      emit({
        event: "budget_exceeded",
        data: { cost_usd: totalCostUsd, limit_usd: BUDGET_LIMIT_USD },
      });
      await db
        .from("projects")
        .update({ status: "budget_exceeded" })
        .eq("id", projectId);
      break;
    }

    // ── Max iterations check ──
    if (totalIterations >= MAX_ITERATIONS) {
      emit({
        event: "agent_log",
        data: {
          task_id: "system",
          log: `Hard stop: reached ${MAX_ITERATIONS} total iterations.`,
        },
      });
      break;
    }

    emit({
      event: "task_start",
      data: {
        task_id: task.id,
        label: task.label,
        task_index: taskIdx + 1,
        total_tasks: sorted.length,
      },
    });

    await db
      .from("tasks")
      .update({ status: "active" })
      .eq("id", task.id);

    const hasCriteria = task.success_criteria && task.success_criteria.length > 0;

    // ── Retry loop (max 3 attempts) ──
    let taskComplete = false;

    for (let attempt = 1; attempt <= MAX_RETRIES_PER_TASK; attempt++) {
      if (totalIterations >= MAX_ITERATIONS) break;
      if (totalCostUsd >= BUDGET_LIMIT_USD) break;

      totalIterations++;

      emit({
        event: "agent_log",
        data: {
          task_id: task.id,
          log: `Task ${taskIdx + 1}/${sorted.length} · Attempt ${attempt}/${MAX_RETRIES_PER_TASK}`,
          task_index: taskIdx + 1,
          total_tasks: sorted.length,
          attempt,
          max_attempts: MAX_RETRIES_PER_TASK,
          iteration: totalIterations,
          max_iterations: MAX_ITERATIONS,
        },
      });

      try {
        // ── Read guardrails for this project ──
        const { data: guardrails } = await db
          .from("guardrails")
          .select("task_label, sign")
          .eq("project_id", projectId);

        const guardrailsText =
          guardrails && guardrails.length > 0
            ? `\n\nGUARDRAILS (lessons from previous attempts — follow these):\n${guardrails
                .map((g) => `- [${g.task_label}]: ${g.sign}`)
                .join("\n")}`
            : "";

        const previousContext =
          completedActions.length > 0
            ? `\n\nPrevious tasks completed:\n${completedActions.join("\n")}`
            : "";

        // Include success criteria in the prompt so the worker knows what to target
        const criteriaText = hasCriteria
          ? `\n\nSUCCESS CRITERIA (your output MUST satisfy all of these):\n${task.success_criteria!.map((c, i) => `${i + 1}. ${c}`).join("\n")}`
          : "";

        // ── Fresh Anthropic API call (with heartbeat so UI doesn't look stuck) ──
        emit({
          event: "agent_log",
          data: { task_id: task.id, log: "Generating code..." },
        });

        // Heartbeat: send a dot every 5s while waiting for Claude
        const heartbeat = setInterval(() => {
          emit({
            event: "agent_log",
            data: { task_id: task.id, log: "..." },
          });
        }, 5000);

        let response;
        try {
          response = await anthropic.messages.create({
            model: "claude-sonnet-4-6",
            max_tokens: 16384,
            system: TASK_SYSTEM_PROMPT,
            messages: [
              {
                role: "user",
                content: `Project description: "${description}"\n\nExecute this task: "${task.label}"${criteriaText}${previousContext}${guardrailsText}\n\nIMPORTANT: Base64 encode ALL file content values. Respond with ONLY the JSON object.`,
              },
            ],
          });
        } finally {
          clearInterval(heartbeat);
        }

        // ── Track cost ──
        const inputTokens = response.usage?.input_tokens ?? 0;
        const outputTokens = response.usage?.output_tokens ?? 0;
        const callCost = calculateCost(inputTokens, outputTokens);
        totalCostUsd += callCost;

        emit({
          event: "cost_update",
          data: {
            cost_usd: totalCostUsd,
            limit_usd: BUDGET_LIMIT_USD,
            call_tokens: { input: inputTokens, output: outputTokens },
          },
        });

        // ── Parse response ──
        const textBlock = response.content.find((b) => b.type === "text");
        if (!textBlock || textBlock.type !== "text") {
          throw new Error("No response from AI");
        }

        const rawText = textBlock.text;
        const { action, failReason } = parseAgentResponse(rawText);

        // Debug: log start of response when parse fails
        if (!action && !failReason) {
          const preview = stripHtml(rawText.slice(0, 300)).replace(/\n/g, " ");
          emit({
            event: "agent_log",
            data: {
              task_id: task.id,
              log: `[DEBUG] Response starts with: ${preview}`,
            },
          });
        }

        if (failReason) {
          await db.from("guardrails").insert({
            project_id: projectId,
            task_label: task.label,
            sign: failReason,
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
            sign: "AI returned unparseable response — base64 encode file content values in JSON",
          });

          emit({
            event: "agent_log",
            data: { task_id: task.id, log: `Attempt ${attempt}: invalid response format, retrying...` },
          });
          continue;
        }

        // ── Execute action: write files ──
        if (action.files && Array.isArray(action.files)) {
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
        if (action.commands && Array.isArray(action.commands)) {
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
          completedActions.push(
            `- Task ${task.order_index}: ${action.summary}`
          );
        }

        // ── VERIFICATION: check success criteria against actual files ──
        if (hasCriteria) {
          emit({
            event: "agent_log",
            data: { task_id: task.id, log: "Verifying success criteria..." },
          });

          const { passed, failures } = await verifyCriteria(
            sandbox,
            task.success_criteria!,
            emit,
            task.id
          );

          if (!passed) {
            // ── REVIEWER: Haiku cross-checks ──
            emit({
              event: "agent_log",
              data: { task_id: task.id, log: "Running reviewer agent..." },
            });

            // Read current files for review (including subdirectories)
            const reviewContents = await readAllProjectFiles(sandbox);

            try {
              const review = await runReview(anthropic, task.label, task.success_criteria!, reviewContents);
              totalCostUsd += review.cost;

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

                // Add failure as guardrail for retry
                const failDetail = failures.join("; ");
                await db.from("guardrails").insert({
                  project_id: projectId,
                  task_label: task.label,
                  sign: `Verification failed: ${failDetail}. Reviewer: ${review.reason}`,
                });
                continue; // retry with guardrail
              }
            } catch (reviewErr) {
              // If review fails, fall back to criteria check result
              const msg = reviewErr instanceof Error ? reviewErr.message : "Review failed";
              emit({
                event: "agent_log",
                data: { task_id: task.id, log: `Reviewer error: ${stripHtml(msg)} — using criteria check` },
              });

              const failDetail = failures.join("; ");
              await db.from("guardrails").insert({
                project_id: projectId,
                task_label: task.label,
                sign: `Verification failed: ${failDetail}`,
              });
              continue;
            }
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
  }

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
