"use client";

import { isClerkConfigured } from "@/lib/clerk-enabled";

// Re-export Clerk hooks that fall back gracefully when Clerk isn't configured.
// We dynamically import so that calling useUser/useClerk without a ClerkProvider
// never throws.

let clerkAvailable: boolean;
try {
  clerkAvailable = isClerkConfigured();
} catch {
  clerkAvailable = false;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ClerkUser = any;

interface UseUserResult {
  user: ClerkUser | null;
  isLoaded: boolean;
  isSignedIn: boolean;
}

interface UseClerkResult {
  signOut: () => Promise<void>;
}

const nullUser: UseUserResult = { user: null, isLoaded: true, isSignedIn: false };
const nullClerk: UseClerkResult = { signOut: async () => {} };

export function useUser(): UseUserResult {
  if (!clerkAvailable) return nullUser;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const clerk = require("@clerk/nextjs");
  return clerk.useUser();
}

export function useClerk(): UseClerkResult {
  if (!clerkAvailable) return nullClerk;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const clerk = require("@clerk/nextjs");
  return clerk.useClerk();
}
