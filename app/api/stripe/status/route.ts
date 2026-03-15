import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

export async function GET() {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = getSupabaseAdmin() as any;
  const { data } = await db
    .from("subscriptions")
    .select("status, stripe_subscription_id")
    .eq("user_id", userId)
    .eq("status", "active")
    .limit(1);

  const hasActiveSubscription = Array.isArray(data) && data.length > 0;

  return NextResponse.json({ subscribed: hasActiveSubscription });
}
