/**
 * Global protected paths extension.
 *
 * Blocks file-tool access to configured protected paths.
 * Auto-discovered from ~/.pi/agent/extensions/.
 *
 * Covered read tools: read, ls, grep, find
 * Covered write tools: write, edit
 * Not covered: bash
 *
 * Configuration lives under `protectedPaths` in settings.json.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, resolve, sep } from "node:path";

const readTools = new Set(["read", "ls", "grep", "find"]);
const writeTools = new Set(["write", "edit"]);
const agentDir = process.env.PI_CODING_AGENT_DIR ?? resolve(homedir(), ".pi", "agent");

type RuleSetConfig = {
	directoryNames?: string[];
	filePatterns?: string[];
	absolutePaths?: string[];
};

type ProtectedPathsConfig = {
	read?: RuleSetConfig;
	write?: RuleSetConfig;
};

type SettingsFile = {
	protectedPaths?: ProtectedPathsConfig;
};

type ResolvedRuleSet = {
	directoryNames: Set<string>;
	filePatterns: RegExp[];
	absolutePaths: Set<string>;
};

type ResolvedProtectedPathsConfig = {
	read: ResolvedRuleSet;
	write: ResolvedRuleSet;
};

function deepMerge<T extends Record<string, unknown>>(base: T, overrides: Partial<T>): T {
	const result = { ...base } as T;

	for (const key of Object.keys(overrides) as Array<keyof T>) {
		const overrideValue = overrides[key];
		const baseValue = base[key];
		if (overrideValue === undefined) continue;

		if (
			typeof overrideValue === "object" &&
			overrideValue !== null &&
			!Array.isArray(overrideValue) &&
			typeof baseValue === "object" &&
			baseValue !== null &&
			!Array.isArray(baseValue)
		) {
			result[key] = deepMerge(
				baseValue as Record<string, unknown>,
				overrideValue as Partial<Record<string, unknown>>,
			) as T[keyof T];
		} else {
			result[key] = overrideValue as T[keyof T];
		}
	}

	return result;
}

function normalizeToolPath(inputPath: string, cwd: string) {
	const normalizedInput = inputPath.startsWith("@") ? inputPath.slice(1) : inputPath;
	return resolve(cwd, normalizedInput);
}

function expandConfiguredPath(inputPath: string, baseDir: string) {
	if (inputPath === "~") return homedir();
	if (inputPath.startsWith("~/")) return resolve(homedir(), inputPath.slice(2));
	return resolve(baseDir, inputPath);
}

function normalizeRuleSet(input: unknown, baseDir: string): RuleSetConfig {
	if (!input || typeof input !== "object" || Array.isArray(input)) {
		return {};
	}

	const value = input as Record<string, unknown>;
	const directoryNames = Array.isArray(value.directoryNames)
		? value.directoryNames.filter((entry): entry is string => typeof entry === "string")
		: undefined;
	const filePatterns = Array.isArray(value.filePatterns)
		? value.filePatterns.filter((entry): entry is string => typeof entry === "string")
		: undefined;
	const absolutePaths = Array.isArray(value.absolutePaths)
		? value.absolutePaths
				.filter((entry): entry is string => typeof entry === "string")
				.map((entry) => expandConfiguredPath(entry, baseDir))
		: undefined;

	return { directoryNames, filePatterns, absolutePaths };
}

async function loadConfigFromFile(settingsPath: string, baseDir: string): Promise<ProtectedPathsConfig> {
	try {
		const raw = await readFile(settingsPath, "utf8");
		const parsed = JSON.parse(raw) as SettingsFile;
		return {
			read: normalizeRuleSet(parsed.protectedPaths?.read, baseDir),
			write: normalizeRuleSet(parsed.protectedPaths?.write, baseDir),
		};
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") {
			return {};
		}

		console.warn(`[protected-paths] Failed to load ${settingsPath}:`, error);
		return {};
	}
}

function compileRuleSet(ruleSet?: RuleSetConfig): ResolvedRuleSet {
	return {
		directoryNames: new Set((ruleSet?.directoryNames ?? []).map((entry) => entry.toLowerCase())),
		filePatterns: (ruleSet?.filePatterns ?? []).map((pattern) => new RegExp(pattern, "i")),
		absolutePaths: new Set(ruleSet?.absolutePaths ?? []),
	};
}

function getDefaultConfig(): ProtectedPathsConfig {
	return {
		read: {
			directoryNames: [".git", ".ssh"],
			filePatterns: ["^\\.env(\\..*)?$"],
			absolutePaths: [resolve(agentDir, "auth.json")],
		},
		write: {
			directoryNames: [".git", "node_modules", ".ssh"],
			filePatterns: ["^\\.env(\\..*)?$"],
			absolutePaths: [resolve(agentDir, "auth.json")],
		},
	};
}

async function loadProtectedPathsConfig(cwd: string): Promise<ResolvedProtectedPathsConfig> {
	const defaultConfig = getDefaultConfig();
	const globalConfig = await loadConfigFromFile(resolve(agentDir, "settings.json"), agentDir);
	const projectConfig = await loadConfigFromFile(resolve(cwd, ".pi", "settings.json"), resolve(cwd, ".pi"));
	const merged = deepMerge(deepMerge(defaultConfig, globalConfig), projectConfig);

	return {
		read: compileRuleSet(merged.read),
		write: compileRuleSet(merged.write),
	};
}

function hasProtectedDirectorySegment(absolutePath: string, directoryNames: Set<string>) {
	return absolutePath
		.split(sep)
		.filter(Boolean)
		.some((segment) => directoryNames.has(segment.toLowerCase()));
}

function isProtectedPath(absolutePath: string, ruleSet: ResolvedRuleSet) {
	const fileName = basename(absolutePath);

	return (
		ruleSet.absolutePaths.has(absolutePath) ||
		ruleSet.filePatterns.some((pattern) => pattern.test(fileName)) ||
		hasProtectedDirectorySegment(absolutePath, ruleSet.directoryNames)
	);
}

export default function (pi: ExtensionAPI) {
	let protectedPathsConfig: ResolvedProtectedPathsConfig = {
		read: compileRuleSet(getDefaultConfig().read),
		write: compileRuleSet(getDefaultConfig().write),
	};

	pi.on("session_start", async (_event, ctx) => {
		protectedPathsConfig = await loadProtectedPathsConfig(ctx.cwd);
	});

	pi.on("tool_call", async (event, ctx) => {
		const mode = readTools.has(event.toolName) ? "read" : writeTools.has(event.toolName) ? "write" : undefined;
		if (!mode) {
			return undefined;
		}

		const path = (event.input as { path?: unknown }).path;
		if (typeof path !== "string") {
			return undefined;
		}

		const absolutePath = normalizeToolPath(path, ctx.cwd);
		const ruleSet = protectedPathsConfig[mode];
		if (!isProtectedPath(absolutePath, ruleSet)) {
			return undefined;
		}

		const reason = `Path "${absolutePath}" is protected for ${mode} access`;
		if (ctx.hasUI) {
			ctx.ui.notify(`Blocked ${event.toolName} on protected path: ${absolutePath}`, "warning");
		}

		return { block: true, reason };
	});
}
