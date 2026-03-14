import Anthropic from "@anthropic-ai/sdk";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import {
  writeFiles,
  runCommandStreaming,
} from "@/lib/sandbox";
import { stripHtml } from "@/lib/sanitize";
import type { Sandbox } from "e2b";

// ── Cost constants for claude-sonnet-4-6 ──
const INPUT_COST_PER_MILLION = 3; // $3 per 1M input tokens
const OUTPUT_COST_PER_MILLION = 15; // $15 per 1M output tokens
const BUDGET_LIMIT_USD = parseFloat(process.env.BUDGET_LIMIT_USD || "2.00");
const MAX_ITERATIONS = parseInt(process.env.MAX_ITERATIONS || "10", 10);
const MAX_RETRIES_PER_TASK = 3;

// ── Types ──

export interface RalphTask {
  id: string;
  label: string;
  order_index: number;
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

// ── System prompt for each fresh context ──

const TASK_SYSTEM_PROMPT = `You are an autonomous software agent executing ONE specific task inside a Linux sandbox. You have FRESH context — you do NOT remember previous interactions.

Read the guardrails carefully — these are lessons from previous attempts that you MUST follow.

Execute the task by returning a JSON object:
{"files":[{"path":"/home/user/project/filename","content":"file content"}],"commands":["cd /home/user/project && npm install"],"summary":"What you did"}

Rules:
- All file paths must be absolute, under /home/user/project/
- Write complete, working code — not pseudocode or placeholders
- For web projects, use vanilla HTML/CSS/JS by default
- Include index.html as the entry point
- Keep files small and focused
- Commands run in a Linux environment with Node.js, npm, and Python available
- RESPOND WITH ONLY RAW JSON followed by your completion status
- When complete, output <promise>COMPLETE</promise> after the JSON
- If you cannot complete the task, output <promise>FAILED: reason</promise> after the JSON`;

// ── Helpers ──

function parseAgentResponse(text: string): { action: AgentAction | null; complete: boolean; failReason: string | null } {
  // Extract promise tag
  const promiseMatch = text.match(/<promise>([\s\S]*?)<\/promise>/);
  let complete = false;
  let failReason: string | null = null;

  if (promiseMatch) {
    const promiseContent = promiseMatch[1].trim();
    if (promiseContent === "COMPLETE") {
      complete = true;
    } else if (promiseContent.startsWith("FAILED:")) {
      failReason = promiseContent.slice(7).trim();
    }
  }

  // Strip promise tags and code fences
  let jsonText = text
    .replace(/<promise>[\s\S]*?<\/promise>/g, "")
    .trim();

  // Remove markdown code fences (```json ... ``` or ``` ... ```)
  jsonText = jsonText.replace(/```(?:json)?\s*\n?/g, "").replace(/\n?\s*```/g, "").trim();

  let action: AgentAction | null = null;

  // Attempt 1: direct parse
  try {
    action = JSON.parse(jsonText);
  } catch {
    // Attempt 2: find JSON by matching balanced braces
    action = extractBalancedJson(jsonText);
  }

  // If we got a valid action with files, consider it complete even without the tag
  if (action && action.files && action.files.length > 0 && !failReason) {
    complete = true;
  }

  return { action, complete, failReason };
}

/** Extract the first balanced JSON object from text with nested braces. */
function extractBalancedJson(text: string): AgentAction | null {
  const start = text.indexOf("{");
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escape = false;

  for (let i = start; i < text.length; i++) {
    const ch = text[i];

    if (escape) {
      escape = false;
      continue;
    }

    if (ch === "\\") {
      escape = true;
      continue;
    }

    if (ch === '"') {
      inString = !inString;
      continue;
    }

    if (inString) continue;

    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(text.slice(start, i + 1));
        } catch {
          return null;
        }
      }
    }
  }

  return null;
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

        // ── Fresh Anthropic API call ──
        const response = await anthropic.messages.create({
          model: "claude-sonnet-4-6",
          max_tokens: 4096,
          system: TASK_SYSTEM_PROMPT,
          messages: [
            {
              role: "user",
              content: `Project description: "${description}"\n\nExecute this task: "${task.label}"${previousContext}${guardrailsText}\n\nRespond with ONLY a JSON object. Start your response with { character.`,
            },
          ],
        });

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
        const { action, complete, failReason } = parseAgentResponse(rawText);

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
          // Write guardrail sign
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
          continue; // retry
        }

        if (!action) {
          await db.from("guardrails").insert({
            project_id: projectId,
            task_label: task.label,
            sign: "AI returned unparseable response — ensure raw JSON output only",
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

        // ── Execute action: run commands (no line-by-line streaming to keep log clean) ──
        if (action.commands && Array.isArray(action.commands)) {
          for (const cmd of action.commands.slice(0, 5)) {
            // Show short version of command (truncate long heredocs/echo)
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
                // Only show last 3 lines of stderr on failure
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

        if (complete) {
          taskComplete = true;
          break; // success — move to next task
        }

        // If action executed but no explicit COMPLETE, treat as success
        taskComplete = true;
        break;
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : "Unknown error";

        // Write guardrail
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
