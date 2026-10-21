# Freestyle PKG Template

> This repository is the reference implementation for the freestylejs package
> template. To create a new project, use the generator instead of forking:
>
> ```bash
> pnpm create @freestylejs/pkg my-lib
> ```
>
> Generator: [freestylejs/create-pkg](https://github.com/freestylejs/create-pkg)

### **Structure**

The repository is organized as follows:

- `packages/`: Contains all the individual packages of the monorepo.
- `asset/`: Contains assets and documentation.
- Configuration files (e.g., `pnpm-workspace.yaml`, `turbo.json`, `tsconfig.json`) are located at the root level.

---

### **Tooling**

This monorepo uses the following tools:

| Tool           | Purpose                             |
| :------------- | :---------------------------------- |
| **pnpm**       | Dependency management               |
| **tsdown**     | Library build (Rolldown + Oxc)      |
| **Turborepo**  | High-performance task orchestration |
| **Changesets** | Versioning and changelog generation |
| **TypeScript** | Type-safe code (TypeScript 7)       |
| **Vitest**     | Unit testing                        |
| **Oxlint**     | Linter                              |
| **Oxfmt**      | Formatter                           |

---

### **Getting Started**

1.  **Install pnpm:**

    ```bash
    npm install -g pnpm
    ```

2.  **Install dependencies:**
    ```bash
    pnpm install
    ```

Requirements:

- Node.js `^22.18.0 || ^24.11.0 || >=26.0.0` (`.nvmrc` pins 24.19.0)
- pnpm `10.20.0`

---

### **Development**

| Command               | Description                                        |
| :-------------------- | :------------------------------------------------- |
| `pnpm dev`            | Start development servers for all packages.        |
| `pnpm build`          | Build all packages with Turbo caching.             |
| `pnpm build:clean`    | Clean `dist` and force a full rebuild.             |
| `pnpm build:fast`     | Build without declaration generation.              |
| `pnpm test`           | Run tests in watch mode.                           |
| `pnpm test:coverage`  | Run tests once with coverage.                      |
| `pnpm lint`           | Lint all packages.                                 |
| `pnpm format`         | Format all files with Oxfmt.                       |
| `pnpm check`          | Run Oxlint and verify formatting.                  |
| `pnpm ts:typecheck`   | Type-check every package.                          |
| `pnpm verify:package` | Validate the existing build, tarball, and imports. |
| `pnpm reset`          | Clean build artifacts and `node_modules`.          |

---

### **Migration CLI**

`packages/migrate` contains the policy-driven migration CLI for existing
template-derived repositories.

```bash
pnpm --filter @freestylejs/migrate build
node packages/migrate/dist/cli.js scan ../some-repo
node packages/migrate/dist/cli.js plan ../some-repo
node packages/migrate/dist/cli.js apply ../some-repo --phase build,ts7 --write
```

`apply` is a dry-run unless `--write` is passed. App packages, custom build
configs, and used wildcard exports are preserved and reported as manual actions.

For new projects, use `pnpm create @freestylejs/pkg` instead.

---

### **Versioning**

This project uses [Changesets](https://github.com/changesets/changesets) to manage versioning and publishing.

| Command            | Description                                                          |
| :----------------- | :------------------------------------------------------------------- |
| `pnpm pkg:init`    | Create a new changeset. This will prompt you for the type of change. |
| `pnpm pkg:version` | Apply changesets and bump package versions.                          |
| `pnpm pkg:publish` | Publish packages to the registry.                                    |
