# YZForge AI Working Rules

This project is a Cocos Creator project governed by YZForge. Follow these rules before editing.

## First Read

1. Read `.yzforge/ai-context.json` if it exists.
2. If it does not exist or looks stale, run `npm run yzforge:ai:context`.
3. For task workflows, read `docs/ai/README.md`.

## Hard Rules

- Do not edit `code/generated/**`, `*.generated.ts`, `manifest.generated.json`, or `res/content/config/*.json` by hand.
- Do not handwrite `resources.load`, `bundle.load`, or cross-scope asset paths in business code.
- Do not import another Module's `generated/config.ts` or private `code/**` files.
- Config tables are sourced from `config-source/excel` and `config-source/export-plan.json`.
- Config primary keys come only from Excel header rule `pk`; an `id` field must be marked `pk`.
- Use YZForge create commands or panels for new Modules, Libraries, ContentPacks, Views, Parts, Services, Models, Flows, and Events.

## Commands

```bash
npm run yzforge:ai:context
npm run yzforge:ai:doctor
npm run yzforge:generate:check
npm run yzforge:config:check
npm run yzforge:validate:strict
npm run typecheck
```

## Fixing Generated Drift

- If generated files are stale, update the source of truth and run `npm run yzforge:generate`.
- If config output is stale, update Excel or the export plan and run `npm run yzforge:config:build`.
- If validation complains about generated files being edited, discard the generated edit and regenerate from source inputs.

## Scope Choices

- Module: feature-owned gameplay/UI/business logic.
- Library: reusable cross-module services, data, contracts, or systems.
- ContentPack: optional content owned by one Module.
- Global: app-level shared UI/resources only.

When unsure, keep the change in the smallest owning Scope and run `npm run yzforge:ai:doctor`.
