/**
 * Global protected paths extension.
 *
 * Blocks file-tool access to paths that should stay off-limits.
 * Auto-discovered from ~/.pi/agent/extensions/.
 *
 * Covered tools: read, write, edit, ls, grep, find
 * Not covered: bash
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { homedir } from "node:os";
import { basename, resolve, sep } from "node:path";

const guardedTools = new Set(["read", "write", "edit", "ls", "grep", "find"]);
const protectedDirectoryNames = new Set([".git", "node_modules", ".ssh"]);
const protectedFilePatterns = [/^\.env(\..*)?$/i];
const protectedAbsolutePaths = [resolve(homedir(), ".pi", "agent", "auth.json")];

function normalizeToolPath(inputPath: string, cwd: string) {
	const normalizedInput = inputPath.startsWith("@") ? inputPath.slice(1) : inputPath;
	return resolve(cwd, normalizedInput);
}

function hasProtectedDirectorySegment(absolutePath: string) {
	return absolutePath
		.split(sep)
		.filter(Boolean)
		.some((segment) => protectedDirectoryNames.has(segment));
}

function isProtectedPath(absolutePath: string) {
	const fileName = basename(absolutePath);

	return (
		protectedAbsolutePaths.includes(absolutePath) ||
		protectedFilePatterns.some((pattern) => pattern.test(fileName)) ||
		hasProtectedDirectorySegment(absolutePath)
	);
}

export default function (pi: ExtensionAPI) {
	pi.on("tool_call", async (event, ctx) => {
		if (!guardedTools.has(event.toolName)) {
			return undefined;
		}

		const path = (event.input as { path?: unknown }).path;
		if (typeof path !== "string") {
			return undefined;
		}

		const absolutePath = normalizeToolPath(path, ctx.cwd);
		if (!isProtectedPath(absolutePath)) {
			return undefined;
		}

		const reason = `Path "${absolutePath}" is protected`;
		if (ctx.hasUI) {
			ctx.ui.notify(`Blocked ${event.toolName} on protected path: ${absolutePath}`, "warning");
		}

		return { block: true, reason };
	});
}
