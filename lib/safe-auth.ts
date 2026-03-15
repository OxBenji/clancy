import { auth } from "@clerk/nextjs/server";

/**
 * Wrapper around Clerk's auth() that returns null userId when Clerk
 * isn't properly configured (e.g. dummy/test keys in .env).
 */
export async function safeAuth(): Promise<{ userId: string | null }> {
  try {
    return await auth();
  } catch {
    return { userId: null };
  }
}
