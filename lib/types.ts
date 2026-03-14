export interface PlanTask {
  id: string;
  label: string;
  estimated_seconds: number;
  order_index: number;
  status: "pending" | "active" | "done" | "error";
  duration?: number;
}

export interface LogEntry {
  task_id: string;
  text: string;
  ts: number;
}

export interface FileEntry {
  path: string;
  content: string;
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  ts: number;
}
