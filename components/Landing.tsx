"use client";

import { useEffect, useRef } from "react";
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
  const sectionsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = sectionsRef.current;
    if (!el) return;
    const targets = el.querySelectorAll("[data-animate]");
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            (entry.target as HTMLElement).style.opacity = "1";
            (entry.target as HTMLElement).style.transform = "translateY(0)";
            observer.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.15 }
    );
    targets.forEach((t) => observer.observe(t));
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={sectionsRef} className="flex flex-col items-center px-6 pt-24 sm:pt-32">
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
            @OxBenji
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
      <section id="features" data-animate className="w-full max-w-4xl mt-16" style={{ opacity: 0, transform: "translateY(24px)", transition: "opacity 0.6s ease-out, transform 0.6s ease-out" }}>
        <h2 className="font-syne font-700 text-2xl sm:text-3xl text-center mb-10">
          How it works
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-8">
          {[
            {
              icon: "💬",
              title: "Describe",
              desc: "Type what you want in plain English. No PRD. No technical knowledge needed.",
            },
            {
              icon: "📋",
              title: "Plan",
              desc: "Clancy breaks it into 5\u201310 concrete tasks in seconds. You review the plan before it starts.",
            },
            {
              icon: "🚀",
              title: "Ship",
              desc: "The agent writes real code in a sandbox. You watch live. You get a working preview URL.",
            },
          ].map((f) => (
            <div
              key={f.title}
              className="bg-surface rounded-xl p-6 text-left border border-transparent hover:border-accent/30 hover:shadow-[0_0_24px_rgba(79,255,176,0.06)] transition-all duration-300 group"
            >
              <span className="text-3xl mb-3 block">{f.icon}</span>
              <h3 className="font-syne font-700 text-accent text-xl mb-2 group-hover:brightness-110 transition-all">
                {f.title}
              </h3>
              <p className="text-slate-400 text-sm leading-relaxed">
                {f.desc}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* Testimonials */}
      <section id="testimonials" data-animate className="w-full max-w-4xl mt-24" style={{ opacity: 0, transform: "translateY(24px)", transition: "opacity 0.6s ease-out 0.1s, transform 0.6s ease-out 0.1s" }}>
        <h2 className="font-syne font-700 text-2xl sm:text-3xl text-center mb-10">
          What builders are saying
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-8">
          {[
            {
              quote:
                "I described a booking system in two sentences. Clancy had a working prototype in under 5 minutes.",
              author: "Sarah K.",
              role: "Freelance Designer",
            },
            {
              quote:
                "Watching the agent build in real time is wild. It feels like pair programming with a 10x engineer.",
              author: "Marcus T.",
              role: "Indie Hacker",
            },
            {
              quote:
                "I shipped 3 client landing pages in one afternoon. Clancy is an unfair advantage.",
              author: "Priya R.",
              role: "Agency Founder",
            },
          ].map((t) => (
            <blockquote
              key={t.author}
              className="bg-surface rounded-xl p-6 border border-slate-800 hover:border-accent/20 transition-all duration-300 flex flex-col justify-between"
            >
              <p className="text-slate-300 text-sm leading-relaxed italic mb-6">
                &ldquo;{t.quote}&rdquo;
              </p>
              <footer>
                <p className="font-syne font-600 text-accent text-sm">
                  {t.author}
                </p>
                <p className="text-slate-500 font-mono text-xs">{t.role}</p>
              </footer>
            </blockquote>
          ))}
        </div>
      </section>

      {/* CTA Footer */}
      <section
        id="cta"
        data-animate
        className="w-full max-w-2xl mt-24 mb-8 text-center bg-surface rounded-2xl p-10 sm:p-14 border border-slate-800"
        style={{ opacity: 0, transform: "translateY(24px)", transition: "opacity 0.6s ease-out 0.2s, transform 0.6s ease-out 0.2s" }}
      >
        <h2 className="font-syne font-800 text-3xl sm:text-4xl mb-4">
          Ready to build something?
        </h2>
        <p className="text-slate-400 mb-8 max-w-md mx-auto">
          Go from idea to live project in minutes. No setup, no config, no
          code&mdash;just describe what you want.
        </p>
        <button
          onClick={onStart}
          className="bg-accent text-bg font-syne font-700 text-lg px-10 py-4 rounded-xl hover:brightness-110 hover:scale-[1.02] active:scale-[0.98] transition-all duration-200"
        >
          Start Building — It&apos;s Free
        </button>
      </section>

      {/* Attribution footer */}
      <div className="mt-8 pb-12 text-center">
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
          by @AidenBai &middot; Built with love by @OxBenji
        </p>
      </div>
    </div>
  );
}
