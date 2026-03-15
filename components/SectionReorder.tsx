"use client";

import { useState, useCallback } from "react";

interface DetectedSection {
  id: string;
  name: string;
  tag: string;
}

export default function SectionReorder({
  files,
  onReorder,
  loading,
}: {
  files: { path: string; content: string }[];
  onReorder: (instruction: string) => void;
  loading: boolean;
}) {
  const [sections, setSections] = useState<DetectedSection[]>(() =>
    detectSections(files)
  );
  const [dragIdx, setDragIdx] = useState<number | null>(null);

  function handleDragStart(idx: number) {
    setDragIdx(idx);
  }

  function handleDragOver(e: React.DragEvent, idx: number) {
    e.preventDefault();
    if (dragIdx === null || dragIdx === idx) return;

    setSections((prev) => {
      const next = [...prev];
      const [moved] = next.splice(dragIdx, 1);
      next.splice(idx, 0, moved);
      return next;
    });
    setDragIdx(idx);
  }

  function handleDragEnd() {
    setDragIdx(null);
  }

  const handleApply = useCallback(() => {
    const order = sections.map((s) => s.name).join(", ");
    onReorder(
      `Reorder the page sections in this exact order from top to bottom: ${order}. Move the HTML sections to match this order. Keep all content intact.`
    );
  }, [sections, onReorder]);

  // Touch-based reorder
  function moveUp(idx: number) {
    if (idx === 0) return;
    setSections((prev) => {
      const next = [...prev];
      [next[idx - 1], next[idx]] = [next[idx], next[idx - 1]];
      return next;
    });
  }

  function moveDown(idx: number) {
    if (idx === sections.length - 1) return;
    setSections((prev) => {
      const next = [...prev];
      [next[idx], next[idx + 1]] = [next[idx + 1], next[idx]];
      return next;
    });
  }

  if (sections.length === 0) {
    return (
      <div className="p-4 text-center">
        <p className="text-slate-500 text-sm font-mono">
          No sections detected to reorder.
        </p>
      </div>
    );
  }

  return (
    <div className="p-4">
      <h3 className="font-syne font-700 text-sm mb-1">Reorder Sections</h3>
      <p className="text-slate-500 text-xs font-mono mb-3">
        Drag to reorder, then apply
      </p>

      <div className="space-y-1">
        {sections.map((section, idx) => (
          <div
            key={section.id}
            draggable
            onDragStart={() => handleDragStart(idx)}
            onDragOver={(e) => handleDragOver(e, idx)}
            onDragEnd={handleDragEnd}
            className={`flex items-center gap-2 bg-surface rounded-lg px-3 py-2 cursor-grab active:cursor-grabbing transition-all ${
              dragIdx === idx ? "opacity-50 scale-95" : ""
            }`}
          >
            <span className="text-slate-600 text-xs select-none">::</span>
            <span className="flex-1 text-sm text-slate-300 font-mono truncate">
              {section.name}
            </span>
            <span className="text-slate-600 text-[10px] font-mono">
              &lt;{section.tag}&gt;
            </span>
            <div className="flex gap-1">
              <button
                onClick={() => moveUp(idx)}
                disabled={idx === 0}
                className="text-slate-500 hover:text-slate-300 text-xs disabled:opacity-30"
              >
                &uarr;
              </button>
              <button
                onClick={() => moveDown(idx)}
                disabled={idx === sections.length - 1}
                className="text-slate-500 hover:text-slate-300 text-xs disabled:opacity-30"
              >
                &darr;
              </button>
            </div>
          </div>
        ))}
      </div>

      <button
        onClick={handleApply}
        disabled={loading}
        className="mt-3 w-full bg-accent text-bg font-syne font-700 text-sm py-2 rounded-lg hover:brightness-110 transition-all disabled:opacity-50"
      >
        {loading ? "Applying..." : "Apply New Order"}
      </button>
    </div>
  );
}

/** Detect sections from HTML files by looking for semantic tags and common patterns */
function detectSections(
  files: { path: string; content: string }[]
): DetectedSection[] {
  const htmlFile = files.find(
    (f) => f.path.endsWith(".html") || f.path.endsWith("index.html")
  );
  if (!htmlFile) return [];

  const content = htmlFile.content;
  const sections: DetectedSection[] = [];

  // Track seen to avoid duplicates
  const seen = new Set<string>();
  let counter = 0;

  // Semantic tags
  const semanticRegex =
    /<(section|header|footer|nav|main|aside)\b[^>]*?(?:id="([^"]*)")?[^>]*?(?:class="([^"]*)")?[^>]*>/gi;
  let match;
  while ((match = semanticRegex.exec(content)) !== null) {
    const tag = match[1].toLowerCase();
    const id = match[2] || "";
    const cls = match[3] || "";
    const name = id || inferName(cls) || tag;
    const key = `${tag}-${name}-${counter++}`;
    if (!seen.has(name)) {
      seen.add(name);
      sections.push({ id: key, name: capitalize(name), tag });
    }
  }

  // Divs with IDs (fallback if no semantic tags found)
  if (sections.length < 2) {
    const divRegex = /<div\b[^>]*id="([^"]*)"[^>]*>/gi;
    while ((match = divRegex.exec(content)) !== null) {
      const id = match[1];
      if (!seen.has(id) && !id.startsWith("__")) {
        seen.add(id);
        sections.push({
          id: `div-${id}-${counter++}`,
          name: capitalize(id),
          tag: "div",
        });
      }
    }
  }

  return sections;
}

function inferName(className: string): string {
  // Try to find a meaningful class name
  const names = className.split(/\s+/);
  const meaningful = names.find(
    (n) =>
      !n.startsWith("flex") &&
      !n.startsWith("grid") &&
      !n.startsWith("bg-") &&
      !n.startsWith("p-") &&
      !n.startsWith("m-") &&
      !n.startsWith("w-") &&
      !n.startsWith("h-") &&
      n.length > 2
  );
  return meaningful || "";
}

function capitalize(s: string): string {
  return s
    .replace(/[-_]/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}
