# @freestylejs/migrate

Policy-driven migration CLI for repositories built from the freestylejs package
template.

## Scope (v0.1)

Supported phases:

- `build`: replace tsup library builds with `vite-plus` pack configs and scripts
- `ts7`: TypeScript 7 tsconfig migration and `tsgo` declaration generation

The CLI intentionally does **not** rewrite app builds (Next.js, Astro, Webpack),
custom scripts, or wildcard exports automatically. Those are reported as manual
actions and preserve the existing behavior.

## Commands

```bash
freestyle-migrate scan <repo> [--json]
freestyle-migrate plan <repo> [--phase build,ts7] [--json]
freestyle-migrate apply <repo> [--phase build,ts7] [--write]
freestyle-migrate verify <repo> [--phase build,ts7] [--json]
freestyle-migrate doctor <repo>
freestyle-migrate batch <root> [--json]
```

`apply` is a dry-run unless `--write` is provided. A dirty Git worktree is
refused unless `--allow-dirty` is used on a disposable copy.

## Safety model

- Read-only scan and plan are deterministic.
- Plans are idempotent: applying an already migrated repository produces no
  changes.
- Every change is backed up; verification failure restores files and the
  lockfile.
- Unsupported dynamic configs and app packages fail closed.
- The CLI never publishes packages or commits automatically.
- Generated files are formatted with the repository's Biome config when Biome
  is available.

## Exit codes

| Code | Meaning |
| --- | --- |
| 0 | success |
| 2 | usage error |
| 3 | unsupported migration item |
| 4 | unsafe Git state |
| 5 | verification failure |
| 6 | apply failure and rollback |

## Package roles

The scanner classifies every package as `library`, `app`, `tooling`, or `other`.
Only `library` packages with a static tsup config are migrated by the build
phase. App packages keep their existing framework build and TypeScript version.

## TypeScript 7 notes

- `baseUrl` is removed and `paths` are rewritten as relative paths.
- Root `ignoreDeprecations` flags are removed.
- Library declarations use the `tsgo` generator with a generated
  `tsconfig.build.json` that excludes tests.
- App packages can keep an older TypeScript line; the CLI does not force a
  single workspace-wide compiler.
