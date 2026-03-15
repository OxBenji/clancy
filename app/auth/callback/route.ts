import { NextResponse } from "next/server";

// Clerk handles auth callbacks automatically via middleware.
// This route just redirects to dashboard as a fallback.
export async function GET(request: Request) {
  const { origin } = new URL(request.url);
  return NextResponse.redirect(`${origin}/dashboard`);
}
