"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { supabase } from "@/lib/supabase";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface PlanTask {
  id: string;
  label: string;
  estimated_seconds: number;
  order_index: number;
  status: "pending" | "active" | "done" | "error";
  duration?: number;
  success_criteria?: string[];
}

interface LogEntry {
  task_id: string;
  text: string;
  ts: number;
}

type View = "landing" | "create" | "planning" | "building";
type Lang = "en" | "es";

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function uid(): string {
  return crypto.randomUUID();
}

/* ------------------------------------------------------------------ */
/*  i18n                                                               */
/* ------------------------------------------------------------------ */

const t = {
  en: {
    headline: "Describe\u00a0it. Watch\u00a0it\u00a0build. Get\u00a0a\u00a0live\u00a0link.",
    subtext:
      "Tell Clancy what you want. An autonomous AI agent breaks it into tasks, executes them one by one, and ships a working project \u2014 while you watch every step in real time.",
    startButton: "Start Building",
    betaLine: "Free during beta \u00b7 No credit card \u00b7 Built by @BenjiShips",
    features: [
      { title: "Describe", desc: "Type what you want in plain English. No PRD. No technical knowledge needed." },
      { title: "Plan", desc: "Clancy breaks it into 5\u201310 concrete tasks in seconds. You see the full plan before it starts." },
      { title: "Ship", desc: "The agent executes every task live. You watch. You get a real deployed URL." },
    ],
    back: "\u2190 Back",
    createHeading: "What do you want to build?",
    createSubtext: "Describe your project in plain English. Be as specific as you can.",
    createPlaceholder: "e.g. A habit tracker app with daily streaks, a calendar heatmap, and push notification reminders...",
    generateButton: "Generate Plan",
    generating: "Generating plan...",
    minCharsError: "Please describe your project in at least 10 characters.",
    planHeading: "Your Build Plan",
    planBreaking: "Breaking your idea into tasks...",
    planStarting: "Starting build...",
    projectReady: "Your project is ready.",
    savedToProjects: "Saved to your projects",
    saving: "Saving...",
    saveProject: "Save Your Project",
    taskQueue: "Task Queue",
    completed: "completed",
    agentLog: "Agent Log",
    liveOutput: "Live output from the build agent",
  },
  es: {
    headline: "Descr\u00edbelo. M\u00edralo construirse. Obt\u00e9n un enlace en vivo.",
    subtext:
      "Dile a Clancy lo que quieres. Un agente de IA aut\u00f3nomo lo divide en tareas, las ejecuta una por una y entrega un proyecto funcional \u2014 mientras observas cada paso en tiempo real.",
    startButton: "Empezar a Construir",
    betaLine: "Gratis durante la beta \u00b7 Sin tarjeta de cr\u00e9dito \u00b7 Creado por @BenjiShips",
    features: [
      { title: "Describe", desc: "Escribe lo que quieres en espa\u00f1ol sencillo. Sin PRD. Sin conocimientos t\u00e9cnicos." },
      { title: "Planifica", desc: "Clancy lo divide en 5\u201310 tareas concretas en segundos. Ves el plan completo antes de que comience." },
      { title: "Env\u00eda", desc: "El agente ejecuta cada tarea en vivo. T\u00fa observas. Obtienes una URL real desplegada." },
    ],
    back: "\u2190 Volver",
    createHeading: "\u00bfQu\u00e9 quieres construir?",
    createSubtext: "Describe tu proyecto en espa\u00f1ol sencillo. S\u00e9 lo m\u00e1s espec\u00edfico posible.",
    createPlaceholder: "ej. Una app de h\u00e1bitos con rachas diarias, un mapa de calor y recordatorios push...",
    generateButton: "Generar Plan",
    generating: "Generando plan...",
    minCharsError: "Describe tu proyecto con al menos 10 caracteres.",
    planHeading: "Tu Plan de Construcci\u00f3n",
    planBreaking: "Dividiendo tu idea en tareas...",
    planStarting: "Iniciando construcci\u00f3n...",
    projectReady: "Tu proyecto est\u00e1 listo.",
    savedToProjects: "Guardado en tus proyectos",
    saving: "Guardando...",
    saveProject: "Guardar Tu Proyecto",
    taskQueue: "Cola de Tareas",
    completed: "completadas",
    agentLog: "Registro del Agente",
    liveOutput: "Salida en vivo del agente de construcci\u00f3n",
  },
} as const;

