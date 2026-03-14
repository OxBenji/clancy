import { createClient, SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";

// Server-side Supabase client for API routes that don't have cookie context.
// Uses the service role key to bypass RLS for internal operations like
// updating task status during the agent build loop.
// Lazily initialized to avoid build-time errors when env vars aren't set.

let _client: SupabaseClient<Database> | null = null;

export function getSupabaseAdmin(): SupabaseClient<Database> {
  if (!_client) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) {
      throw new Error(
        "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY"
      );
    }
    _client = createClient<Database>(url, key);
  }
  return _client;
}
