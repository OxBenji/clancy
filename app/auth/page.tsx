"use client";

import dynamic from "next/dynamic";

const SignIn = dynamic(
  () => import("@clerk/nextjs").then((mod) => mod.SignIn),
  { ssr: false }
);

export default function AuthPage() {
  return (
    <div className="flex flex-col items-center justify-center min-h-screen px-6">
      <div className="text-center mb-10">
        <p className="text-accent font-mono text-sm tracking-widest uppercase mb-2">
          Clancy
        </p>
        <h1 className="font-syne font-800 text-3xl">Sign In</h1>
      </div>
      <SignIn
        routing="hash"
        forceRedirectUrl="/dashboard"
      />
    </div>
  );
}
