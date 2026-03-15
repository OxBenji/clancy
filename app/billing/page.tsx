"use client";

import { Suspense, useState, useEffect } from "react";
import { useUser } from "@clerk/nextjs";
import { useSearchParams } from "next/navigation";

export default function BillingPage() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center min-h-screen">
          <span className="w-6 h-6 border-2 border-accent border-t-transparent rounded-full animate-spin" />
        </div>
      }
    >
      <BillingContent />
    </Suspense>
  );
}

function BillingContent() {
  const { user, isLoaded } = useUser();
  const searchParams = useSearchParams();
  const [subscribed, setSubscribed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [checkoutLoading, setCheckoutLoading] = useState(false);

  const success = searchParams.get("success") === "true";
  const canceled = searchParams.get("canceled") === "true";

  useEffect(() => {
    if (!isLoaded || !user) return;

    async function checkStatus() {
      try {
        const res = await fetch("/api/stripe/status");
        if (res.ok) {
          const data = await res.json();
          setSubscribed(data.subscribed);
        }
      } catch {
        // ignore
      }
      setLoading(false);
    }
    checkStatus();
  }, [isLoaded, user]);

  async function handleCheckout() {
    setCheckoutLoading(true);
    try {
      const res = await fetch("/api/stripe/checkout", { method: "POST" });
      const data = await res.json();
      if (data.url) {
        window.location.href = data.url;
      }
    } catch {
      // ignore
    }
    setCheckoutLoading(false);
  }

  if (!isLoaded || loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <span className="w-6 h-6 border-2 border-accent border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <a href="/auth" className="text-accent hover:underline font-mono text-sm">
          Sign in to manage billing &rarr;
        </a>
      </div>
    );
  }

  return (
    <div className="min-h-screen px-6 py-12">
      <div className="max-w-lg mx-auto">
        <div className="mb-8">
          <a href="/dashboard" className="text-slate-500 hover:text-slate-300 text-sm font-mono transition-colors">
            &larr; Dashboard
          </a>
        </div>

        <p className="text-accent font-mono text-sm tracking-widest uppercase mb-2">
          Clancy
        </p>
        <h1 className="font-syne font-800 text-3xl mb-8">Billing</h1>

        {success && (
          <div className="bg-accent/10 border border-accent/30 rounded-xl p-4 mb-6">
            <p className="text-accent font-mono text-sm">
              Subscription activated! You now have unlimited builds.
            </p>
          </div>
        )}

        {canceled && (
          <div className="bg-slate-800 border border-slate-700 rounded-xl p-4 mb-6">
            <p className="text-slate-400 font-mono text-sm">
              Checkout was canceled. No charges were made.
            </p>
          </div>
        )}

        {subscribed ? (
          <div className="bg-surface rounded-xl p-6">
            <div className="flex items-center gap-3 mb-4">
              <span className="w-3 h-3 rounded-full bg-accent block" />
              <h2 className="font-syne font-700 text-xl">Pro Plan</h2>
            </div>
            <p className="text-slate-400 text-sm mb-4">
              You have an active subscription with unlimited builds.
            </p>
            <p className="text-slate-600 text-xs font-mono">
              Manage your subscription through Stripe&apos;s customer portal.
            </p>
          </div>
        ) : (
          <div className="bg-surface rounded-xl p-6">
            <h2 className="font-syne font-700 text-xl mb-2">Free Plan</h2>
            <p className="text-slate-400 text-sm mb-6">
              You&apos;re on the free plan with limited builds per day. Upgrade to Pro for unlimited builds.
            </p>
            <button
              onClick={handleCheckout}
              disabled={checkoutLoading}
              className="w-full bg-accent text-bg font-syne font-700 text-lg py-3 rounded-xl hover:brightness-110 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {checkoutLoading ? (
                <span className="flex items-center justify-center gap-2">
                  <span className="w-4 h-4 border-2 border-bg border-t-transparent rounded-full animate-spin" />
                  Redirecting...
                </span>
              ) : (
                "Upgrade to Pro"
              )}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
