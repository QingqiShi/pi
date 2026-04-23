import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { basename } from "node:path";
import {
  BUILTIN_AGENTS,
  COMMON_SUBAGENT_PROMPT,
  buildSubagentPrompt,
} from "./agents";
import { SUBAGENT_CHILD_ENV } from "./constants";
import type { SubagentTask, TaskExecutionResult } from "./types";
import {
  appendAssistantItems,
  cloneTaskResult,
  getMessageText,
  getTaskError,
  makeTaskResult,
} from "./utils";

function getPiInvocation(args: string[]): { command: string; args: string[] } {
  const currentScript = process.argv[1];
  const isBunVirtualScript = currentScript?.startsWith("/$bunfs/root/");
  if (currentScript && !isBunVirtualScript && existsSync(currentScript)) {
    return { command: process.execPath, args: [currentScript, ...args] };
  }

  const execName = basename(process.execPath).toLowerCase();
  const isGenericRuntime = /^(node|bun)(\.exe)?$/.test(execName);
  if (!isGenericRuntime) {
    return { command: process.execPath, args };
  }

  return { command: "pi", args };
}

export async function runTask(
  task: SubagentTask,
  options: {
    cwd: string;
    modelArg?: string;
    thinkingLevel?: string;
    signal?: AbortSignal;
    onStateChange?: (result: TaskExecutionResult) => void;
  },
): Promise<TaskExecutionResult> {
  const agentConfig = BUILTIN_AGENTS[task.agent];
  const result = makeTaskResult(task.agent, task.task);
  const notify = () => options.onStateChange?.(cloneTaskResult(result));

  if (options.signal?.aborted) {
    result.status = "aborted";
    result.errorMessage = "Aborted by parent agent.";
    notify();
    return cloneTaskResult(result);
  }

  result.status = "running";
  notify();

  const args = [
    "--mode",
    "json",
    "-p",
    "--no-session",
    "--tools",
    agentConfig.tools.join(","),
  ];
  if (options.modelArg) args.push("--model", options.modelArg);
  if (options.thinkingLevel) args.push("--thinking", options.thinkingLevel);
  args.push(
    "--append-system-prompt",
    `${COMMON_SUBAGENT_PROMPT}\n\n${agentConfig.systemPrompt}`,
  );
  args.push(buildSubagentPrompt(task.task));

  const invocation = getPiInvocation(args);
  const child = spawn(invocation.command, invocation.args, {
    cwd: options.cwd,
    shell: false,
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      [SUBAGENT_CHILD_ENV]: "1",
    },
  });

  let aborted = false;
  let spawnError: Error | undefined;
  let stdoutBuffer = "";
  let killTimer: NodeJS.Timeout | undefined;

  const handleLine = (line: string) => {
    if (!line.trim()) return;

    let event: any;
    try {
      event = JSON.parse(line);
    } catch {
      return;
    }

    if (
      event.type === "message_update" &&
      event.message?.role === "assistant"
    ) {
      const text = getMessageText(event.message);
      if (text) {
        result.output = text;
        notify();
      }
      return;
    }

    if (event.type === "message_end" && event.message?.role === "assistant") {
      appendAssistantItems(event.message, result);
      result.usage.turns += 1;

      const usage = event.message.usage;
      if (usage) {
        result.usage.input += usage.input || 0;
        result.usage.output += usage.output || 0;
        result.usage.cacheRead += usage.cacheRead || 0;
        result.usage.cacheWrite += usage.cacheWrite || 0;
        result.usage.cost += usage.cost?.total || 0;
      }

      if (event.message.provider && event.message.model) {
        result.model = `${event.message.provider}/${event.message.model}`;
      } else if (event.message.model) {
        result.model = event.message.model;
      }

      if (typeof event.message.stopReason === "string")
        result.stopReason = event.message.stopReason;
      if (typeof event.message.errorMessage === "string")
        result.errorMessage = event.message.errorMessage;
      notify();
    }
  };

  const abortHandler = () => {
    aborted = true;
    result.status = "aborted";
    if (!result.errorMessage) result.errorMessage = "Aborted by parent agent.";
    notify();
    child.kill("SIGTERM");
    killTimer = setTimeout(() => {
      child.kill("SIGKILL");
    }, 5000);
  };

  if (options.signal) {
    options.signal.addEventListener("abort", abortHandler, { once: true });
  }

  child.stdout.on("data", (chunk) => {
    stdoutBuffer += chunk.toString();
    const lines = stdoutBuffer.split("\n");
    stdoutBuffer = lines.pop() ?? "";
    for (const line of lines) handleLine(line);
  });

  child.stderr.on("data", (chunk) => {
    result.stderr += chunk.toString();
  });

  child.on("error", (error) => {
    spawnError = error;
  });

  const exitCode = await new Promise<number>((resolve) => {
    child.on("close", (code) => {
      if (stdoutBuffer.trim()) handleLine(stdoutBuffer);
      resolve(code ?? 0);
    });
  });

  if (options.signal) options.signal.removeEventListener("abort", abortHandler);
  if (killTimer) clearTimeout(killTimer);

  result.exitCode = exitCode;

  if (aborted || result.stopReason === "aborted") {
    result.status = "aborted";
    if (!result.errorMessage) result.errorMessage = "Aborted by parent agent.";
  } else if (spawnError) {
    result.status = "failed";
    result.errorMessage = spawnError.message;
  } else if (exitCode !== 0 || result.stopReason === "error") {
    result.status = "failed";
    if (!result.errorMessage) result.errorMessage = getTaskError(result);
  } else {
    result.status = "succeeded";
  }

  if (
    !result.output.trim() &&
    (result.status === "failed" || result.status === "aborted") &&
    !result.errorMessage
  ) {
    result.errorMessage = getTaskError(result);
  }

  notify();
  return cloneTaskResult(result);
}
