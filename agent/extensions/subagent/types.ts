export type BuiltinAgentName = "explorer" | "generic";
export type TaskStatus =
  | "pending"
  | "running"
  | "succeeded"
  | "failed"
  | "aborted";
export type SubagentMode = "single" | "parallel";

export type DisplayItem =
  | { type: "text"; text: string }
  | { type: "toolCall"; name: string; args: Record<string, unknown> };

export interface UsageStats {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  cost: number;
  turns: number;
}

export interface SubagentTask {
  agent: BuiltinAgentName;
  task: string;
}

export interface SubagentParams {
  tasks: SubagentTask[];
}

export interface TaskExecutionResult {
  agent: BuiltinAgentName;
  task: string;
  status: TaskStatus;
  items: DisplayItem[];
  output: string;
  stderr: string;
  usage: UsageStats;
  model?: string;
  stopReason?: string;
  errorMessage?: string;
  exitCode?: number;
}

export interface SubagentDetails {
  mode: SubagentMode;
  tasks: TaskExecutionResult[];
  usage: UsageStats;
  aborted: boolean;
}

export interface BuiltinAgentConfig {
  tools: string[];
  systemPrompt: string;
  purpose: string;
}
