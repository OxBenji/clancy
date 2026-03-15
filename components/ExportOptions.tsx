"use client";

import { useState } from "react";
import JSZip from "jszip";
import type { FileEntry } from "@/lib/types";

type ExportFormat = "zip" | "html-single";

export default function ExportOptions({
  files,
  description,
  previewUrl,
}: {
  files: FileEntry[];
  description: string;
  previewUrl: string | null;
}) {
  const [exporting, setExporting] = useState(false);

  async function handleExport(format: ExportFormat) {
    setExporting(true);
    try {
      if (format === "zip") {
        await downloadZip(files, description);
      } else if (format === "html-single") {
        await downloadSingleHtml(files, description);
      }
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="space-y-3">
      <h3 className="font-syne font-700 text-sm">Export Project</h3>

      {/* Download ZIP */}
      <button
        onClick={() => handleExport("zip")}
        disabled={exporting || files.length === 0}
        className="w-full flex items-center gap-3 bg-surface rounded-xl p-4 text-left hover:border-accent/40 border border-transparent transition-all disabled:opacity-50"
      >
        <span className="text-2xl">📦</span>
        <div>
          <p className="text-slate-200 text-sm font-syne font-700">
            Download ZIP
          </p>
          <p className="text-slate-500 text-xs">
            All project files in a zip archive
          </p>
        </div>
      </button>

      {/* Single HTML */}
      <button
        onClick={() => handleExport("html-single")}
        disabled={exporting || files.length === 0}
        className="w-full flex items-center gap-3 bg-surface rounded-xl p-4 text-left hover:border-accent/40 border border-transparent transition-all disabled:opacity-50"
      >
        <span className="text-2xl">📄</span>
        <div>
          <p className="text-slate-200 text-sm font-syne font-700">
            Single HTML File
          </p>
          <p className="text-slate-500 text-xs">
            CSS and JS inlined into one HTML file
          </p>
        </div>
      </button>

      {/* Deploy instructions */}
      <div className="bg-surface rounded-xl p-4 border border-slate-800">
        <p className="text-slate-200 text-sm font-syne font-700 mb-2">
          Deploy Your Site
        </p>
        <div className="space-y-2 text-xs font-mono text-slate-400">
          <p>
            <span className="text-accent">Netlify:</span> Drag & drop the ZIP
            to{" "}
            <span className="text-slate-300">app.netlify.com/drop</span>
          </p>
          <p>
            <span className="text-accent">Vercel:</span> Run{" "}
            <code className="bg-slate-800 px-1 rounded">
              npx vercel --prod
            </code>{" "}
            in the project folder
          </p>
          <p>
            <span className="text-accent">GitHub Pages:</span> Push to a repo
            and enable Pages in settings
          </p>
        </div>
      </div>

      {/* Preview link */}
      {previewUrl && (
        <a
          href={previewUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="block w-full text-center bg-accent/10 text-accent rounded-xl p-3 text-sm font-mono hover:bg-accent/20 transition-colors"
        >
          Open Live Preview
        </a>
      )}
    </div>
  );
}

async function downloadZip(files: FileEntry[], description: string) {
  const zip = new JSZip();
  for (const file of files) {
    const cleanPath = file.path.replace(/^\/home\/user\/project\//, "");
    zip.file(cleanPath, file.content);
  }
  const blob = await zip.generateAsync({ type: "blob" });
  downloadBlob(blob, `${slugify(description)}-project.zip`);
}

async function downloadSingleHtml(files: FileEntry[], description: string) {
  // Find the main HTML file
  const htmlFile = files.find(
    (f) => f.path.endsWith("index.html") || f.path.endsWith(".html")
  );
  if (!htmlFile) return;

  let html = htmlFile.content;

  // Inline CSS files
  const cssFiles = files.filter((f) => f.path.endsWith(".css"));
  for (const css of cssFiles) {
    const filename = css.path.split("/").pop() || "";
    // Replace <link> tags referencing this CSS with inline <style>
    const linkRegex = new RegExp(
      `<link[^>]*href=["'](?:\\./)?${escapeRegex(filename)}["'][^>]*/?>`,
      "gi"
    );
    html = html.replace(linkRegex, `<style>\n${css.content}\n</style>`);
  }

  // Inline JS files
  const jsFiles = files.filter((f) => f.path.endsWith(".js"));
  for (const js of jsFiles) {
    const filename = js.path.split("/").pop() || "";
    const scriptRegex = new RegExp(
      `<script[^>]*src=["'](?:\\./)?${escapeRegex(filename)}["'][^>]*>\\s*</script>`,
      "gi"
    );
    html = html.replace(
      scriptRegex,
      `<script>\n${js.content}\n</script>`
    );
  }

  const blob = new Blob([html], { type: "text/html" });
  downloadBlob(blob, `${slugify(description)}-site.html`);
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function slugify(s: string): string {
  return s
    .slice(0, 30)
    .replace(/[^a-zA-Z0-9]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
