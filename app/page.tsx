"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { supabase } from "@/lib/supabase";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface PlanTask {
  id: string;
  label: string;
  estimated_seconds: number;
  order_index: number;
  status: "pending" | "active" | "done" | "error";
  duration?: number;
}

interface LogEntry {
  task_id: string;
  text: string;
  ts: number;
}

type View = "landing" | "create" | "planning" | "building";

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function uid(): string {
  return crypto.randomUUID();
}

/* ------------------------------------------------------------------ */
/*  Landing                                                            */
/* ------------------------------------------------------------------ */

function Landing({ onStart }: { onStart: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center min-h-screen px-6 text-center">
      {/* Hero */}
      <p className="text-accent font-mono text-sm tracking-widest uppercase mb-4">
        Clancy
      </p>
      <h1 className="font-syne font-800 text-4xl sm:text-6xl lg:text-7xl max-w-3xl leading-tight mb-6">
        Describe&nbsp;it. Watch&nbsp;it&nbsp;build. Get&nbsp;a&nbsp;live&nbsp;link.
      </h1>
      <p className="text-slate-400 max-w-xl mb-10 text-lg">
        Tell Clancy what you want. An autonomous AI agent breaks it into tasks,
        executes them one by one, and ships a working project — while you watch
        every step in real time.
      </p>
      <button
        onClick={onStart}
        className="bg-accent text-bg font-syne font-700 text-lg px-8 py-4 rounded-xl hover:brightness-110 transition-all"
      >
        Start Building
      </button>

      {/* Features */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-8 mt-24 max-w-4xl w-full">
        {[
          {
            title: "Describe",
            desc: "Type a plain-English description of the software you want.",
          },
          {
            title: "Plan",
            desc: "Clancy breaks it into concrete, ordered tasks in seconds.",
          },
          {
            title: "Ship",
            desc: "An AI agent executes every task and gives you a live link.",
          },
        ].map((f) => (
          <div key={f.title} className="bg-surface rounded-xl p-6 text-left">
            <h3 className="font-syne font-700 text-accent text-xl mb-2">
              {f.title}
            </h3>
            <p className="text-slate-400 text-sm leading-relaxed">{f.desc}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Create                                                             */
/* ------------------------------------------------------------------ */

function Create({
  onPlan,
}: {
  onPlan: (description: string, tasks: PlanTask[]) => void;
}) {
  const [desc, setDesc] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleGenerate() {
    setError("");
    if (desc.trim().length < 10) {
      setError("Please describe your project in at least 10 characters.");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/generate-plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ description: desc.trim() }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to generate plan");
      }
      const data = await res.json();
      const tasks: PlanTask[] = data.tasks.map(
        (t: { label: string; estimated_seconds: number; order_index: number }) => ({
          id: uid(),
          label: t.label,
          estimated_seconds: t.estimated_seconds,
          order_index: t.order_index,
          status: "pending" as const,
        })
      );
      onPlan(desc.trim(), tasks);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col items-center justify-center min-h-screen px-6">
      <div className="w-full max-w-2xl">
        <button
          onClick={() => window.location.reload()}
          className="text-slate-500 hover:text-slate-300 text-sm mb-8 transition-colors"
        >
          &larr; Back
        </button>
        <h2 className="font-syne font-700 text-3xl sm:text-4xl mb-2">
          What do you want to build?
        </h2>
        <p className="text-slate-400 mb-8">
          Describe your project in plain English. Be as specific as you can.
        </p>
        <textarea
          value={desc}
          onChange={(e) => setDesc(e.target.value)}
          placeholder="e.g. A habit tracker app with daily streaks, a calendar heatmap, and push notification reminders..."
          className="w-full h-40 bg-surface border border-slate-700 rounded-xl p-4 text-slate-200 placeholder-slate-600 focus:outline-none focus:border-accent resize-none font-mono text-sm"
        />
        {error && (
          <p className="text-red-400 text-sm mt-2">{error}</p>
        )}
        <button
          onClick={handleGenerate}
          disabled={loading}
          className="mt-4 w-full bg-accent text-bg font-syne font-700 text-lg py-4 rounded-xl hover:brightness-110 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {loading ? (
            <span className="flex items-center justify-center gap-2">
              <span className="w-4 h-4 border-2 border-bg border-t-transparent rounded-full animate-spin" />
              Generating plan...
            </span>
          ) : (
            "Generate Plan"
          )}
        </button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Planning                                                           */
/* ------------------------------------------------------------------ */

function Planning({
  tasks,
  onBuild,
}: {
  tasks: PlanTask[];
  onBuild: () => void;
}) {
  const [visible, setVisible] = useState(0);

  useEffect(() => {
    if (visible < tasks.length) {
      const t = setTimeout(() => setVisible((v) => v + 1), 200);
      return () => clearTimeout(t);
    }
    // All tasks visible — auto-transition after 2 seconds
    const t = setTimeout(onBuild, 2000);
    return () => clearTimeout(t);
  }, [visible, tasks.length, onBuild]);

  return (
    <div className="flex flex-col items-center justify-center min-h-screen px-6">
      <div className="w-full max-w-2xl">
        <h2 className="font-syne font-700 text-3xl sm:text-4xl mb-2">
          Your Build Plan
        </h2>
        <p className="text-slate-400 mb-8">
          {visible < tasks.length
            ? "Breaking your idea into tasks..."
            : "Starting build..."}
        </p>
        <ol className="space-y-3">
          {tasks.slice(0, visible).map((task, i) => (
            <li
              key={task.id}
              className="flex items-start gap-3 bg-surface rounded-lg p-4 animate-fade-in-up"
              style={{ animationDelay: `${i * 50}ms` }}
            >
              <span className="flex-shrink-0 w-6 h-6 rounded-full bg-accent/20 text-accent flex items-center justify-center text-xs font-mono font-500">
                {task.order_index}
              </span>
              <div>
                <p className="text-slate-200 text-sm">{task.label}</p>
                <p className="text-slate-500 text-xs mt-1 font-mono">
                  ~{task.estimated_seconds}s
                </p>
              </div>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Building                                                           */
/* ------------------------------------------------------------------ */

function Building({
  tasks: initialTasks,
  projectId,
  description,
}: {
  tasks: PlanTask[];
  projectId: string;
  description: string;
}) {
  const [tasks, setTasks] = useState<PlanTask[]>(initialTasks);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [complete, setComplete] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const logEndRef = useRef<HTMLDivElement>(null);
  const started = useRef(false);

  async function handleSave() {
    setSaving(true);
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      // Not logged in — redirect to auth
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

  useEffect(() => {
    if (logEndRef.current) {
      logEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [logs]);

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    const payload = {
      project_id: projectId,
      tasks: initialTasks.map((t) => ({
        id: t.id,
        label: t.label,
        order_index: t.order_index,
      })),
    };

    // Use fetch with ReadableStream to consume SSE since EventSource only supports GET
    async function runStream() {
      const res = await fetch("/api/run-agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
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
    }

    runStream();
  }, [initialTasks, projectId]);

  function handleSSE(
    event: string,
    data: { task_id?: string; label?: string; log?: string; duration?: number; message?: string; error?: string }
  ) {
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
          <h2 className="font-syne font-700 text-xl mb-1">Task Queue</h2>
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
              {logs.map((entry, i) => (
                <div
                  key={i}
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

/* ------------------------------------------------------------------ */
/*  Root Page                                                          */
/* ------------------------------------------------------------------ */

export default function Home() {
  const [view, setView] = useState<View>("landing");
  const [tasks, setTasks] = useState<PlanTask[]>([]);
  const [description, setDescription] = useState("");
  const [projectId] = useState(() => uid());

  const handlePlan = useCallback((desc: string, newTasks: PlanTask[]) => {
    setDescription(desc);
    setTasks(newTasks);
    setView("planning");
  }, []);

  const handleBuild = useCallback(() => {
    setView("building");
  }, []);

  switch (view) {
    case "landing":
      return <Landing onStart={() => setView("create")} />;
    case "create":
      return <Create onPlan={handlePlan} />;
    case "planning":
      return <Planning tasks={tasks} onBuild={handleBuild} />;
    case "building":
      return (
        <Building
          tasks={tasks}
          projectId={projectId}
          description={description}
        />
      );
  }
}
