"use client";

import { TEMPLATES, type Template } from "@/lib/templates";

export default function TemplateGrid({
  onSelect,
  onCustom,
}: {
  onSelect: (template: Template) => void;
  onCustom: () => void;
}) {
  return (
    <div className="flex flex-col items-center justify-center min-h-screen px-6 py-12">
      <div className="w-full max-w-4xl">
        <h2 className="font-syne font-700 text-3xl sm:text-4xl mb-2 text-center">
          What are you building?
        </h2>
        <p className="text-slate-400 mb-10 text-center">
          Pick a template to start fast, or describe your own project.
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-8">
          {TEMPLATES.map((t) => (
            <button
              key={t.id}
              onClick={() => onSelect(t)}
              className="bg-surface rounded-xl p-5 text-left hover:border-accent/40 border border-transparent transition-all group"
            >
              <h3 className="font-syne font-700 text-accent text-lg mb-1 group-hover:brightness-110">
                {t.name}
              </h3>
              <p className="text-slate-400 text-sm leading-relaxed">
                {t.description}
              </p>
            </button>
          ))}
        </div>

        <div className="text-center">
          <button
            onClick={onCustom}
            className="bg-accent text-bg font-syne font-700 text-lg px-8 py-4 rounded-xl hover:brightness-110 transition-all"
          >
            Describe My Own Project
          </button>
          <p className="text-slate-600 font-mono text-xs mt-3">
            or type anything in plain English
          </p>
        </div>
      </div>
    </div>
  );
}
