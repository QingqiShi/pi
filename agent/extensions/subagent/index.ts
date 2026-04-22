import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { subagentParamsSchema } from "./agents";
import { SUBAGENT_CHILD_ENV } from "./constants";
import { buildProgressText, buildToolText } from "./formatting";
import { renderSubagentCall, renderSubagentResult } from "./rendering";
import { runTask } from "./runner";
import type { SubagentMode, SubagentParams } from "./types";
import { hasFailures, makeDetails, makeTaskResult } from "./utils";

export default function subagentExtension(pi: ExtensionAPI) {
  if (process.env[SUBAGENT_CHILD_ENV] === "1") {
    return;
  }

  pi.on("before_agent_start", async (event) => {
    const selectedTools = event.systemPromptOptions.selectedTools ?? [];
    if (!selectedTools.includes("subagent")) return undefined;

    return {
      systemPrompt:
        event.systemPrompt +
        `\n\n## Subagent Guidance\n\n- Consider the \`subagent\` tool for non-trivial tasks when isolation, parallelism, or fresh reconnaissance would help.\n- Use \`explorer\` for unfamiliar, broad, or higher-risk areas where mapping files, symbols, call paths, and dependencies first will reduce mistakes.\n- Do not treat \`explorer\` as a mandatory first step when the task is already well-scoped, you already have enough context, or the user wants direct implementation.\n- Use \`generic\` for direct delegated work when the target files or actions are already clear, or after \`explorer\` when a follow-up execution pass would help.\n- Avoid parallel \`generic\` tasks when they may touch overlapping files.`,
    };
  });

  pi.registerTool({
    name: "subagent",
    label: "Subagent",
    description:
      "Delegate one or more tasks to isolated built-in subagents. Use explorer for unfamiliar or broad read-only reconnaissance, and use generic for direct delegated work when the target is already clear.",
    promptSnippet:
      "Delegate tasks to isolated subagents. Use explorer for broad or unfamiliar reconnaissance; use generic when the work is already well-scoped.",
    promptGuidelines: [
      "Use subagent for non-trivial tasks when isolation, parallelism, or fresh reconnaissance will help more than doing everything in the main context.",
      "Use subagent with explorer to map unfamiliar or risky areas before editing, but only when that reconnaissance adds real value.",
      "Skip explorer when the task is already well-scoped, you already know the relevant files, or you just need to execute a clear next step.",
      "Use subagent with generic for direct delegated work when the target files or actions are already known, or after explorer when a follow-up execution pass would help.",
      "Avoid parallel generic tasks that may read or write overlapping files.",
    ],
    parameters: subagentParamsSchema as any,

    async execute(_toolCallId, params: SubagentParams, signal, onUpdate, ctx) {
      const tasks = params.tasks ?? [];
      const mode: SubagentMode = tasks.length === 1 ? "single" : "parallel";
      const currentResults = tasks.map((task) =>
        makeTaskResult(task.agent, task.task),
      );
      let aborted = false;

      const modelArg = ctx.model
        ? `${ctx.model.provider}/${ctx.model.id}`
        : undefined;
      const thinkingLevel = pi.getThinkingLevel();

      const emitUpdate = () => {
        onUpdate?.({
          content: [
            { type: "text", text: buildProgressText(mode, currentResults) },
          ],
          details: makeDetails(mode, currentResults, aborted),
        });
      };

      const abortListener = () => {
        aborted = true;
        for (const result of currentResults) {
          if (result.status === "pending" || result.status === "running") {
            result.status = "aborted";
            if (!result.errorMessage)
              result.errorMessage = "Aborted by parent agent.";
          }
        }
        emitUpdate();
      };

      if (signal) {
        if (signal.aborted) abortListener();
        else signal.addEventListener("abort", abortListener, { once: true });
      }

      emitUpdate();

      const finalResults = await Promise.all(
        tasks.map((task, index) =>
          runTask(task, {
            cwd: ctx.cwd,
            modelArg,
            thinkingLevel,
            signal,
            onStateChange: (result) => {
              currentResults[index] = result;
              emitUpdate();
            },
          }),
        ),
      );

      if (signal) signal.removeEventListener("abort", abortListener);

      const details = makeDetails(
        mode,
        finalResults,
        aborted || finalResults.some((result) => result.status === "aborted"),
      );
      const isError = details.aborted || hasFailures(finalResults);
      const text = buildToolText(mode, finalResults);

      return {
        content: [{ type: "text", text }],
        details,
        isError,
      };
    },

    renderCall: renderSubagentCall,
    renderResult: renderSubagentResult,
  } as any);
}
