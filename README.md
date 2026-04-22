# pi

Tracked contents of `~/.pi`, the global config directory for pi.

## What is tracked

- `agent/settings.json` — global pi settings
- `agent/extensions/` — global auto-discovered extensions
- `agent/prompts/`, `agent/skills/`, `agent/themes/` — shareable customizations

## What stays local

This repo uses an allowlist `.gitignore`, so runtime state stays untracked:

- `agent/auth.json`
- `agent/sessions/`
- `agent/bin/`
- package install caches under `agent/git/` and `agent/npm/`

## Notes

- pi reads global config from `~/.pi/agent`
- global extensions in `agent/extensions/*.ts` auto-load on startup
- `agent/settings.json` includes a custom `protectedPaths` section used by the global protected-paths extension
- project-specific overrides can live in `.pi/settings.json` under the same `protectedPaths` key
- after editing extensions, prompts, skills, or themes, run `/reload` or restart pi
