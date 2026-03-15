"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { useUser } from "@/lib/clerk-hooks";
import JSZip from "jszip";
import { supabase } from "@/lib/supabase";
import EditChat from "@/components/EditChat";
import type { PlanTask, LogEntry, FileEntry } from "@/lib/types";

type MobilePanel = "tasks" | "log" | "files";

/** Strip HTML tags from log text to prevent XSS. */
function sanitizeLog(text: string): string {
  return text.replace(/<[^>]*>/g, "");
}

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
  const { user } = useUser();
  const [tasks, setTasks] = useState<PlanTask[]>(initialTasks);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [sandboxId, setSandboxId] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [showEdit, setShowEdit] = useState(false);
  const [sandboxExpired, setSandboxExpired] = useState(false);
  const [iframeKey, setIframeKey] = useState(0);
  const [complete, setComplete] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [costUsd, setCostUsd] = useState(0);
  const [costLimit, setCostLimit] = useState(2.0);
  const [budgetExceeded, setBudgetExceeded] = useState(false);
  const [mobilePanel, setMobilePanel] = useState<MobilePanel>("log");
  const [waiting, setWaiting] = useState(false);
  const logEndRef = useRef<HTMLDivElement>(null);
  const started = useRef(false);
  const abortRef = useRef<AbortController | null>(null);
  const waitingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  async function handleDownloadZip() {
    const zip = new JSZip();
    for (const file of files) {
      // Strip leading /home/user/project/ prefix for cleaner paths
      const cleanPath = file.path.replace(/^\/home\/user\/project\//, "");
      zip.file(cleanPath, file.content);
    }
    const blob = await zip.generateAsync({ type: "blob" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${description.slice(0, 30).replace(/[^a-zA-Z0-9]/g, "-")}-project.zip`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  async function handleSave() {
    if (!user) {
      window.location.href = "/auth";
      return;
    }

    setSaving(true);
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

  const resetWaitingTimer = useCallback(() => {
    setWaiting(false);
    if (waitingTimer.current) clearTimeout(waitingTimer.current);
    waitingTimer.current = setTimeout(() => setWaiting(true), 5000);
  }, []);

  // Clean up waiting timer on unmount
  useEffect(() => {
    return () => {
      if (waitingTimer.current) clearTimeout(waitingTimer.current);
    };
  }, []);

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
        url?: string;
        id?: string;
        path?: string;
        content?: string;
        cost_usd?: number;
        limit_usd?: number;
      }
    ) => {
      resetWaitingTimer();

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
              text: sanitizeLog(`--- Starting: ${data.label} ---`),
              ts: Date.now(),
            },
          ]);
          break;

        case "agent_log":
          setLogs((prev) => [
            ...prev,
            { task_id: data.task_id!, text: sanitizeLog(data.log!), ts: Date.now() },
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
              text: sanitizeLog(`--- Error: ${data.error} ---`),
              ts: Date.now(),
            },
          ]);
          break;

        case "file_created":
          setFiles((prev) => [
            ...prev.filter((f) => f.path !== data.path),
            { path: data.path!, content: data.content! },
          ]);
          break;

        case "sandbox_id":
          setSandboxId(data.id as string);
          break;

        case "preview_url":
          setPreviewUrl(data.url!);
          break;

        case "cost_update":
          if (typeof data.cost_usd === "number") setCostUsd(data.cost_usd);
          if (typeof data.limit_usd === "number") setCostLimit(data.limit_usd);
          break;

        case "budget_exceeded":
          setBudgetExceeded(true);
          setComplete(true);
          setLogs((prev) => [
            ...prev,
            {
              task_id: "system",
              text: `--- Budget exceeded: $${(data.cost_usd ?? 0).toFixed(2)} / $${(data.limit_usd ?? 2).toFixed(2)} limit ---`,
              ts: Date.now(),
            },
          ]);
          break;

        case "build_complete":
          setWaiting(false);
          if (waitingTimer.current) clearTimeout(waitingTimer.current);
          setComplete(true);
          setLogs((prev) => [
            ...prev,
            { task_id: "system", text: sanitizeLog(data.message!), ts: Date.now() },
          ]);
          break;
      }
    },
    [resetWaitingTimer]
  );

  useEffect(() => {
    if (!complete && logEndRef.current) {
      logEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [logs, complete]);

  // Scroll to top when build completes so user sees the success banner
  useEffect(() => {
    if (complete) {
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  }, [complete]);

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    const abortController = new AbortController();
    abortRef.current = abortController;

    const payload = {
      project_id: projectId,
      description,
      tasks: initialTasks.map((t) => ({
        id: t.id,
        label: t.label,
        order_index: t.order_index,
        success_criteria: t.success_criteria,
      })),
    };

    async function runStream() {
      resetWaitingTimer();
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

        // ── Resilience: recover state from DB on stream disconnect ──
        try {
          const { data: dbTasks } = await supabase
            .from("tasks")
            .select("id, status, duration_seconds")
            .eq("project_id", projectId);

          if (dbTasks && dbTasks.length > 0) {
            const taskRecords = dbTasks as { id: string; status: string; duration_seconds?: number }[];
            setTasks((prev) =>
              prev.map((t) => {
                const dbTask = taskRecords.find((d) => d.id === t.id);
                if (!dbTask) return t;
                return {
                  ...t,
                  status: dbTask.status === "done"
                    ? "done" as const
                    : dbTask.status === "error"
                    ? "error" as const
                    : dbTask.status === "active"
                    ? "active" as const
                    : t.status,
                  duration: dbTask.duration_seconds ?? t.duration,
                };
              })
            );

            // Check if all tasks are done or errored
            const allFinished = taskRecords.every(
              (d) => d.status === "done" || d.status === "error"
            );
            if (allFinished) {
              setComplete(true);
              setLogs((prev) => [
                ...prev,
                {
                  task_id: "system",
                  text: "--- Connection lost but build finished. State recovered from database. ---",
                  ts: Date.now(),
                },
              ]);
            } else {
              setLogs((prev) => [
                ...prev,
                {
                  task_id: "system",
                  text: "--- Connection lost. Progress recovered from database. Build may still be running. ---",
                  ts: Date.now(),
                },
              ]);
            }
          }
        } catch {
          // DB recovery also failed — show generic error
          setLogs((prev) => [
            ...prev,
            {
              task_id: "system",
              text: "--- Connection lost. Could not recover state. ---",
              ts: Date.now(),
            },
          ]);
        }
      }
    }

    runStream();

    return () => {
      abortController.abort();
    };
  }, [initialTasks, projectId, description, handleSSE, resetWaitingTimer]);

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

  const activeFile = files.find((f) => f.path === selectedFile);

  return (
    <div className="min-h-screen flex flex-col">
      {/* Success banner with preview URL */}
      {complete && (
        <div className={`${budgetExceeded ? "bg-red-500" : "bg-accent"} text-bg text-center py-3 font-syne font-700 text-sm sm:text-base flex flex-wrap items-center justify-center gap-4 px-4`}>
          <span>{budgetExceeded ? "Budget limit reached" : "Your project is ready!"}</span>
          {previewUrl && !sandboxExpired && (
            <a
              href={previewUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="bg-bg text-accent px-4 py-1 rounded-lg text-sm hover:bg-bg/80 transition-colors inline-flex items-center gap-1"
            >
              Open Live Preview
              <svg
                className="w-3 h-3"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
                />
              </svg>
            </a>
          )}
          {sandboxExpired && (
            <span className="bg-bg/20 px-3 py-1 rounded-lg text-sm">
              Preview expired
            </span>
          )}
          {saved ? (
            <span className="bg-bg/20 px-3 py-1 rounded-lg text-sm">
              Saved
            </span>
          ) : (
            <button
              onClick={handleSave}
              disabled={saving}
              className="bg-bg/20 text-bg px-4 py-1 rounded-lg text-sm hover:bg-bg/30 transition-colors disabled:opacity-50"
            >
              {saving ? "Saving..." : "Save Project"}
            </button>
          )}
          {files.length > 0 && (
            <button
              onClick={handleDownloadZip}
              className="bg-bg text-accent px-4 py-1 rounded-lg text-sm hover:bg-bg/80 transition-colors inline-flex items-center gap-1"
            >
              Download ZIP
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
              </svg>
            </button>
          )}
        </div>
      )}

      {/* Mobile panel toggle */}
      <div className="lg:hidden flex border-b border-slate-800">
        {(["tasks", "log", "files"] as MobilePanel[]).map((panel) => (
          <button
            key={panel}
            onClick={() => setMobilePanel(panel)}
            className={`flex-1 py-3 text-sm font-mono transition-colors ${
              mobilePanel === panel
                ? "text-accent border-b-2 border-accent"
                : "text-slate-500"
            }`}
          >
            {panel === "tasks"
              ? `Tasks (${tasks.filter((t) => t.status === "done").length}/${tasks.length})`
              : panel === "log"
              ? "Log"
              : `Files (${files.length})`}
          </button>
        ))}
      </div>

      <div className="flex-1 flex flex-col lg:flex-row min-h-0">
        {/* Left: Task Queue */}
        <div
          className={`lg:w-[300px] flex-shrink-0 border-r border-slate-800 p-6 overflow-y-auto ${
            mobilePanel !== "tasks" ? "hidden lg:block" : ""
          }`}
        >
          <div className="flex items-center justify-between mb-1">
            <h2 className="font-syne font-700 text-lg">Tasks</h2>
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
          <p className="text-slate-500 text-xs mb-2 font-mono">
            {tasks.filter((t) => t.status === "done").length}/{tasks.length}{" "}
            completed
          </p>
          {costUsd > 0 && (
            <p className={`text-xs mb-4 font-mono ${budgetExceeded ? "text-red-400" : "text-slate-600"}`}>
              ${costUsd.toFixed(2)} / ${costLimit.toFixed(2)} limit
            </p>
          )}
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

          {/* Files list in sidebar */}
          {files.length > 0 && (
            <div className="mt-6 hidden lg:block">
              <h3 className="font-syne font-700 text-lg mb-2">Files</h3>
              <div className="space-y-1">
                {files.map((file) => (
                  <button
                    key={file.path}
                    onClick={() =>
                      setSelectedFile(
                        selectedFile === file.path ? null : file.path
                      )
                    }
                    className={`w-full text-left text-xs font-mono px-3 py-2 rounded-lg transition-colors truncate ${
                      selectedFile === file.path
                        ? "bg-accent/10 text-accent"
                        : "text-slate-400 hover:bg-surface hover:text-slate-200"
                    }`}
                  >
                    {file.path}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Center: Agent Log or File Preview */}
        <div
          className={`flex-1 flex flex-col min-h-0 ${
            mobilePanel !== "log" && mobilePanel !== "files"
              ? "hidden lg:flex"
              : mobilePanel === "files"
              ? "hidden lg:flex"
              : ""
          }`}
        >
          {activeFile ? (
            // File preview
            <div className="flex-1 flex flex-col min-h-0">
              <div className="p-6 pb-2 flex items-center justify-between">
                <div>
                  <h2 className="font-syne font-700 text-xl mb-1">
                    {activeFile.path}
                  </h2>
                  <p className="text-slate-500 text-xs font-mono">
                    File preview
                  </p>
                </div>
                <button
                  onClick={() => setSelectedFile(null)}
                  className="text-slate-500 hover:text-slate-300 text-xs font-mono transition-colors"
                >
                  Back to log
                </button>
              </div>
              <div className="flex-1 overflow-y-auto p-6 pt-2 log-scroll">
                <pre className="bg-surface rounded-xl p-4 text-sm font-mono text-slate-300 whitespace-pre-wrap overflow-x-auto">
                  {activeFile.content}
                </pre>
              </div>
            </div>
          ) : (
            // Agent log
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
                      Spinning up sandbox...
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
                          : entry.text.startsWith("$")
                          ? "text-yellow-400/80 pl-2"
                          : entry.text.startsWith("Created ")
                          ? "text-blue-400/80 pl-2"
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
                    <div className="flex items-center gap-2 ml-2 mt-1">
                      <span className="inline-block w-2 h-4 bg-accent/70 animate-pulse" />
                      {waiting && (
                        <span className="text-slate-500 text-xs animate-pulse">
                          Generating code&hellip;
                        </span>
                      )}
                    </div>
                  )}
                  <div ref={logEndRef} />
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Mobile files panel */}
        <div
          className={`flex-1 flex flex-col min-h-0 lg:hidden ${
            mobilePanel !== "files" ? "hidden" : ""
          }`}
        >
          <div className="p-6 pb-2">
            <h2 className="font-syne font-700 text-xl mb-1">
              Files ({files.length})
            </h2>
          </div>
          <div className="flex-1 overflow-y-auto p-6 pt-2">
            {files.length === 0 ? (
              <p className="text-slate-600 font-mono text-sm">
                No files created yet...
              </p>
            ) : (
              <div className="space-y-3">
                {files.map((file) => (
                  <div key={file.path} className="bg-surface rounded-xl p-4">
                    <p className="text-accent font-mono text-xs mb-2">
                      {file.path}
                    </p>
                    <pre className="text-slate-400 font-mono text-xs whitespace-pre-wrap max-h-40 overflow-y-auto">
                      {file.content.length > 500
                        ? file.content.slice(0, 500) + "\n..."
                        : file.content}
                    </pre>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Right panel: Edit Chat or Preview (desktop only) */}
        {complete && sandboxId && !activeFile && !sandboxExpired && (
          <div className="hidden lg:flex lg:w-[380px] flex-shrink-0 border-l border-slate-800 flex-col">
            {showEdit ? (
              <EditChat
                sandboxId={sandboxId}
                files={files}
                previewUrl={previewUrl}
                onFileUpdate={(path, content) => {
                  setFiles((prev) => [
                    ...prev.filter((f) => f.path !== path),
                    { path, content },
                  ]);
                }}
                onPreviewRefresh={() => setIframeKey((k) => k + 1)}
                onSandboxExpired={() => setSandboxExpired(true)}
              />
            ) : (
              <>
                <div className="p-4 border-b border-slate-800 flex items-center justify-between">
                  <div>
                    <h3 className="font-syne font-700 text-sm">
                      Live Preview
                    </h3>
                    <p className="text-slate-500 text-xs font-mono truncate max-w-[200px]">
                      {previewUrl || "No preview available"}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setShowEdit(true)}
                      className="text-accent text-xs font-mono hover:underline"
                    >
                      Edit
                    </button>
                    {previewUrl && (
                      <a
                        href={previewUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-slate-400 text-xs font-mono hover:text-slate-200"
                      >
                        Open
                      </a>
                    )}
                  </div>
                </div>
                {previewUrl ? (
                  <div className="flex-1 bg-white">
                    <iframe
                      key={iframeKey}
                      src={previewUrl}
                      title="Project Preview"
                      className="w-full h-full border-0"
                      sandbox="allow-scripts allow-same-origin allow-forms"
                    />
                  </div>
                ) : (
                  <div className="flex-1 flex items-center justify-center">
                    <p className="text-slate-600 font-mono text-sm">
                      Preview will appear here
                    </p>
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {/* Preview iframe during build (before completion) */}
        {!complete && previewUrl && !activeFile && (
          <div className="hidden lg:flex lg:w-[380px] flex-shrink-0 border-l border-slate-800 flex-col">
            <div className="p-4 border-b border-slate-800">
              <h3 className="font-syne font-700 text-sm">Live Preview</h3>
              <p className="text-slate-500 text-xs font-mono truncate">
                {previewUrl}
              </p>
            </div>
            <div className="flex-1 bg-white">
              <iframe
                key={iframeKey}
                src={previewUrl}
                title="Project Preview"
                className="w-full h-full border-0"
                sandbox="allow-scripts allow-same-origin allow-forms"
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
