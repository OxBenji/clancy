"use client";

import { useState, useCallback } from "react";
import Landing from "@/components/Landing";
import Create from "@/components/Create";
import Planning from "@/components/Planning";
import Building from "@/components/Building";
import type { PlanTask } from "@/lib/types";

type View = "landing" | "create" | "planning" | "building";

export default function Home() {
  const [view, setView] = useState<View>("landing");
  const [tasks, setTasks] = useState<PlanTask[]>([]);
  const [description, setDescription] = useState("");
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
      return <Landing onStart={() => setView("create")} />;
    case "create":
      return <Create onPlan={handlePlan} onBack={handleReset} />;
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
  }
}
