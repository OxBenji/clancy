import { Sandbox } from "e2b";

export interface SandboxSession {
  sandbox: Sandbox;
  previewUrl: string | null;
}

/**
 * Creates an E2B sandbox, writes project files, installs deps,
 * and starts a dev server. Returns the sandbox + preview URL.
 *
 * Callers must call sandbox.kill() when done.
 */
export async function createProjectSandbox(): Promise<Sandbox> {
  const sandbox = await Sandbox.create({
    apiKey: process.env.E2B_API_KEY,
    timeoutMs: 5 * 60 * 1000, // 5 min timeout
  });
  return sandbox;
}

/**
 * Write a file into the sandbox.
 */
export async function writeFile(
  sandbox: Sandbox,
  path: string,
  content: string
): Promise<void> {
  await sandbox.files.write(path, content);
}

/**
 * Run a shell command in the sandbox and return stdout.
 * Throws on non-zero exit code.
 */
export async function runCommand(
  sandbox: Sandbox,
  cmd: string,
  opts?: { timeoutMs?: number; background?: boolean }
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const result = await sandbox.commands.run(cmd, {
    timeoutMs: opts?.timeoutMs ?? 60_000,
    background: opts?.background ?? false,
  });
  return {
    stdout: result.stdout,
    stderr: result.stderr,
    exitCode: result.exitCode ?? 0,
  };
}

/**
 * Get the public preview URL for a port running inside the sandbox.
 */
export function getPreviewUrl(sandbox: Sandbox, port: number = 3000): string {
  const host = sandbox.getHost(port);
  return `https://${host}`;
}

/**
 * Read a file from the sandbox.
 */
export async function readFile(
  sandbox: Sandbox,
  path: string
): Promise<string> {
  return await sandbox.files.read(path);
}

/**
 * List files in a directory inside the sandbox.
 */
export async function listFiles(
  sandbox: Sandbox,
  path: string = "/home/user"
): Promise<string[]> {
  const entries = await sandbox.files.list(path);
  return entries.map((e) => e.name);
}
