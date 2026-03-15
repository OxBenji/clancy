"use client";

import { SECTIONS, type Section } from "@/lib/sections";

export default function SectionPicker({
  selected,
  onToggle,
}: {
  selected: string[];
  onToggle: (id: string) => void;
}) {
  return (
    <div className="bg-surface rounded-xl border border-slate-800 p-4">
      <p className="text-slate-400 text-xs font-mono mb-3">
        Pick sections to include ({selected.length} selected)
      </p>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
        {SECTIONS.map((s: Section) => {
          const active = selected.includes(s.id);
          return (
            <button
              key={s.id}
              onClick={() => onToggle(s.id)}
              className={`text-left text-xs font-mono px-3 py-2 rounded-lg border transition-all ${
                active
                  ? "border-accent text-accent bg-accent/10"
                  : "border-slate-700 text-slate-400 hover:border-slate-500"
              }`}
            >
              <span className="block font-syne font-700 text-sm mb-0.5">
                {s.name}
              </span>
              <span className="text-slate-500 text-[10px] leading-tight block">
                {s.description}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
