import { homedir } from "node:os";
import type {
  DisplayItem,
  SubagentDetails,
  SubagentMode,
  SubagentTask,
  TaskExecutionResult,
  TaskStatus,
  UsageStats,
} from "./types";

export function emptyUsage(): UsageStats {
  return {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    cost: 0,
    turns: 0,
  };
}

export function cloneUsage(usage: UsageStats): UsageStats {
  return { ...usage };
}

export function cloneDisplayItem(item: DisplayItem): DisplayItem {
  return item.type === "text"
    ? { ...item }
    : { type: "toolCall", name: item.name, args: { ...item.args } };
}

export function cloneTaskResult(
  result: TaskExecutionResult,
): TaskExecutionResult {
  return {
    ...result,
    items: result.items.map(cloneDisplayItem),
    usage: cloneUsage(result.usage),
  };
}

export function sumUsage(results: readonly TaskExecutionResult[]): UsageStats {
  const total = emptyUsage();
  for (const result of results) {
    total.input += result.usage.input;
    total.output += result.usage.output;
    total.cacheRead += result.usage.cacheRead;
    total.cacheWrite += result.usage.cacheWrite;
    total.cost += result.usage.cost;
    total.turns += result.usage.turns;
  }
  return total;
}

export function makeTaskResult(
  agent: SubagentTask["agent"],
  task: string,
): TaskExecutionResult {
  return {
    agent,
    task,
    status: "pending",
    items: [],
    output: "",
    stderr: "",
    usage: emptyUsage(),
  };
}

export function makeDetails(
  mode: SubagentMode,
  tasks: readonly TaskExecutionResult[],
  aborted = false,
): SubagentDetails {
  const clonedTasks = tasks.map(cloneTaskResult);
  return {
    mode,
    tasks: clonedTasks,
    usage: sumUsage(clonedTasks),
    aborted,
  };
}

export function formatTokens(count: number): string {
  if (count < 1000) return count.toString();
  if (count < 10000) return `${(count / 1000).toFixed(1)}k`;
  if (count < 1_000_000) return `${Math.round(count / 1000)}k`;
  return `${(count / 1_000_000).toFixed(1)}M`;
}

export function formatUsage(usage: UsageStats, model?: string): string {
  const parts: string[] = [];
  if (usage.turns > 0)
    parts.push(`${usage.turns} turn${usage.turns === 1 ? "" : "s"}`);
  if (usage.input > 0) parts.push(`↑${formatTokens(usage.input)}`);
  if (usage.output > 0) parts.push(`↓${formatTokens(usage.output)}`);
  if (usage.cacheRead > 0) parts.push(`R${formatTokens(usage.cacheRead)}`);
  if (usage.cacheWrite > 0) parts.push(`W${formatTokens(usage.cacheWrite)}`);
  if (usage.cost > 0) parts.push(`$${usage.cost.toFixed(4)}`);
  if (model) parts.push(model);
  return parts.join(" ");
}

export function shortenHome(path: string): string {
  const home = homedir();
  return path.startsWith(home) ? `~${path.slice(home.length)}` : path;
}

export function trimPreview(text: string, maxLength: number): string {
  const flattened = text.replace(/\s+/g, " ").trim();
  if (flattened.length <= maxLength) return flattened;
  return `${flattened.slice(0, maxLength - 3)}...`;
}

export function getTaskError(result: TaskExecutionResult): string {
  return (
    result.errorMessage?.trim() ||
    result.stderr.trim() ||
    result.output.trim() ||
    (result.exitCode !== undefined
      ? `Subagent exited with code ${result.exitCode}.`
      : "Subagent failed.")
  );
}

export function getTaskPreview(result: TaskExecutionResult): string {
  if (result.output.trim()) return result.output.trim();
  for (let i = result.items.length - 1; i >= 0; i--) {
    const item = result.items[i];
    if (item.type === "text" && item.text.trim()) return item.text.trim();
  }
  if (result.status === "failed" || result.status === "aborted")
    return getTaskError(result);
  if (result.status === "running" || result.status === "pending")
    return "(running...)";
  return "(no output)";
}

export function getMessageText(message: any): string {
  if (!message || !Array.isArray(message.content)) return "";
  return message.content
    .filter(
      (part: any) => part?.type === "text" && typeof part.text === "string",
    )
    .map((part: any) => part.text)
    .join("\n\n")
    .trim();
}

export function appendAssistantItems(
  message: any,
  result: TaskExecutionResult,
) {
  if (!message || !Array.isArray(message.content)) return;

  for (const part of message.content) {
    if (part?.type === "toolCall" && typeof part.name === "string") {
      result.items.push({
        type: "toolCall",
        name: part.name,
        args:
          typeof part.arguments === "object" && part.arguments
            ? { ...part.arguments }
            : {},
      });
    }
  }

  const text = getMessageText(message);
  if (text) {
    result.output = text;
    result.items.push({ type: "text", text });
  }
}

export function statusIcon(status: TaskStatus, theme: any): string {
  switch (status) {
    case "succeeded":
      return theme.fg("success", "✓");
    case "failed":
      return theme.fg("error", "✗");
    case "aborted":
      return theme.fg("warning", "⏹");
    case "pending":
    case "running":
    default:
      return theme.fg("warning", "⏳");
  }
}

export function statusLabel(status: TaskStatus): string {
  switch (status) {
    case "succeeded":
      return "succeeded";
    case "failed":
      return "failed";
    case "aborted":
      return "aborted";
    case "pending":
    case "running":
    default:
      return "running";
  }
}

export function hasFailures(results: readonly TaskExecutionResult[]): boolean {
  return results.some(
    (result) => result.status === "failed" || result.status === "aborted",
  );
}
