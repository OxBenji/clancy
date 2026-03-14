"use client";

import { useState, useRef, useEffect } from "react";
import type { ChatMessage } from "@/lib/types";

export default function CodingChat({ onBack }: { onBack: () => void }) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
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
    const updatedMessages = [...messages, userMsg];
    setMessages(updatedMessages);
    setInput("");
    setLoading(true);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: updatedMessages.map((m) => ({
            role: m.role,
            content: m.content,
          })),
        }),
      });

      if (!res.body) throw new Error("No response");

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let fullText = "";

      // Add placeholder assistant message
      const assistantMsg: ChatMessage = {
        role: "assistant",
        content: "",
        ts: Date.now(),
      };
      setMessages((prev) => [...prev, assistantMsg]);

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
            if (event === "text" && parsed.text) {
              fullText += parsed.text;
              setMessages((prev) => {
                const updated = [...prev];
                updated[updated.length - 1] = {
                  ...updated[updated.length - 1],
                  content: fullText,
                };
                return updated;
              });
            }
          } catch {
            // skip
          }
        }
      }
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
    <div className="flex flex-col min-h-screen">
      {/* Header */}
      <div className="border-b border-slate-800 px-6 py-4 flex items-center justify-between">
        <div>
          <div className="flex items-center gap-3">
            <p className="text-accent font-mono text-sm tracking-widest uppercase">
              Clancy
            </p>
            <span className="text-slate-600 font-mono text-xs">
              coding assistant
            </span>
          </div>
        </div>
        <button
          onClick={onBack}
          className="text-slate-500 hover:text-slate-300 text-sm font-mono transition-colors"
        >
          &larr; Home
        </button>
      </div>

      {/* Chat area */}
      <div className="flex-1 overflow-y-auto px-6 py-6 log-scroll">
        <div className="max-w-3xl mx-auto space-y-4">
          {messages.length === 0 && (
            <div className="text-center py-20">
              <h2 className="font-syne font-700 text-2xl mb-3">
                Ask me anything about code
              </h2>
              <p className="text-slate-400 mb-8 max-w-md mx-auto">
                I can help with HTML, CSS, JavaScript, React, Python, debugging,
                and more. No question is too basic.
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-w-lg mx-auto">
                {[
                  "How do I center a div?",
                  "Explain async/await",
                  "Help me build a todo app",
                  "What is an API?",
                ].map((q) => (
                  <button
                    key={q}
                    onClick={() => setInput(q)}
                    className="bg-surface rounded-xl p-3 text-left text-sm text-slate-400 font-mono hover:text-accent hover:border-accent/30 border border-transparent transition-all"
                  >
                    {q}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((msg, i) => (
            <div
              key={i}
              className={`${
                msg.role === "user" ? "flex justify-end" : "flex justify-start"
              }`}
            >
              <div
                className={`rounded-xl p-4 max-w-[85%] ${
                  msg.role === "user"
                    ? "bg-accent/10 text-accent"
                    : "bg-surface text-slate-300"
                }`}
              >
                <pre className="whitespace-pre-wrap font-mono text-sm leading-relaxed">
                  {msg.content || (loading ? "" : "...")}
                </pre>
              </div>
            </div>
          ))}

          {loading && messages[messages.length - 1]?.role === "user" && (
            <div className="flex justify-start">
              <div className="bg-surface rounded-xl p-4">
                <span className="flex items-center gap-2 text-slate-400 text-sm">
                  <span className="w-3 h-3 border-2 border-accent border-t-transparent rounded-full animate-spin" />
                  Thinking...
                </span>
              </div>
            </div>
          )}

          <div ref={scrollRef} />
        </div>
      </div>

      {/* Input */}
      <div className="border-t border-slate-800 px-6 py-4">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleSend();
          }}
          className="max-w-3xl mx-auto flex gap-3"
        >
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask me anything about coding..."
            disabled={loading}
            autoFocus
            className="flex-1 bg-surface border border-slate-700 rounded-xl px-4 py-3 text-slate-200 placeholder-slate-600 focus:outline-none focus:border-accent font-mono text-sm disabled:opacity-50"
          />
          <button
            type="submit"
            disabled={loading || !input.trim()}
            className="bg-accent text-bg font-syne font-700 px-6 py-3 rounded-xl text-sm hover:brightness-110 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Send
          </button>
        </form>
      </div>
    </div>
  );
}
