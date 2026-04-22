import type { DisplayItem, SubagentMode, TaskExecutionResult } from "./types";
import {
  getTaskError,
  getTaskPreview,
  shortenHome,
  statusLabel,
  trimPreview,
} from "./utils";

export function formatToolCall(
  toolName: string,
  args: Record<string, unknown>,
  themeFg: (color: any, text: string) => string,
): string {
  switch (toolName) {
    case "bash": {
      const command = typeof args.command === "string" ? args.command : "...";
      return (
        themeFg("muted", "$ ") + themeFg("toolOutput", trimPreview(command, 72))
      );
    }
    case "read": {
      const filePath =
        typeof args.path === "string" ? shortenHome(args.path) : "...";
      const offset = typeof args.offset === "number" ? args.offset : undefined;
      const limit = typeof args.limit === "number" ? args.limit : undefined;
      let suffix = "";
      if (offset !== undefined || limit !== undefined) {
        const start = offset ?? 1;
        const end = limit !== undefined ? start + limit - 1 : undefined;
        suffix = `:${start}${end !== undefined ? `-${end}` : ""}`;
      }
      return (
        themeFg("muted", "read ") +
        themeFg("accent", filePath) +
        themeFg("warning", suffix)
      );
    }
    case "write": {
      const filePath =
        typeof args.path === "string" ? shortenHome(args.path) : "...";
      return themeFg("muted", "write ") + themeFg("accent", filePath);
    }
    case "edit": {
      const filePath =
        typeof args.path === "string" ? shortenHome(args.path) : "...";
      return themeFg("muted", "edit ") + themeFg("accent", filePath);
    }
    case "ls": {
      const filePath =
        typeof args.path === "string" ? shortenHome(args.path) : ".";
      return themeFg("muted", "ls ") + themeFg("accent", filePath);
    }
    case "find": {
      const pattern = typeof args.pattern === "string" ? args.pattern : "*";
      const filePath =
        typeof args.path === "string" ? shortenHome(args.path) : ".";
      return (
        themeFg("muted", "find ") +
        themeFg("accent", pattern) +
        themeFg("dim", ` in ${filePath}`)
      );
    }
    case "grep": {
      const pattern = typeof args.pattern === "string" ? args.pattern : "";
      const filePath =
        typeof args.path === "string" ? shortenHome(args.path) : ".";
      return (
        themeFg("muted", "grep ") +
        themeFg("accent", `/${pattern}/`) +
        themeFg("dim", ` in ${filePath}`)
      );
    }
    default:
      return (
        themeFg("accent", toolName) +
        themeFg("dim", ` ${trimPreview(JSON.stringify(args), 60)}`)
      );
  }
}

export function renderItemsCollapsed(
  items: readonly DisplayItem[],
  theme: any,
  limit: number,
): string {
  if (items.length === 0) return theme.fg("muted", "(no output)");
  const visible = items.slice(-limit);
  const skipped = items.length - visible.length;
  const lines: string[] = [];
  if (skipped > 0)
    lines.push(
      theme.fg(
        "muted",
        `... ${skipped} earlier item${skipped === 1 ? "" : "s"}`,
      ),
    );
  for (const item of visible) {
    if (item.type === "toolCall") {
      lines.push(
        theme.fg("muted", "→ ") +
          formatToolCall(item.name, item.args, theme.fg.bind(theme)),
      );
    } else {
      const preview = item.text.split("\n").slice(0, 3).join("\n").trim();
      lines.push(theme.fg("toolOutput", preview || "(empty text)"));
    }
  }
  return lines.join("\n");
}

export function buildProgressText(
  mode: SubagentMode,
  tasks: readonly TaskExecutionResult[],
): string {
  if (mode === "single") {
    const task = tasks[0];
    return `[${task.agent}] ${statusLabel(task.status)}\n${getTaskPreview(task)}`;
  }

  const done = tasks.filter(
    (task) => task.status !== "pending" && task.status !== "running",
  ).length;
  const running = tasks.length - done;
  const sections = tasks.map((task, index) => {
    const preview = trimPreview(getTaskPreview(task), 160);
    return `${index + 1}. [${task.agent}] ${statusLabel(task.status)}\n${preview}`;
  });
  return [
    `Parallel: ${done}/${tasks.length} done, ${running} running`,
    ...sections,
  ].join("\n\n");
}

function buildSingleToolText(result: TaskExecutionResult): string {
  if (result.status === "succeeded")
    return result.output.trim() || "(no output)";
  return [
    `[${result.agent}] ${statusLabel(result.status)}`,
    `Task: ${result.task}`,
    `Error: ${getTaskError(result)}`,
  ].join("\n");
}

function buildParallelToolText(
  results: readonly TaskExecutionResult[],
): string {
  return results
    .map((result, index) => {
      const body =
        result.status === "succeeded"
          ? result.output.trim() || "(no output)"
          : `Error: ${getTaskError(result)}`;
      return [
        `## Task ${index + 1} — ${result.agent} — ${statusLabel(result.status)}`,
        `Task: ${result.task}`,
        "",
        body,
      ].join("\n");
    })
    .join("\n\n");
}

export function buildToolText(
  mode: SubagentMode,
  results: readonly TaskExecutionResult[],
): string {
  return mode === "single"
    ? buildSingleToolText(results[0])
    : buildParallelToolText(results);
}
