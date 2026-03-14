"use client";

import { useState, useEffect } from "react";
import type { PlanTask } from "@/lib/types";

export default function Planning({
  tasks,
  onBuild,
  onBack,
}: {
  tasks: PlanTask[];
  onBuild: () => void;
  onBack: () => void;
}) {
  const [visible, setVisible] = useState(0);
  const allVisible = visible >= tasks.length;

  useEffect(() => {
    if (visible < tasks.length) {
      const t = setTimeout(() => setVisible((v) => v + 1), 200);
      return () => clearTimeout(t);
    }
  }, [visible, tasks.length]);

  const totalTime = tasks.reduce((sum, t) => sum + t.estimated_seconds, 0);

  return (
    <div className="flex flex-col items-center justify-center min-h-screen px-6">
      <div className="w-full max-w-2xl">
        <button
          onClick={onBack}
          className="text-slate-500 hover:text-slate-300 text-sm mb-8 transition-colors"
        >
          &larr; Back to edit
        </button>
        <h2 className="font-syne font-700 text-3xl sm:text-4xl mb-2">
          Your Build Plan
        </h2>
        <p className="text-slate-400 mb-8">
          {allVisible
            ? `${tasks.length} tasks \u00b7 ~${totalTime}s estimated`
            : "Breaking your idea into tasks..."}
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

        {allVisible && (
          <button
            onClick={onBuild}
            className="mt-8 w-full bg-accent text-bg font-syne font-700 text-lg py-4 rounded-xl hover:brightness-110 transition-all animate-fade-in-up"
          >
            Start Build
          </button>
        )}
      </div>
    </div>
  );
}
