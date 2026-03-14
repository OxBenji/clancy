"use client";

import { useState } from "react";
import type { PlanTask } from "@/lib/types";

function uid(): string {
  return crypto.randomUUID();
}

export default function Create({
  onPlan,
  onBack,
}: {
  onPlan: (description: string, tasks: PlanTask[]) => void;
  onBack: () => void;
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

      let data: { tasks?: { label: string; estimated_seconds: number; order_index: number }[]; error?: string };
      try {
        data = await res.json();
      } catch {
        throw new Error("Invalid response from server");
      }

      if (!res.ok) {
        throw new Error(data.error || "Failed to generate plan");
      }

      if (!Array.isArray(data.tasks)) {
        throw new Error("Invalid plan format received");
      }

      const tasks: PlanTask[] = data.tasks.map(
        (t) => ({
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
          onClick={onBack}
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
