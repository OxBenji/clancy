"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { supabase } from "@/lib/supabase";
import type { PlanTask, LogEntry } from "@/lib/types";

export default function Building({
  tasks: initialTasks,
  projectId,
  description,
  onBack,
}: {
  tasks: PlanTask[];
  projectId: string;
  description: string;
  onBack: () => void;
}) {
  const [tasks, setTasks] = useState<PlanTask[]>(initialTasks);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [complete, setComplete] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const logEndRef = useRef<HTMLDivElement>(null);
  const started = useRef(false);
  const abortRef = useRef<AbortController | null>(null);

  async function handleSave() {
    setSaving(true);
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      window.location.href = "/auth";
      return;
    }

    const { error } = await supabase.from("projects").insert({
      id: projectId,
      user_id: user.id,
      title: description.slice(0, 100),
      description,
      status: "complete",
    });

    setSaving(false);
    if (!error) setSaved(true);
  }

  const handleSSE = useCallback(
    (
      event: string,
      data: {
        task_id?: string;
        label?: string;
        log?: string;
        duration?: number;
        message?: string;
        error?: string;
      }
    ) => {
      switch (event) {
        case "task_start":
          setTasks((prev) =>
            prev.map((t) =>
              t.id === data.task_id ? { ...t, status: "active" } : t
            )
          );
          setLogs((prev) => [
            ...prev,
            {
              task_id: data.task_id!,
              text: `--- Starting: ${data.label} ---`,
              ts: Date.now(),
            },
          ]);
          break;

        case "agent_log":
          setLogs((prev) => [
            ...prev,
            { task_id: data.task_id!, text: data.log!, ts: Date.now() },
          ]);
          break;

        case "task_complete":
          setTasks((prev) =>
            prev.map((t) =>
              t.id === data.task_id
                ? { ...t, status: "done", duration: data.duration }
                : t
            )
          );
          setLogs((prev) => [
            ...prev,
            {
              task_id: data.task_id!,
              text: `--- Completed in ${data.duration}s ---`,
              ts: Date.now(),
            },
          ]);
          break;

        case "task_error":
          setTasks((prev) =>
            prev.map((t) =>
              t.id === data.task_id ? { ...t, status: "error" } : t
            )
          );
          setLogs((prev) => [
            ...prev,
            {
              task_id: data.task_id!,
              text: `--- Error: ${data.error} ---`,
              ts: Date.now(),
            },
          ]);
          break;

        case "build_complete":
          setComplete(true);
          setLogs((prev) => [
            ...prev,
            { task_id: "system", text: data.message!, ts: Date.now() },
          ]);
          break;
      }
    },
    []
  );

  useEffect(() => {
    if (logEndRef.current) {
      logEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [logs]);

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    const abortController = new AbortController();
    abortRef.current = abortController;

    const payload = {
      project_id: projectId,
      tasks: initialTasks.map((t) => ({
        id: t.id,
        label: t.label,
        order_index: t.order_index,
      })),
    };

    async function runStream() {
      try {
        const res = await fetch("/api/run-agent", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
          signal: abortController.signal,
        });

        if (!res.body) return;

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const parts = buffer.split("\n\n");
          buffer = parts.pop() || "";

          for (const part of parts) {
            let event = "message";
            let data = "";
            for (const line of part.split("\n")) {
              if (line.startsWith("event: ")) event = line.slice(7);
              if (line.startsWith("data: ")) data = line.slice(6);
            }
            if (!data) continue;
            try {
              const parsed = JSON.parse(data);
              handleSSE(event, parsed);
            } catch {
              // skip malformed data
            }
          }
        }
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return;
        console.error("SSE stream error:", err);
      }
    }

    runStream();

    return () => {
      abortController.abort();
    };
  }, [initialTasks, projectId, handleSSE]);

  function handleCancel() {
    if (abortRef.current) {
      abortRef.current.abort();
    }
    onBack();
  }

  const statusIcon = (s: PlanTask["status"]) => {
    switch (s) {
      case "pending":
        return (
          <span className="w-3 h-3 rounded-full border border-slate-600 block" />
        );
      case "active":
        return (
          <span className="w-3 h-3 rounded-full bg-accent animate-pulse_dot block" />
        );
      case "done":
        return (
          <span className="w-3 h-3 rounded-full bg-accent block" />
        );
      case "error":
        return (
          <span className="w-3 h-3 rounded-full bg-red-500 block" />
        );
    }
  };

  return (
    <div className="min-h-screen flex flex-col">
      {/* Success banner */}
      {complete && (
        <div className="bg-accent text-bg text-center py-3 font-syne font-700 text-sm sm:text-base flex items-center justify-center gap-4">
          <span>Your project is ready.</span>
          {saved ? (
            <span className="bg-bg/20 px-3 py-1 rounded-lg text-sm">
              Saved to your projects
            </span>
          ) : (
            <button
              onClick={handleSave}
              disabled={saving}
              className="bg-bg text-accent px-4 py-1 rounded-lg text-sm hover:bg-bg/80 transition-colors disabled:opacity-50"
            >
              {saving ? "Saving..." : "Save Your Project"}
            </button>
          )}
        </div>
      )}

      <div className="flex-1 flex flex-col lg:flex-row">
        {/* Left: Task Queue */}
        <div className="lg:w-[380px] flex-shrink-0 border-r border-slate-800 p-6 overflow-y-auto">
          <div className="flex items-center justify-between mb-1">
            <h2 className="font-syne font-700 text-xl">Task Queue</h2>
            {!complete && (
              <button
                onClick={handleCancel}
                className="text-slate-500 hover:text-red-400 text-xs font-mono transition-colors"
              >
                Cancel
              </button>
            )}
            {complete && (
              <button
                onClick={onBack}
                className="text-slate-500 hover:text-slate-300 text-xs font-mono transition-colors"
              >
                New Project
              </button>
            )}
          </div>
          <p className="text-slate-500 text-xs mb-6 font-mono">
            {tasks.filter((t) => t.status === "done").length}/{tasks.length}{" "}
            completed
          </p>
          <ol className="space-y-2">
            {tasks.map((task) => (
              <li
                key={task.id}
                className={`flex items-center gap-3 rounded-lg p-3 transition-colors ${
                  task.status === "active"
                    ? "bg-accent/10 border border-accent/30"
                    : task.status === "done"
                    ? "bg-surface opacity-60"
                    : "bg-surface"
                }`}
              >
                {statusIcon(task.status)}
                <div className="flex-1 min-w-0">
                  <p
                    className={`text-sm truncate ${
                      task.status === "active"
                        ? "text-accent"
                        : task.status === "done"
                        ? "text-slate-400 line-through"
                        : "text-slate-300"
                    }`}
                  >
                    {task.label}
                  </p>
                  {task.status === "done" && task.duration != null && (
                    <p className="text-slate-600 text-xs font-mono">
                      {task.duration}s
                    </p>
                  )}
                </div>
              </li>
            ))}
          </ol>
        </div>

        {/* Right: Agent Log */}
        <div className="flex-1 flex flex-col min-h-0">
          <div className="p-6 pb-2">
            <h2 className="font-syne font-700 text-xl mb-1">Agent Log</h2>
            <p className="text-slate-500 text-xs font-mono">
              Live output from the build agent
            </p>
          </div>
          <div className="flex-1 overflow-y-auto p-6 pt-2 log-scroll">
            <div className="bg-surface rounded-xl p-4 min-h-full">
              {logs.length === 0 && !complete && (
                <p className="text-slate-600 font-mono text-sm animate-pulse">
                  Waiting for agent...
                </p>
              )}
              {logs.map((entry, i) => (
                <div
                  key={`${entry.ts}-${i}`}
                  className={`font-mono text-sm leading-relaxed ${
                    entry.text.startsWith("---")
                      ? entry.text.includes("Error")
                        ? "text-red-400 mt-3 mb-1"
                        : "text-accent/70 mt-3 mb-1"
                      : "text-slate-400 pl-2"
                  }`}
                >
                  <span className="text-slate-600 select-none mr-2 text-xs">
                    {new Date(entry.ts).toLocaleTimeString([], {
                      hour12: false,
                      hour: "2-digit",
                      minute: "2-digit",
                      second: "2-digit",
                    })}
                  </span>
                  {entry.text}
                </div>
              ))}
              {!complete && logs.length > 0 && (
                <span className="inline-block w-2 h-4 bg-accent/70 animate-pulse ml-2 mt-1" />
              )}
              <div ref={logEndRef} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
