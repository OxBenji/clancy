import { createClient, SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { getMemoryDb, type MemoryClient } from "@/lib/memory-db";

// Server-side Supabase client for API routes.
// Falls back to in-memory storage when Supabase env vars aren't set (demo mode).

let _client: SupabaseClient<Database> | MemoryClient | null = null;

export function getSupabaseAdmin(): SupabaseClient<Database> | MemoryClient {
  if (!_client) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (url && key) {
      _client = createClient<Database>(url, key);
    } else {
      console.log("[demo mode] No Supabase keys — using in-memory database");
      _client = getMemoryDb();
    }
  }
  return _client;
}
