"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import type { User } from "@supabase/supabase-js";

export default function DashboardPage() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) {
        router.replace("/auth");
      } else {
        setUser(user);
        setLoading(false);
      }
    });
  }, [router]);

  async function handleSignOut() {
    await supabase.auth.signOut();
    router.replace("/auth");
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <span className="w-6 h-6 border-2 border-accent border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center justify-center min-h-screen px-6">
      <div className="w-full max-w-md text-center">
        {/* Logo */}
        <p className="text-accent font-mono text-sm tracking-widest uppercase mb-2">
          Clancy
        </p>
        <h1 className="font-syne font-800 text-3xl mb-2">Dashboard</h1>
        <p className="text-slate-400 mb-10">
          Welcome,{" "}
          <span className="text-slate-200">{user?.email}</span>
        </p>

        <a
          href="/"
          className="block w-full bg-accent text-bg font-syne font-700 text-lg py-4 rounded-xl hover:brightness-110 transition-all mb-4 text-center"
        >
          Start New Project
        </a>

        <button
          onClick={handleSignOut}
          className="w-full border border-slate-700 text-slate-400 font-syne font-600 py-3 rounded-xl hover:border-slate-500 hover:text-slate-200 transition-all"
        >
          Sign Out
        </button>
      </div>
    </div>
  );
}
