"use client";

import { useState, useRef, useEffect } from "react";
import type { ChatMessage, FileEntry } from "@/lib/types";

export default function EditChat({
  sandboxId,
  files,
  onFileUpdate,
  onPreviewRefresh,
  onSandboxExpired,
}: {
  sandboxId: string;
  files: FileEntry[];
  previewUrl?: string | null;
  onFileUpdate: (path: string, content: string) => void;
  onPreviewRefresh: () => void;
  onSandboxExpired?: () => void;
}) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [sandboxExpired, setSandboxExpired] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages]);

  async function handleSend() {
    if (!input.trim() || loading) return;

    const userMsg: ChatMessage = {
      role: "user",
      content: input.trim(),
      ts: Date.now(),
    };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setLoading(true);

    try {
      const res = await fetch("/api/edit-project", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sandbox_id: sandboxId,
          message: userMsg.content,
          context: files.slice(0, 10).map((f) => ({
            path: f.path,
            content: f.content,
          })),
        }),
      });

      if (!res.body) throw new Error("No response");

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      const logLines: string[] = [];

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
            if (event === "agent_log" && parsed.log) {
              logLines.push(parsed.log);
            } else if (event === "file_updated") {
              onFileUpdate(parsed.path, parsed.content);
            } else if (event === "preview_refresh") {
              onPreviewRefresh();
            } else if (event === "edit_complete") {
              logLines.push(`Done: ${parsed.summary}`);
            } else if (event === "sandbox_expired") {
              setSandboxExpired(true);
              onSandboxExpired?.();
              logLines.push(parsed.error || "Sandbox has expired.");
            } else if (event === "edit_error") {
              logLines.push(`Error: ${parsed.error}`);
            }
          } catch {
            // skip
          }
        }
      }

      const assistantMsg: ChatMessage = {
        role: "assistant",
        content: logLines.join("\n") || "Changes applied!",
        ts: Date.now(),
      };
      setMessages((prev) => [...prev, assistantMsg]);
    } catch (err) {
      const errMsg: ChatMessage = {
        role: "assistant",
        content: `Error: ${err instanceof Error ? err.message : "Something went wrong"}`,
        ts: Date.now(),
      };
      setMessages((prev) => [...prev, errMsg]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col h-full">
      <div className="p-4 border-b border-slate-800">
        <h3 className="font-syne font-700 text-sm">Edit Project</h3>
        <p className="text-slate-500 text-xs font-mono">
          Tell Clancy what to change
        </p>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3 log-scroll">
        {messages.length === 0 && (
          <div className="text-center py-8">
            <p className="text-slate-500 text-sm mb-3">
              Your project is built! Now you can iterate.
            </p>
            <div className="space-y-2">
              {[
                "Make the header bigger",
                "Change colors to blue theme",
                "Add a contact form",
                "Make it mobile-friendly",
              ].map((suggestion) => (
                <button
                  key={suggestion}
                  onClick={() => setInput(suggestion)}
                  className="block w-full text-left text-xs font-mono text-slate-400 bg-surface rounded-lg px-3 py-2 hover:text-accent transition-colors"
                >
                  &ldquo;{suggestion}&rdquo;
                </button>
              ))}
            </div>
          </div>
        )}
        {messages.map((msg, i) => (
          <div
            key={i}
            className={`rounded-lg p-3 text-sm ${
              msg.role === "user"
                ? "bg-accent/10 text-accent ml-8"
                : "bg-surface text-slate-300 mr-8"
            }`}
          >
            <pre className="whitespace-pre-wrap font-mono text-xs">
              {msg.content}
            </pre>
          </div>
        ))}
        {loading && (
          <div className="bg-surface rounded-lg p-3 mr-8">
            <span className="flex items-center gap-2 text-slate-400 text-sm">
              <span className="w-3 h-3 border-2 border-accent border-t-transparent rounded-full animate-spin" />
              Applying changes...
            </span>
          </div>
        )}
        <div ref={scrollRef} />
      </div>

      {/* Input */}
      <div className="p-4 border-t border-slate-800">
        {sandboxExpired ? (
          <div className="text-center py-2">
            <p className="text-red-400 text-xs font-mono mb-2">
              Sandbox expired — edits are no longer available.
            </p>
            <p className="text-slate-500 text-xs font-mono">
              Rebuild the project to make further changes.
            </p>
          </div>
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleSend();
            }}
            className="flex gap-2"
          >
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Change the background to dark blue..."
              disabled={loading}
              className="flex-1 bg-surface border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200 placeholder-slate-600 focus:outline-none focus:border-accent font-mono disabled:opacity-50"
            />
            <button
              type="submit"
              disabled={loading || !input.trim()}
              className="bg-accent text-bg font-syne font-700 px-4 py-2 rounded-lg text-sm hover:brightness-110 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Send
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
