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
