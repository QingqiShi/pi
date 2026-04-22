/**
 * Global protected paths extension.
 *
 * Blocks file-tool access to protected paths configured via `protectedPaths`
 * in settings.json.
 *
 * Covered read tools: read, ls, grep, find
 * Covered write tools: write, edit
 * Not covered: bash
 *
 * Config format:
 * {
 *   "protectedPaths": {
 *     ".git": ["read", "write"],
 *     ".ssh": ["read", "write"],
 *     ".env*": ["read", "write"],
 *     "~/.pi/agent/auth.json": ["read", "write"],
 *     "node_modules": ["write"],
 *     "src/generated/**": ["write"]
 *   }
 * }
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { posix, relative, resolve } from "node:path";

const readTools = new Set(["read", "ls", "grep", "find"]);
const writeTools = new Set(["write", "edit"]);
const agentDir = process.env.PI_CODING_AGENT_DIR ?? resolve(homedir(), ".pi", "agent");

type AccessMode = "read" | "write";
type MatchType = "absolute" | "relative" | "segment";

type ProtectedPathsConfig = Record<string, AccessMode[]>;

type SettingsFile = {
	protectedPaths?: unknown;
};

type CompiledRule = {
	pattern: string;
	normalizedPattern: string;
	deniedModes: Set<AccessMode>;
	matchType: MatchType;
};

const WINDOWS_ABSOLUTE_PATH = /^[A-Za-z]:\//;
const WINDOWS_ABSOLUTE_ROOT = /^[A-Za-z]:\/$/;

function normalizeAccessModes(value: unknown): AccessMode[] {
	if (!Array.isArray(value)) return [];
	return value.filter((mode): mode is AccessMode => mode === "read" || mode === "write");
}

function normalizeProtectedPathsConfig(input: unknown): ProtectedPathsConfig {
	if (!input || typeof input !== "object" || Array.isArray(input)) {
		return {};
	}

	const config: ProtectedPathsConfig = {};
	for (const [pattern, deniedModes] of Object.entries(input as Record<string, unknown>)) {
		if (!pattern.trim() || !Array.isArray(deniedModes)) continue;
		config[pattern] = normalizeAccessModes(deniedModes);
	}

	return config;
}

function getDefaultConfig(): ProtectedPathsConfig {
	return {
		".git": ["read", "write"],
		".ssh": ["read", "write"],
		".env*": ["read", "write"],
		"~/.pi/agent/auth.json": ["read", "write"],
		"node_modules": ["write"],
	};
}

async function loadConfigFromFile(settingsPath: string): Promise<ProtectedPathsConfig> {
	try {
		const raw = await readFile(settingsPath, "utf8");
		const parsed = JSON.parse(raw) as SettingsFile;
		return normalizeProtectedPathsConfig(parsed.protectedPaths);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") {
			return {};
		}

		console.warn(`[protected-paths] Failed to load ${settingsPath}:`, error);
		return {};
	}
}

function normalizeForMatching(input: string) {
	const normalized = posix.normalize(input.replace(/\\/g, "/"));
	if (normalized === "/" || WINDOWS_ABSOLUTE_ROOT.test(normalized)) {
		return normalized;
	}
	return normalized.replace(/\/+$/, "");
}

function expandHome(input: string) {
	if (input === "~") return homedir();
	if (input.startsWith("~/")) return resolve(homedir(), input.slice(2));
	return input;
}

function normalizePattern(pattern: string) {
	return normalizeForMatching(expandHome(pattern.trim()));
}

function getMatchType(normalizedPattern: string): MatchType {
	if (normalizedPattern.startsWith("/") || WINDOWS_ABSOLUTE_PATH.test(normalizedPattern)) return "absolute";
	if (normalizedPattern.includes("/")) return "relative";
	return "segment";
}

function compileRules(config: ProtectedPathsConfig): CompiledRule[] {
	return Object.entries(config)
		.map(([pattern, deniedModes]) => {
			const normalizedPattern = normalizePattern(pattern);
			const modes = normalizeAccessModes(deniedModes);
			if (!normalizedPattern || modes.length === 0) return undefined;

			return {
				pattern,
				normalizedPattern,
				deniedModes: new Set(modes),
				matchType: getMatchType(normalizedPattern),
			} as CompiledRule;
		})
		.filter((rule): rule is CompiledRule => rule !== undefined);
}

async function loadProtectedPathRules(cwd: string) {
	const globalConfig = await loadConfigFromFile(resolve(agentDir, "settings.json"));
	const projectConfig = await loadConfigFromFile(resolve(cwd, ".pi", "settings.json"));
	return compileRules({
		...getDefaultConfig(),
		...globalConfig,
		...projectConfig,
	});
}

function matchesGlob(path: string, pattern: string) {
	if (posix.matchesGlob(path, pattern)) {
		return true;
	}

	if (pattern !== "**" && pattern.endsWith("/**")) {
		const prefix = pattern.slice(0, -3);
		return path === prefix || path.startsWith(`${prefix}/`);
	}

	return false;
}

function matchesRule(absolutePath: string, cwd: string, rule: CompiledRule) {
	if (rule.matchType === "absolute") {
		return matchesGlob(absolutePath, rule.normalizedPattern);
	}

	if (rule.matchType === "relative") {
		const relativePath = normalizeForMatching(relative(cwd, absolutePath) || ".");
		return matchesGlob(relativePath, rule.normalizedPattern);
	}

	const pathSegments = absolutePath.split("/").filter(Boolean);
	return pathSegments.some((segment) => matchesGlob(segment, rule.normalizedPattern));
}

function normalizeToolPath(inputPath: string, cwd: string) {
	const normalizedInput = inputPath.startsWith("@") ? inputPath.slice(1) : inputPath;
	return normalizeForMatching(resolve(cwd, normalizedInput));
}

function getModeForTool(toolName: string): AccessMode | undefined {
	if (readTools.has(toolName)) return "read";
	if (writeTools.has(toolName)) return "write";
	return undefined;
}

export default function (pi: ExtensionAPI) {
	let compiledRules = compileRules(getDefaultConfig());

	pi.on("session_start", async (_event, ctx) => {
		compiledRules = await loadProtectedPathRules(ctx.cwd);
	});

	pi.on("tool_call", async (event, ctx) => {
		const mode = getModeForTool(event.toolName);
		if (!mode) {
			return undefined;
		}

		const path = (event.input as { path?: unknown }).path;
		if (typeof path !== "string") {
			return undefined;
		}

		const absolutePath = normalizeToolPath(path, ctx.cwd);
		const matchedRule = compiledRules.find(
			(rule) => rule.deniedModes.has(mode) && matchesRule(absolutePath, ctx.cwd, rule),
		);
		if (!matchedRule) {
			return undefined;
		}

		const reason = `Path "${absolutePath}" is protected for ${mode} access by rule "${matchedRule.pattern}"`;
		if (ctx.hasUI) {
			ctx.ui.notify(`Blocked ${event.toolName} on protected path: ${absolutePath}`, "warning");
		}

		return { block: true, reason };
	});
}
