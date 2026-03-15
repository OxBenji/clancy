"use client";

import { useState } from "react";
import { THEMES, type Theme } from "@/lib/themes";

export default function ThemeMarketplace({
  onSelect,
  onBack,
}: {
  onSelect: (theme: Theme) => void;
  onBack: () => void;
}) {
  const [filter, setFilter] = useState("");
  const [selectedTag, setSelectedTag] = useState<string | null>(null);

  const allTags = Array.from(new Set(THEMES.flatMap((t) => t.tags)));

  const filtered = THEMES.filter((t) => {
    const matchesSearch =
      !filter ||
      t.name.toLowerCase().includes(filter.toLowerCase()) ||
      t.description.toLowerCase().includes(filter.toLowerCase());
    const matchesTag = !selectedTag || t.tags.includes(selectedTag);
    return matchesSearch && matchesTag;
  });

  return (
    <div className="flex flex-col items-center min-h-screen px-6 py-12">
      <div className="w-full max-w-4xl">
        <button
          onClick={onBack}
          className="text-slate-500 hover:text-slate-300 text-sm mb-8 transition-colors"
        >
          &larr; Back
        </button>

        <h2 className="font-syne font-700 text-3xl sm:text-4xl mb-2 text-center">
          Theme Marketplace
        </h2>
        <p className="text-slate-400 mb-8 text-center">
          Community-designed themes ready to use
        </p>

        {/* Search */}
        <div className="mb-6">
          <input
            type="text"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Search themes..."
            className="w-full bg-surface border border-slate-700 rounded-xl px-4 py-3 text-sm text-slate-200 placeholder-slate-600 focus:outline-none focus:border-accent font-mono"
          />
        </div>

        {/* Tags */}
        <div className="flex flex-wrap gap-2 mb-8">
          <button
            onClick={() => setSelectedTag(null)}
            className={`text-xs font-mono px-3 py-1 rounded-full border transition-all ${
              !selectedTag
                ? "border-accent text-accent bg-accent/10"
                : "border-slate-700 text-slate-400 hover:border-slate-500"
            }`}
          >
            All
          </button>
          {allTags.map((tag) => (
            <button
              key={tag}
              onClick={() =>
                setSelectedTag(selectedTag === tag ? null : tag)
              }
              className={`text-xs font-mono px-3 py-1 rounded-full border transition-all ${
                selectedTag === tag
                  ? "border-accent text-accent bg-accent/10"
                  : "border-slate-700 text-slate-400 hover:border-slate-500"
              }`}
            >
              {tag}
            </button>
          ))}
        </div>

        {/* Theme grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {filtered.map((theme) => (
            <button
              key={theme.id}
              onClick={() => onSelect(theme)}
              className="bg-surface rounded-xl p-5 text-left hover:border-accent/40 border border-transparent transition-all group"
            >
              <div className="flex items-center justify-between mb-2">
                <h3 className="font-syne font-700 text-accent text-lg group-hover:brightness-110">
                  {theme.name}
                </h3>
                <span className="text-slate-600 text-xs font-mono">
                  by {theme.author}
                </span>
              </div>
              <p className="text-slate-400 text-sm leading-relaxed mb-3">
                {theme.description}
              </p>
              <div className="flex flex-wrap gap-1">
                {theme.tags.map((tag) => (
                  <span
                    key={tag}
                    className="text-[10px] font-mono text-slate-500 bg-slate-800 px-2 py-0.5 rounded"
                  >
                    {tag}
                  </span>
                ))}
              </div>
            </button>
          ))}
        </div>

        {filtered.length === 0 && (
          <p className="text-center text-slate-500 font-mono text-sm py-12">
            No themes match your search.
          </p>
        )}
      </div>
    </div>
  );
}
