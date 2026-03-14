"use client";

import Image from "next/image";

const TICKER_TEXT =
  "landing page \u00b7 telegram bot \u00b7 portfolio site \u00b7 saas tool \u00b7 chrome extension \u00b7 bakery website \u00b7 booking system \u00b7 waitlist page \u00b7 link in bio \u00b7 discord bot";

export default function Landing({
  onStart,
  onChat,
}: {
  onStart: () => void;
  onChat: () => void;
}) {
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
            Describe&nbsp;it. Watch&nbsp;it&nbsp;build. Get&nbsp;a&nbsp;live&nbsp;link.
          </h1>
          <p className="text-slate-400 max-w-xl mb-10 text-lg mx-auto lg:mx-0">
            Tell Clancy what you want. An autonomous AI agent breaks it into
            tasks, executes them in a real sandbox, and ships a working project
            — while you watch every step in real time.
          </p>
          <div className="flex flex-col sm:flex-row gap-3 items-center lg:items-start">
            <button
              onClick={onStart}
              className="bg-accent text-bg font-syne font-700 text-lg px-8 py-4 rounded-xl hover:brightness-110 transition-all"
            >
              Start Building
            </button>
            <button
              onClick={onChat}
              className="border border-slate-700 text-slate-300 font-syne font-600 text-lg px-8 py-4 rounded-xl hover:border-accent hover:text-accent transition-all"
            >
              Coding Assistant
            </button>
          </div>
          <p className="text-slate-600 font-mono text-xs mt-4">
            Free during beta &middot; No credit card &middot; Built by
            @BenjiShips
          </p>
        </div>

        {/* Right: mascot with radial glow */}
        <div className="relative flex-shrink-0">
          <div
            className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] rounded-full pointer-events-none z-0"
            style={{
              background:
                "radial-gradient(circle, rgba(79, 255, 176, 0.08) 0%, transparent 70%)",
              filter: "blur(80px)",
            }}
          />
          <Image
            src="/clancy-mascot.png"
            alt="Clancy mascot"
            width={480}
            height={480}
            priority
            className="relative z-10 w-80 sm:w-96 lg:w-[480px] object-contain"
            style={{
              filter:
                "drop-shadow(0 0 24px rgba(79, 255, 176, 0.4)) drop-shadow(0 0 60px rgba(79, 255, 176, 0.2))",
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
              {TICKER_TEXT} &nbsp;&middot;&nbsp; {TICKER_TEXT}{" "}
              &nbsp;&middot;&nbsp;
            </span>
          ))}
        </div>
      </div>

      {/* Features */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-8 mt-16 max-w-4xl w-full">
        {[
          {
            title: "Describe",
            desc: "Type what you want in plain English. No PRD. No technical knowledge needed.",
          },
          {
            title: "Plan",
            desc: "Clancy breaks it into 5\u201310 concrete tasks in seconds. You review the plan before it starts.",
          },
          {
            title: "Ship",
            desc: "The agent writes real code in a sandbox. You watch live. You get a working preview URL.",
          },
        ].map((f) => (
          <div key={f.title} className="bg-surface rounded-xl p-6 text-left">
            <h3 className="font-syne font-700 text-accent text-xl mb-2">
              {f.title}
            </h3>
            <p className="text-slate-400 text-sm leading-relaxed">{f.desc}</p>
          </div>
        ))}
      </div>

      {/* Attribution footer */}
      <div className="mt-16 pb-12 text-center">
        <p className="text-slate-600 font-mono text-xs">
          Inspired by{" "}
          <a
            href="https://ralph.app"
            target="_blank"
            rel="noopener noreferrer"
            className="text-slate-400 hover:text-accent transition-colors"
          >
            Ralph
          </a>{" "}
          by @AidenBai &middot; Built with love by @BenjiShips
        </p>
      </div>
    </div>
  );
}
