"use client";

import { useEffect, useState } from "react";
import { useUser, useClerk } from "@clerk/nextjs";
import { supabase } from "@/lib/supabase";

interface Project {
  id: string;
  title: string | null;
  description: string | null;
  status: string | null;
  created_at: string | null;
}

export default function DashboardPage() {
  const { user, isLoaded } = useUser();
  const { signOut } = useClerk();
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!isLoaded) return;
    if (!user) {
      window.location.href = "/auth";
      return;
    }

    async function load() {
      const { data } = await supabase
        .from("projects")
        .select("id, title, description, status, created_at")
        .eq("user_id", user!.id)
        .order("created_at", { ascending: false });

      setProjects(data || []);
      setLoading(false);
    }
    load();
  }, [isLoaded, user]);

  async function handleSignOut() {
    await signOut();
    window.location.href = "/auth";
  }

  async function handleDelete(projectId: string) {
    await supabase.from("projects").delete().eq("id", projectId);
    setProjects((prev) => prev.filter((p) => p.id !== projectId));
  }

  if (!isLoaded || loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <span className="w-6 h-6 border-2 border-accent border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen px-6 py-12">
      <div className="max-w-3xl mx-auto">
        <div className="flex items-center justify-between mb-10">
          <div>
            <p className="text-accent font-mono text-sm tracking-widest uppercase mb-1">
              Clancy
            </p>
            <h1 className="font-syne font-800 text-3xl">Dashboard</h1>
            <p className="text-slate-500 text-sm mt-1">
              {user?.primaryEmailAddress?.emailAddress}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <a
              href="/"
              className="bg-accent text-bg font-syne font-700 text-sm px-5 py-2.5 rounded-xl hover:brightness-110 transition-all"
            >
              New Project
            </a>
            <button
              onClick={handleSignOut}
              className="border border-slate-700 text-slate-400 font-syne font-600 text-sm px-5 py-2.5 rounded-xl hover:border-slate-500 hover:text-slate-200 transition-all"
            >
              Sign Out
            </button>
          </div>
        </div>

        <h2 className="font-syne font-700 text-xl mb-4">Your Projects</h2>

        {projects.length === 0 ? (
          <div className="bg-surface rounded-xl p-8 text-center">
            <p className="text-slate-500 mb-4">No projects yet.</p>
            <a
              href="/"
              className="text-accent hover:underline font-mono text-sm"
            >
              Build your first project &rarr;
            </a>
          </div>
        ) : (
          <div className="space-y-3">
            {projects.map((project) => (
              <div
                key={project.id}
                className="bg-surface rounded-xl p-5 flex items-start gap-4"
              >
                <div className="flex-1 min-w-0">
                  <p className="text-slate-200 font-syne font-700 truncate">
                    {project.title || "Untitled"}
                  </p>
                  {project.description && (
                    <p className="text-slate-500 text-sm mt-1 line-clamp-2">
                      {project.description}
                    </p>
                  )}
                  <div className="flex items-center gap-3 mt-2">
                    <span
                      className={`text-xs font-mono px-2 py-0.5 rounded-full ${
                        project.status === "complete"
                          ? "bg-accent/10 text-accent"
                          : "bg-slate-800 text-slate-500"
                      }`}
                    >
                      {project.status || "pending"}
                    </span>
                    {project.created_at && (
                      <span className="text-slate-600 text-xs font-mono">
                        {new Date(project.created_at).toLocaleDateString()}
                      </span>
                    )}
                  </div>
                </div>
                <button
                  onClick={() => handleDelete(project.id)}
                  className="text-slate-600 hover:text-red-400 transition-colors text-xs font-mono flex-shrink-0"
                >
                  Delete
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