/* ------------------------------------------------------------------ */
/*  Language Toggle                                                    */
/* ------------------------------------------------------------------ */

function LangToggle({ lang, setLang }: { lang: Lang; setLang: (l: Lang) => void }) {
  return (
    <div className="fixed top-4 right-4 z-50 flex items-center bg-surface border border-slate-700 rounded-lg overflow-hidden text-xs font-mono">
      <button
        onClick={() => setLang("en")}
        className={`px-3 py-1.5 transition-colors ${
          lang === "en" ? "bg-accent text-bg" : "text-slate-400 hover:text-slate-200"
        }`}
      >
        EN
      </button>
      <button
        onClick={() => setLang("es")}
        className={`px-3 py-1.5 transition-colors ${
          lang === "es" ? "bg-accent text-bg" : "text-slate-400 hover:text-slate-200"
        }`}
      >
        ES
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Landing                                                            */
/* ------------------------------------------------------------------ */

const TICKER_TEXT =
  "landing page \u00b7 telegram bot \u00b7 portfolio site \u00b7 saas tool \u00b7 chrome extension \u00b7 bakery website \u00b7 booking system \u00b7 waitlist page \u00b7 link in bio \u00b7 discord bot";

function Landing({ onStart, lang }: { onStart: () => void; lang: Lang }) {
  const s = t[lang];
  return (
    <div className="flex flex-col items-center justify-center min-h-screen px-6">
      {/* Hero — two-column on desktop, stacked on mobile */}
      <div className="relative flex flex-col lg:flex-row items-center gap-12 lg:gap-20 max-w-6xl w-full">
        {/* Left: text */}
        <div className="flex-1 text-center lg:text-left">
          <p className="text-accent font-mono text-sm tracking-widest uppercase mb-4">
            Clancy
          </p>
          <h1 className="font-syne font-800 text-4xl sm:text-6xl lg:text-7xl leading-tight mb-6">
            {s.headline}
          </h1>
          <p className="text-slate-400 max-w-xl mb-10 text-lg mx-auto lg:mx-0">
            {s.subtext}
          </p>
          <button
            onClick={onStart}
            className="bg-accent text-bg font-syne font-700 text-lg px-8 py-4 rounded-xl hover:brightness-110 transition-all"
          >
            {s.startButton}
          </button>
          <p className="text-slate-600 font-mono text-xs mt-4">
            {s.betaLine}
          </p>
        </div>

        {/* Right: mascot with radial glow */}
        <div className="relative flex-shrink-0">
          <div
            className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] rounded-full pointer-events-none z-0"
            style={{
              background: "radial-gradient(circle, rgba(79, 255, 176, 0.08) 0%, transparent 70%)",
              filter: "blur(80px)",
            }}
          />
          <img
            src="/clancy-mascot.png"
            alt="Clancy mascot"
            className="relative z-10 w-80 sm:w-96 lg:w-[480px] object-contain"
            style={{
              filter: "drop-shadow(0 0 24px rgba(79, 255, 176, 0.4)) drop-shadow(0 0 60px rgba(79, 255, 176, 0.2))",
            }}
          />
        </div>
      </div>

      {/* Ticker strip */}
      <div className="w-screen mt-24 border-t border-b border-slate-800 bg-surface overflow-hidden">
        <div className="flex animate-ticker whitespace-nowrap py-3">
          {[0, 1].map((i) => (
            <span
              key={i}
              className="text-slate-500 font-mono text-sm tracking-wide px-4"
            >
              {TICKER_TEXT} &nbsp;&middot;&nbsp; {TICKER_TEXT} &nbsp;&middot;&nbsp;
            </span>
          ))}
        </div>
      </div>

      {/* Features */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-8 mt-16 max-w-4xl w-full pb-20">
        {s.features.map((f) => (
          <div key={f.title} className="bg-surface rounded-xl p-6 text-left">
            <h3 className="font-syne font-700 text-accent text-xl mb-2">
              {f.title}
            </h3>
            <p className="text-slate-400 text-sm leading-relaxed">{f.desc}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Create                                                             */
/* ------------------------------------------------------------------ */

function Create({
  onPlan,
  lang,
}: {
  onPlan: (description: string, tasks: PlanTask[]) => void;
  lang: Lang;
}) {
  const s = t[lang];
  const [desc, setDesc] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleGenerate() {
    setError("");
    if (desc.trim().length < 10) {
      setError(s.minCharsError);
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/generate-plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ description: desc.trim() }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to generate plan");
      }
      const data = await res.json();
      const tasks: PlanTask[] = data.tasks.map(
        (tk: { label: string; estimated_seconds: number; order_index: number; success_criteria?: string[] }) => ({
          id: uid(),
          label: tk.label,
          estimated_seconds: tk.estimated_seconds,
          order_index: tk.order_index,
          status: "pending" as const,
          success_criteria: tk.success_criteria,
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
          onClick={() => window.location.reload()}
          className="text-slate-500 hover:text-slate-300 text-sm mb-8 transition-colors"
        >
          {s.back}
        </button>
        <h2 className="font-syne font-700 text-3xl sm:text-4xl mb-2">
          {s.createHeading}
        </h2>
        <p className="text-slate-400 mb-8">
          {s.createSubtext}
        </p>
        <textarea
          value={desc}
          onChange={(e) => setDesc(e.target.value)}
          placeholder={s.createPlaceholder}
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
              {s.generating}
            </span>
          ) : (
            s.generateButton
          )}
        </button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Planning                                                           */
/* ------------------------------------------------------------------ */

function Planning({
  tasks,
  onBuild,
  lang,
}: {
  tasks: PlanTask[];
  onBuild: () => void;
  lang: Lang;
}) {
  const s = t[lang];
  const [visible, setVisible] = useState(0);

  useEffect(() => {
    if (visible < tasks.length) {
      const timer = setTimeout(() => setVisible((v) => v + 1), 200);
      return () => clearTimeout(timer);
    }
    const timer = setTimeout(onBuild, 2000);
    return () => clearTimeout(timer);
  }, [visible, tasks.length, onBuild]);

  return (
    <div className="flex flex-col items-center justify-center min-h-screen px-6">
      <div className="w-full max-w-2xl">
        <h2 className="font-syne font-700 text-3xl sm:text-4xl mb-2">
          {s.planHeading}
        </h2>
        <p className="text-slate-400 mb-8">
          {visible < tasks.length ? s.planBreaking : s.planStarting}
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
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Building                                                           */
/* ------------------------------------------------------------------ */

function Building({
  tasks: initialTasks,
  projectId,
  description,
  lang,
}: {
  tasks: PlanTask[];
  projectId: string;
  description: string;
  lang: Lang;
}) {
  const s = t[lang];
  const [tasks, setTasks] = useState<PlanTask[]>(initialTasks);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [complete, setComplete] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const logEndRef = useRef<HTMLDivElement>(null);
  const started = useRef(false);

  async function handleSave() {
    setSaving(true);
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      // Not logged in — redirect to auth
      window.location.href = "/auth";
      return;
    }

    const { error } = await supabase.from("projects").insert({
      id: projectId,
      user_id: user.id,
      title: description.slice(0, 100),
      description,
      status: "complete",
    });

    setSaving(false);
    if (!error) setSaved(true);
  }

  useEffect(() => {
    if (logEndRef.current) {
      logEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [logs]);

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    const payload = {
      project_id: projectId,
      description,
      tasks: initialTasks.map((t) => ({
        id: t.id,
        label: t.label,
        order_index: t.order_index,
        success_criteria: t.success_criteria,
      })),
    };

    // Use fetch with ReadableStream to consume SSE since EventSource only supports GET
    async function runStream() {
      const res = await fetch("/api/run-agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.body) return;

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

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
            handleSSE(event, parsed);
          } catch {
            // skip malformed data
          }
        }
      }
    }

    runStream();
  }, [initialTasks, projectId]);

  function handleSSE(
    event: string,
    data: { task_id?: string; label?: string; log?: string; duration?: number; message?: string; error?: string }
  ) {
    switch (event) {
      case "task_start":
        setTasks((prev) =>
          prev.map((t) =>
            t.id === data.task_id ? { ...t, status: "active" } : t
          )
        );
        setLogs((prev) => [
          ...prev,
          {
            task_id: data.task_id!,
            text: `--- Starting: ${data.label} ---`,
            ts: Date.now(),
          },
        ]);
        break;

      case "agent_log":
        setLogs((prev) => [
          ...prev,
          { task_id: data.task_id!, text: data.log!, ts: Date.now() },
        ]);
        break;

      case "task_complete":
        setTasks((prev) =>
          prev.map((t) =>
            t.id === data.task_id
              ? { ...t, status: "done", duration: data.duration }
              : t
          )
        );
        setLogs((prev) => [
          ...prev,
          {
            task_id: data.task_id!,
            text: `--- Completed in ${data.duration}s ---`,
            ts: Date.now(),
          },
        ]);
        break;

      case "task_error":
        setTasks((prev) =>
          prev.map((t) =>
            t.id === data.task_id ? { ...t, status: "error" } : t
          )
        );
        setLogs((prev) => [
          ...prev,
          {
            task_id: data.task_id!,
            text: `--- Error: ${data.error} ---`,
            ts: Date.now(),
          },
        ]);
        break;

      case "build_complete":
        setComplete(true);
        setLogs((prev) => [
          ...prev,
          { task_id: "system", text: data.message!, ts: Date.now() },
        ]);
        break;
    }
  }

  const statusIcon = (s: PlanTask["status"]) => {
    switch (s) {
      case "pending":
        return (
          <span className="w-3 h-3 rounded-full border border-slate-600 block" />
        );
      case "active":
        return (
          <span className="w-3 h-3 rounded-full bg-accent animate-pulse_dot block" />
        );
      case "done":
        return (
          <span className="w-3 h-3 rounded-full bg-accent block" />
        );
      case "error":
        return (
          <span className="w-3 h-3 rounded-full bg-red-500 block" />
        );
    }
  };

  return (
    <div className="min-h-screen flex flex-col">
      {/* Success banner */}
      {complete && (
        <div className="bg-accent text-bg text-center py-3 font-syne font-700 text-sm sm:text-base flex items-center justify-center gap-4">
          <span>{s.projectReady}</span>
          {saved ? (
            <span className="bg-bg/20 px-3 py-1 rounded-lg text-sm">
              {s.savedToProjects}
            </span>
          ) : (
            <button
              onClick={handleSave}
              disabled={saving}
              className="bg-bg text-accent px-4 py-1 rounded-lg text-sm hover:bg-bg/80 transition-colors disabled:opacity-50"
            >
              {saving ? s.saving : s.saveProject}
            </button>
          )}
        </div>
      )}

      <div className="flex-1 flex flex-col lg:flex-row">
        {/* Left: Task Queue */}
        <div className="lg:w-[380px] flex-shrink-0 border-r border-slate-800 p-6 overflow-y-auto">
          <h2 className="font-syne font-700 text-xl mb-1">{s.taskQueue}</h2>
          <p className="text-slate-500 text-xs mb-6 font-mono">
            {tasks.filter((tk) => tk.status === "done").length}/{tasks.length}{" "}
            {s.completed}
          </p>
          <ol className="space-y-2">
            {tasks.map((task) => (
              <li
                key={task.id}
                className={`flex items-center gap-3 rounded-lg p-3 transition-colors ${
                  task.status === "active"
                    ? "bg-accent/10 border border-accent/30"
                    : task.status === "done"
                    ? "bg-surface opacity-60"
                    : "bg-surface"
                }`}
              >
                {statusIcon(task.status)}
                <div className="flex-1 min-w-0">
                  <p
                    className={`text-sm truncate ${
                      task.status === "active"
                        ? "text-accent"
                        : task.status === "done"
                        ? "text-slate-400 line-through"
                        : "text-slate-300"
                    }`}
                  >
                    {task.label}
                  </p>
                  {task.status === "done" && task.duration != null && (
                    <p className="text-slate-600 text-xs font-mono">
                      {task.duration}s
                    </p>
                  )}
                </div>
              </li>
            ))}
          </ol>
        </div>

        {/* Right: Agent Log */}
        <div className="flex-1 flex flex-col min-h-0">
          <div className="p-6 pb-2">
            <h2 className="font-syne font-700 text-xl mb-1">{s.agentLog}</h2>
            <p className="text-slate-500 text-xs font-mono">
              {s.liveOutput}
            </p>
          </div>
          <div className="flex-1 overflow-y-auto p-6 pt-2 log-scroll">
            <div className="bg-surface rounded-xl p-4 min-h-full">
              {logs.map((entry, i) => (
                <div
                  key={i}
                  className={`font-mono text-sm leading-relaxed ${
                    entry.text.startsWith("---")
                      ? entry.text.includes("Error")
                        ? "text-red-400 mt-3 mb-1"
                        : "text-accent/70 mt-3 mb-1"
                      : "text-slate-400 pl-2"
                  }`}
                >
                  <span className="text-slate-600 select-none mr-2 text-xs">
                    {new Date(entry.ts).toLocaleTimeString([], {
                      hour12: false,
                      hour: "2-digit",
                      minute: "2-digit",
                      second: "2-digit",
                    })}
                  </span>
                  {entry.text}
                </div>
              ))}
              {!complete && logs.length > 0 && (
                <span className="inline-block w-2 h-4 bg-accent/70 animate-pulse ml-2 mt-1" />
              )}
              <div ref={logEndRef} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Root Page                                                          */
/* ------------------------------------------------------------------ */

export default function Home() {
  const [view, setView] = useState<View>("landing");
  const [tasks, setTasks] = useState<PlanTask[]>([]);
  const [description, setDescription] = useState("");
  const [projectId] = useState(() => uid());
  const [lang, setLang] = useState<Lang>("en");

  // Load saved language preference
  useEffect(() => {
    const saved = localStorage.getItem("clancy-lang");
    if (saved === "en" || saved === "es") setLang(saved);
  }, []);

  const changeLang = useCallback((l: Lang) => {
    setLang(l);
    localStorage.setItem("clancy-lang", l);
  }, []);

  const handlePlan = useCallback((desc: string, newTasks: PlanTask[]) => {
    setDescription(desc);
    setTasks(newTasks);
    setView("planning");
  }, []);

  const handleBuild = useCallback(() => {
    setView("building");
  }, []);

  const toggle = <LangToggle lang={lang} setLang={changeLang} />;

  switch (view) {
    case "landing":
      return <>{toggle}<Landing onStart={() => setView("create")} lang={lang} /></>;
    case "create":
      return <>{toggle}<Create onPlan={handlePlan} lang={lang} /></>;
    case "planning":
      return <>{toggle}<Planning tasks={tasks} onBuild={handleBuild} lang={lang} /></>;
    case "building":
      return (
        <>
          {toggle}
          <Building
            tasks={tasks}
            projectId={projectId}
            description={description}
            lang={lang}
          />
        </>
      );
  }
}
