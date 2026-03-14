import { createClient, SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";

let _client: SupabaseClient<Database> | null = null;

const isDemoMode =
  !process.env.NEXT_PUBLIC_SUPABASE_URL ||
  !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export function getSupabase(): SupabaseClient<Database> | null {
  if (isDemoMode) return null;
  if (!_client) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
    _client = createClient<Database>(url, key);
  }
  return _client;
}

// Proxy that returns null-safe operations in demo mode
export const supabase = new Proxy({} as SupabaseClient<Database>, {
  get(_target, prop) {
    const client = getSupabase();
    if (!client) {
      // Return a stub that won't crash
      if (prop === "auth") {
        return {
          getUser: async () => ({ data: { user: null }, error: null }),
          signOut: async () => ({ error: null }),
          signInWithOtp: async () => ({ error: null }),
        };
      }
      if (prop === "from") {
        return () => ({
          select: () => ({ eq: () => ({ data: [], error: null }), order: () => ({ data: [], error: null }), data: [], error: null }),
          insert: () => ({ data: null, error: null }),
          update: () => ({ eq: () => ({ data: null, error: null }) }),
          delete: () => ({ eq: () => ({ data: null, error: null }) }),
        });
      }
      return undefined;
    }
    return Reflect.get(client, prop);
  },
});
