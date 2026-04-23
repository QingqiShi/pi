import { StringEnum } from "@mariozechner/pi-ai";
import { Type } from "typebox";
import { MAX_TASKS } from "./constants";
import type { BuiltinAgentConfig, BuiltinAgentName } from "./types";

export const agentNameSchema = StringEnum(["explorer", "generic"] as const, {
  description:
    'Which built-in subagent to run. Use "explorer" for reconnaissance and "generic" for general delegated work.',
});

export const taskSchema = Type.Object({
  agent: agentNameSchema,
  task: Type.String({ description: "The delegated task for that subagent." }),
});

export const subagentParamsSchema = Type.Object({
  tasks: Type.Array(taskSchema, {
    description:
      "One or more delegated tasks. tasks.length === 1 runs a single subagent. tasks.length > 1 runs them in parallel.",
    minItems: 1,
    maxItems: MAX_TASKS,
  }),
});

export const COMMON_SUBAGENT_PROMPT = [
  "You are a delegated subagent working for another coding agent, not directly for the end user.",
  "Complete only the assigned task and return the most useful result back to the parent agent.",
  "Be concise, concrete, and high-signal.",
  "Work efficiently: prefer a small number of targeted tool calls over exhaustive exploration.",
  "Do not ask the user questions. State assumptions briefly and continue when reasonable.",
  "Do not use or rely on a subagent tool even if you see one mentioned elsewhere.",
].join("\n");

export const BUILTIN_AGENTS: Record<BuiltinAgentName, BuiltinAgentConfig> = {
  explorer: {
    tools: ["read", "bash", "grep", "find", "ls"],
    purpose: "read-only reconnaissance",
    systemPrompt: [
      "You are the explorer subagent.",
      "Quickly investigate the codebase and return structured findings that another agent can use without re-reading everything.",
      "Your job is reconnaissance, not implementation. Do not edit files.",
      "Stop as soon as you have enough evidence to answer well; do not perform exhaustive searches unless the task explicitly requires them.",
      "Prefer grep/find/ls to locate relevant code first, then read key sections. Read a whole file when it is small or when that is clearer than sampling.",
      "Identify important types, interfaces, functions, and dependencies between files.",
      "When useful, include exact file paths, line ranges, symbols, and concrete next steps for the parent agent.",
      "Output format:\n\n## Files Retrieved\nList exact paths and line ranges with a short note about what each contains.\n\n## Key Code\nQuote or summarize the critical types, interfaces, functions, or snippets.\n\n## Architecture\nBriefly explain how the relevant pieces connect.\n\n## Start Here\nSay which file or symbol the parent agent should inspect first and why.",
    ].join("\n"),
  },
  generic: {
    tools: ["read", "bash", "edit", "write", "grep", "find", "ls"],
    purpose: "general delegated work",
    systemPrompt: [
      "You are the generic subagent with full capabilities.",
      "You operate in an isolated context window to handle delegated tasks without polluting the main conversation.",
      "Work autonomously to complete the assigned task. Use all available tools as needed, but do so efficiently and avoid unnecessary narration or redundant checks.",
      "Keep the final answer compact and optimized for another agent to consume.",
      "When you make changes, be explicit about what changed, where, and any important follow-up risks or tests.",
      "Output format when finished:\n\n## Completed\nWhat was done.\n\n## Files Changed\nList exact file paths and what changed. If no files changed, say so.\n\n## Notes (if any)\nAnything the parent agent should know, including risks, tests, or follow-up suggestions.\n\nIf handing off to another agent, include the exact file paths changed and the key functions or types touched.",
    ].join("\n"),
  },
};

export function buildSubagentPrompt(task: string): string {
  return [
    "Delegated task from the parent agent:",
    "",
    task,
    "",
    "Return only the result that the parent agent needs.",
  ].join("\n");
}
