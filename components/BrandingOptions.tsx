"use client";

import { useState } from "react";

export interface BrandingConfig {
  brandName: string;
  primaryColor: string;
  style: string;
  styleNotes: string;
}

const COLOR_PRESETS = [
  { name: "Blue", value: "#3B82F6" },
  { name: "Green", value: "#10B981" },
  { name: "Purple", value: "#8B5CF6" },
  { name: "Red", value: "#EF4444" },
  { name: "Orange", value: "#F59E0B" },
  { name: "Pink", value: "#EC4899" },
  { name: "Teal", value: "#14B8A6" },
  { name: "Slate", value: "#64748B" },
];

const STYLE_PRESETS = [
  { name: "Modern & Clean", value: "modern clean minimalist" },
  { name: "Bold & Playful", value: "bold playful colorful rounded" },
  { name: "Dark & Sleek", value: "dark sleek professional" },
  { name: "Warm & Friendly", value: "warm friendly approachable soft" },
];

export default function BrandingOptions({
  branding,
  onChange,
}: {
  branding: BrandingConfig;
  onChange: (b: BrandingConfig) => void;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="bg-surface rounded-xl border border-slate-800 overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between p-4 text-left hover:bg-slate-800/30 transition-colors"
      >
        <div className="flex items-center gap-2">
          <span className="text-slate-400 text-sm font-mono">Customize style</span>
          {branding.brandName && (
            <span className="text-accent text-xs bg-accent/10 px-2 py-0.5 rounded">
              {branding.brandName}
            </span>
          )}
          {branding.primaryColor && (
            <span
              className="w-3 h-3 rounded-full border border-slate-600"
              style={{ backgroundColor: branding.primaryColor }}
            />
          )}
        </div>
        <span className="text-slate-500 text-xs">{expanded ? "\u25B2" : "\u25BC"}</span>
      </button>

      {expanded && (
        <div className="p-4 pt-0 space-y-4">
          {/* Brand name */}
          <div>
            <label className="text-slate-400 text-xs font-mono block mb-1">
              Brand / Business name (optional)
            </label>
            <input
              type="text"
              value={branding.brandName}
              onChange={(e) =>
                onChange({ ...branding, brandName: e.target.value })
              }
              placeholder="e.g. Acme Corp"
              maxLength={50}
              className="w-full bg-bg border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200 placeholder-slate-600 focus:outline-none focus:border-accent font-mono"
            />
          </div>

          {/* Color */}
          <div>
            <label className="text-slate-400 text-xs font-mono block mb-2">
              Accent color
            </label>
            <div className="flex flex-wrap gap-2">
              {COLOR_PRESETS.map((c) => (
                <button
                  key={c.value}
                  onClick={() =>
                    onChange({ ...branding, primaryColor: c.value })
                  }
                  className={`w-8 h-8 rounded-lg border-2 transition-all ${
                    branding.primaryColor === c.value
                      ? "border-white scale-110"
                      : "border-transparent hover:border-slate-500"
                  }`}
                  style={{ backgroundColor: c.value }}
                  title={c.name}
                />
              ))}
              <input
                type="color"
                value={branding.primaryColor || "#3B82F6"}
                onChange={(e) =>
                  onChange({ ...branding, primaryColor: e.target.value })
                }
                className="w-8 h-8 rounded-lg cursor-pointer bg-transparent border border-slate-600"
                title="Custom color"
              />
            </div>
          </div>

          {/* Style preset */}
          <div>
            <label className="text-slate-400 text-xs font-mono block mb-2">
              Design style
            </label>
            <div className="grid grid-cols-2 gap-2">
              {STYLE_PRESETS.map((s) => (
                <button
                  key={s.value}
                  onClick={() =>
                    onChange({ ...branding, style: s.value })
                  }
                  className={`text-left text-xs font-mono px-3 py-2 rounded-lg border transition-all ${
                    branding.style === s.value
                      ? "border-accent text-accent bg-accent/10"
                      : "border-slate-700 text-slate-400 hover:border-slate-500"
                  }`}
                >
                  {s.name}
                </button>
              ))}
            </div>
          </div>

          {/* Style notes */}
          <div>
            <label className="text-slate-400 text-xs font-mono block mb-1">
              Style notes (optional)
            </label>
            <textarea
              value={branding.styleNotes}
              onChange={(e) =>
                onChange({ ...branding, styleNotes: e.target.value })
              }
              placeholder="e.g. Make it minimal and dark, use large typography, no stock photos..."
              maxLength={300}
              rows={2}
              className="w-full bg-bg border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200 placeholder-slate-600 focus:outline-none focus:border-accent font-mono resize-none"
            />
          </div>
        </div>
      )}
    </div>
  );
}
