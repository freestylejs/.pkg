# Freestyle PKG Template

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

---

### **Development**

| Command              | Description                                 |
| :------------------- | :------------------------------------------ |
| `pnpm dev`           | Start development servers for all packages. |
| `pnpm build`         | Build all packages.                         |
| `pnpm build:fast`    | Build without declaration generation.       |
| `pnpm test`          | Run tests in watch mode.                    |
| `pnpm test:coverage` | Run tests once with coverage.               |
| `pnpm lint`          | Lint all packages.                          |
| `pnpm format`        | Format all files with Oxfmt.                |
| `pnpm check`         | Run Oxlint and verify formatting.           |
| `pnpm ts:typecheck`  | Type-check every package.                   |
| `pnpm reset`         | Clean build artifacts and `node_modules`.   |

---

### **Migration CLI**

`packages/migrate` contains the policy-driven migration CLI used to move
template-derived repositories to Vite+ and TypeScript 7.

```bash
pnpm --filter @freestylejs/migrate build
node packages/migrate/dist/cli.js scan ../some-repo
node packages/migrate/dist/cli.js plan ../some-repo
node packages/migrate/dist/cli.js apply ../some-repo --phase build,ts7 --write
```

`apply` is a dry-run unless `--write` is passed. App packages, custom build
configs, and used wildcard exports are preserved and reported as manual actions.

---

### **Versioning**

This project uses [Changesets](https://github.com/changesets/changesets) to manage versioning and publishing.

| Command            | Description                                                          |
| :----------------- | :------------------------------------------------------------------- |
| `pnpm pkg:init`    | Create a new changeset. This will prompt you for the type of change. |
| `pnpm pkg:version` | Apply changesets and bump package versions.                          |
| `pnpm pkg:publish` | Publish packages to the registry.                                    |
