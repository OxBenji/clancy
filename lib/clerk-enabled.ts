/**
 * Returns true only when the Clerk publishable key looks like a real key,
 * not a placeholder like "pk_test_..." from the .env template.
 */
export function isClerkConfigured(): boolean {
  const key = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
  return !!key && key.startsWith("pk_") && key.length > 20;
}
