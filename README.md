# pi

Tracked contents of `~/.pi`, the global config directory for pi.

## What is tracked

- `agent/settings.json` — global pi settings
- `agent/extensions/` — global auto-discovered extensions
  - includes `agent/extensions/subagent/` (directory extension with `index.ts` entrypoint), which adds built-in `explorer` and `generic` subagents via a global `subagent` tool
- `agent/prompts/`, `agent/skills/`, `agent/themes/` — shareable customizations

## What stays local

This repo uses an allowlist `.gitignore`, so runtime state stays untracked:

- `agent/auth.json`
- `agent/sessions/`
- `agent/bin/`
- package install caches under `agent/git/` and `agent/npm/`

## Notes

- pi reads global config from `~/.pi/agent`
- global extensions in `agent/extensions/*.ts` and `agent/extensions/*/index.ts` auto-load on startup
- `agent/settings.json` includes a custom `protectedPaths` section used by the global protected-paths extension
- `protectedPaths` is a compact glob-to-access-mode map, e.g. `"node_modules": ["write"]`
- glob semantics: no `/` means any matching path segment, `/` means a project-relative path glob, and `/...` or `~/...` means an absolute path glob
- project-specific overrides can live in `.pi/settings.json` under the same `protectedPaths` key
- after editing extensions, prompts, skills, or themes, run `/reload` or restart pi
- for editor TypeScript support across `agent/` TypeScript files, use `agent/package.json` and `agent/tsconfig.json`, then run `cd agent && npm install`
