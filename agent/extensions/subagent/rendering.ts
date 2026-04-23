import { getMarkdownTheme, keyHint } from "@mariozechner/pi-coding-agent";
import { Container, Markdown, Spacer, Text } from "@mariozechner/pi-tui";
import { BUILTIN_AGENTS } from "./agents";
import {
  COLLAPSED_ITEM_COUNT,
  COLLAPSED_TASK_PREVIEW_COUNT,
} from "./constants";
import { formatToolCall, renderItemsCollapsed } from "./formatting";
import type { BuiltinAgentName, SubagentDetails } from "./types";
import { formatUsage, getTaskError, statusIcon, trimPreview } from "./utils";

export function renderSubagentCall(args: any, theme: any) {
  const tasks = Array.isArray(args.tasks) ? args.tasks : [];
  if (tasks.length <= 1) {
    const task = tasks[0];
    const agent = task?.agent ?? "explorer";
    const preview = trimPreview(task?.task ?? "", 80) || "...";
    return new Text(
      theme.fg("toolTitle", theme.bold("subagent ")) +
        theme.fg("accent", agent) +
        theme.fg(
          "muted",
          ` (${BUILTIN_AGENTS[agent as BuiltinAgentName]?.purpose ?? "task"})`,
        ) +
        `\n  ${theme.fg("dim", preview)}`,
      0,
      0,
    );
  }

  let text =
    theme.fg("toolTitle", theme.bold("subagent ")) +
    theme.fg("accent", `parallel (${tasks.length} tasks)`);
  for (const task of tasks.slice(0, COLLAPSED_TASK_PREVIEW_COUNT)) {
    text += `\n  ${theme.fg("accent", task.agent)}${theme.fg("dim", ` ${trimPreview(task.task, 56)}`)}`;
  }
  if (tasks.length > COLLAPSED_TASK_PREVIEW_COUNT) {
    text += `\n  ${theme.fg("muted", `... +${tasks.length - COLLAPSED_TASK_PREVIEW_COUNT} more`)}`;
  }
  return new Text(text, 0, 0);
}

export function renderSubagentResult(
  result: any,
  { expanded }: { expanded: boolean },
  theme: any,
) {
  const details = result.details as SubagentDetails | undefined;
  const mdTheme = getMarkdownTheme();
  const expandHint = theme.fg(
    "muted",
    `(${keyHint("app.tools.expand", "to expand")})`,
  );

  if (!details || details.tasks.length === 0) {
    const text = result.content[0];
    return new Text(text?.type === "text" ? text.text : "(no output)", 0, 0);
  }

  const running = details.tasks.filter(
    (task) => task.status === "pending" || task.status === "running",
  ).length;
  const succeeded = details.tasks.filter(
    (task) => task.status === "succeeded",
  ).length;
  const failed = details.tasks.filter(
    (task) => task.status === "failed",
  ).length;
  const abortedCount = details.tasks.filter(
    (task) => task.status === "aborted",
  ).length;
  const aggregateUsage = formatUsage(details.usage);

  const headerText = () => {
    if (details.mode === "single") {
      const task = details.tasks[0];
      return `${statusIcon(task.status, theme)} ${theme.fg("toolTitle", theme.bold(task.agent))}${theme.fg("muted", ` (${BUILTIN_AGENTS[task.agent].purpose})`)}`;
    }

    const icon =
      running > 0
        ? theme.fg("warning", "⏳")
        : failed > 0 || abortedCount > 0
          ? succeeded > 0
            ? theme.fg("warning", "◐")
            : theme.fg("error", "✗")
          : theme.fg("success", "✓");
    const status =
      running > 0
        ? `${details.tasks.length - running}/${details.tasks.length} done, ${running} running`
        : `${succeeded}/${details.tasks.length} succeeded${failed > 0 || abortedCount > 0 ? `, ${failed + abortedCount} incomplete` : ""}`;
    return `${icon} ${theme.fg("toolTitle", theme.bold("parallel "))}${theme.fg("accent", status)}`;
  };

  if (!expanded) {
    if (details.mode === "single") {
      const task = details.tasks[0];
      let text = headerText();
      text += `\n${renderItemsCollapsed(task.items, theme, COLLAPSED_ITEM_COUNT)}`;
      if (
        (task.status === "failed" || task.status === "aborted") &&
        task.errorMessage
      ) {
        text += `\n${theme.fg("error", `Error: ${task.errorMessage}`)}`;
      }
      const usage = formatUsage(task.usage, task.model);
      if (usage) text += `\n${theme.fg("dim", usage)}`;
      if (task.items.length > COLLAPSED_ITEM_COUNT) text += `\n${expandHint}`;
      return new Text(text, 0, 0);
    }

    let text = headerText();
    for (const task of details.tasks) {
      text += `\n\n${theme.fg("muted", "─── ")}${theme.fg("accent", task.agent)} ${statusIcon(task.status, theme)}`;
      text += `\n${theme.fg("dim", trimPreview(task.task, 100))}`;
      text += `\n${renderItemsCollapsed(task.items, theme, 5)}`;
      if (
        (task.status === "failed" || task.status === "aborted") &&
        task.errorMessage
      ) {
        text += `\n${theme.fg("error", `Error: ${task.errorMessage}`)}`;
      }
    }
    if (aggregateUsage)
      text += `\n\n${theme.fg("dim", `Total: ${aggregateUsage}`)}`;
    text += `\n${expandHint}`;
    return new Text(text, 0, 0);
  }

  const container = new Container();
  container.addChild(new Text(headerText(), 0, 0));

  for (const task of details.tasks) {
    container.addChild(new Spacer(1));
    container.addChild(
      new Text(
        `${theme.fg("muted", "─── ")}${theme.fg("accent", task.agent)} ${statusIcon(task.status, theme)}`,
        0,
        0,
      ),
    );
    container.addChild(new Text(theme.fg("muted", "Task:"), 0, 0));
    container.addChild(new Text(theme.fg("dim", task.task), 0, 0));

    if (task.items.length > 0) {
      container.addChild(new Spacer(1));
      container.addChild(new Text(theme.fg("muted", "Trace:"), 0, 0));
      for (const item of task.items) {
        if (item.type === "toolCall") {
          container.addChild(
            new Text(
              theme.fg("muted", "→ ") +
                formatToolCall(item.name, item.args, theme.fg.bind(theme)),
              0,
              0,
            ),
          );
        }
      }
    }

    container.addChild(new Spacer(1));
    container.addChild(new Text(theme.fg("muted", "Output:"), 0, 0));
    if (task.output.trim()) {
      container.addChild(new Markdown(task.output.trim(), 0, 0, mdTheme));
    } else if (task.status === "failed" || task.status === "aborted") {
      container.addChild(new Text(theme.fg("error", getTaskError(task)), 0, 0));
    } else {
      container.addChild(new Text(theme.fg("muted", "(no output)"), 0, 0));
    }

    const usage = formatUsage(task.usage, task.model);
    if (usage) {
      container.addChild(new Spacer(1));
      container.addChild(new Text(theme.fg("dim", usage), 0, 0));
    }
  }

  if (aggregateUsage) {
    container.addChild(new Spacer(1));
    container.addChild(
      new Text(theme.fg("dim", `Total: ${aggregateUsage}`), 0, 0),
    );
  }

  return container;
}
