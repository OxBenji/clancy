import { Sandbox } from "e2b";

/**
 * Creates an E2B sandbox with a 15-minute timeout.
 */
export async function createProjectSandbox(): Promise<Sandbox> {
  if (!process.env.E2B_API_KEY) {
    throw new Error("E2B_API_KEY is not set — cannot create sandbox");
  }
  const sandbox = await Sandbox.create({
    apiKey: process.env.E2B_API_KEY,
    timeoutMs: 15 * 60 * 1000,
  });
  return sandbox;
}

/**
 * Extend the sandbox timeout (e.g. after build completes, give user time to preview).
 */
export async function extendSandboxTimeout(
  sandbox: Sandbox,
  timeoutMs: number = 10 * 60 * 1000
): Promise<void> {
  await sandbox.setTimeout(timeoutMs);
}

/**
 * Reconnect to an existing sandbox by ID.
 */
export async function reconnectSandbox(sandboxId: string): Promise<Sandbox> {
  if (!process.env.E2B_API_KEY) {
    throw new Error("E2B_API_KEY is not set — cannot connect to sandbox");
  }
  return await Sandbox.connect(sandboxId, {
    apiKey: process.env.E2B_API_KEY,
  });
}

/**
 * Write a single file into the sandbox.
 */
export async function writeFile(
  sandbox: Sandbox,
  path: string,
  content: string
): Promise<void> {
  await sandbox.files.write(path, content);
}

/**
 * Write multiple files into the sandbox at once.
 */
export async function writeFiles(
  sandbox: Sandbox,
  files: { path: string; data: string }[]
): Promise<void> {
  for (const file of files) {
    const dir = file.path.substring(0, file.path.lastIndexOf("/"));
    await sandbox.commands.run(`mkdir -p ${dir}`, { timeoutMs: 5_000 });
    await sandbox.files.write(file.path, file.data);
  }
}

/**
 * Run a shell command with real-time streaming callbacks.
 */
export async function runCommandStreaming(
  sandbox: Sandbox,
  cmd: string,
  opts: {
    timeoutMs?: number;
    background?: boolean;
    onStdout?: (line: string) => void;
    onStderr?: (line: string) => void;
  } = {}
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const result = await sandbox.commands.run(cmd, {
    timeoutMs: opts.timeoutMs ?? 60_000,
    background: opts.background ?? false,
    onStdout: opts.onStdout
      ? (data) => opts.onStdout!(String(data))
      : undefined,
    onStderr: opts.onStderr
      ? (data) => opts.onStderr!(String(data))
      : undefined,
  });
  return {
    stdout: result.stdout,
    stderr: result.stderr,
    exitCode: result.exitCode ?? 0,
  };
}

/**
 * Run a shell command (simple, no streaming).
 */
export async function runCommand(
  sandbox: Sandbox,
  cmd: string,
  opts?: { timeoutMs?: number; background?: boolean }
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return runCommandStreaming(sandbox, cmd, opts);
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
