"use client";

import { useState, useCallback, useEffect } from "react";
import dynamic from "next/dynamic";
import Landing from "@/components/Landing";
import TemplateGrid from "@/components/TemplateGrid";
import type { PlanTask } from "@/lib/types";

const Create = dynamic(() => import("@/components/Create"));
const Planning = dynamic(() => import("@/components/Planning"));
const Building = dynamic(() => import("@/components/Building"));
const CodingChat = dynamic(() => import("@/components/CodingChat"));
const ThemeMarketplace = dynamic(() => import("@/components/ThemeMarketplace"));
type View = "landing" | "templates" | "create" | "planning" | "building" | "chat" | "themes";

export default function Home() {
  const [view, setView] = useState<View>("landing");
  const [tasks, setTasks] = useState<PlanTask[]>([]);
  const [description, setDescription] = useState("");

  // Handle fork query param from dashboard
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const fork = params.get("fork");
    if (fork) {
      setDescription(fork);
      setView("create");
      // Clean URL without reload
      window.history.replaceState({}, "", "/");
    }
  }, []);
  const [projectId, setProjectId] = useState(() => crypto.randomUUID());

  const handlePlan = useCallback((desc: string, newTasks: PlanTask[]) => {
    setDescription(desc);
    setTasks(newTasks);
    setView("planning");
  }, []);

  const handleBuild = useCallback(() => {
    setView("building");
  }, []);

  const handleReset = useCallback(() => {
    setView("landing");
    setTasks([]);
    setDescription("");
    setProjectId(crypto.randomUUID());
  }, []);

  switch (view) {
    case "landing":
      return (
        <Landing
          onStart={() => setView("templates")}
          onChat={() => setView("chat")}
        />
      );
    case "templates":
      return (
        <TemplateGrid
          onSelect={(t) => {
            setDescription(t.prompt);
            setView("create");
          }}
          onCustom={() => setView("create")}
          onBrowseThemes={() => setView("themes")}
        />
      );
    case "create":
      return (
        <Create
          onPlan={handlePlan}
          onBack={() => setView("templates")}
          initialDescription={description}
        />
      );
    case "planning":
      return (
        <Planning
          tasks={tasks}
          onBuild={handleBuild}
          onBack={() => setView("create")}
        />
      );
    case "building":
      return (
        <Building
          tasks={tasks}
          projectId={projectId}
          description={description}
          onBack={handleReset}
        />
      );
    case "chat":
      return <CodingChat onBack={handleReset} />;
    case "themes":
      return (
        <ThemeMarketplace
          onSelect={(theme) => {
            setDescription(theme.prompt);
            setView("create");
          }}
          onBack={() => setView("templates")}
        />
      );
  }
}
