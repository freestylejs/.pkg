export type PackageRole = 'library' | 'app' | 'tooling' | 'other'

export type BuildSystem =
    | 'tsup'
    | 'vite'
    | 'next'
    | 'astro'
    | 'webpack'
    | 'storybook'
    | 'other'

export interface TsConfigInfo {
    path: string
    extends: string[]
    baseUrl?: string | undefined
    paths: Record<string, string[]>
    ignoreDeprecations?: string | undefined
    include: string[]
    rootDir?: string | undefined
}

export interface TsupInfo {
    path: string
    entry: Record<string, string>
    format: string[]
    dts: boolean | { generator?: string | undefined }
    clean?: boolean | undefined
    outDir?: string | undefined
    target?: string | undefined
    sourcemap?: boolean | undefined
    platform?: string | undefined
    fixedExtension?: boolean | undefined
    unsupported: string[]
}

export interface PackageInfo {
    path: string
    relativePath: string
    name: string
    version: string
    private: boolean
    role: PackageRole
    buildSystem: BuildSystem
    scripts: Record<string, string>
    dependencies: Record<string, string>
    devDependencies: Record<string, string>
    peerDependencies: Record<string, string>
    exports: unknown
    main?: string | undefined
    module?: string | undefined
    types?: string | undefined
    tsconfig?: TsConfigInfo | undefined
    tsup?: TsupInfo | undefined
    hasViteConfig: boolean
    hasVitestConfig: boolean
    wildcardExports: boolean
    wildcardUsed: boolean
    typescriptApiConsumers: string[]
    customScripts: string[]
}

export interface RepoSnapshot {
    root: string
    packageManager: string
    workspacePatterns: string[]
    packages: PackageInfo[]
    rootPackage: PackageInfo
    hasTurbo: boolean
    hasBiome: boolean
    hasChangesets: boolean
    gitBranch?: string | undefined
    gitHead?: string | undefined
    gitClean: boolean
    toolchain: {
        typescript?: string | undefined
        vitePlus?: string | undefined
        vite?: string | undefined
        vitest?: string | undefined
        tsup?: string | undefined
        turbo?: string | undefined
        biome?: string | undefined
    }
}

export type ChangeKind = 'write-file' | 'edit-jsonc' | 'delete-file' | 'mkdir'

export interface Change {
    id: string
    phase: string
    kind: ChangeKind
    path: string
    description: string
    content?: string | undefined
    edits?: JsoncEdit[] | undefined
    overwrite?: boolean | undefined
}

export interface JsoncEdit {
    path: Array<string | number>
    value: unknown
}

export interface UnsupportedItem {
    package: string
    reason: string
    action: string
}

export interface PlanPhase {
    name: string
    changes: Change[]
}

export interface MigrationPlan {
    schemaVersion: 1
    repo: string
    repoName: string
    generatedAt: string
    branch: string
    head: string
    phases: PlanPhase[]
    unsupported: UnsupportedItem[]
    manualActions: string[]
    planHash: string
}

export interface CommandResult {
    command: string
    exitCode: number
    stdout: string
    stderr: string
    durationMs: number
}

export interface VerificationReport {
    schemaVersion: 1
    repo: string
    phase: string
    status: 'passed' | 'failed' | 'skipped'
    commands: CommandResult[]
    dist?: Record<string, string[]> | undefined
    notes: string[]
}

export interface MigrationReport {
    schemaVersion: 1
    repo: string
    plan: MigrationPlan
    verification: VerificationReport[]
    applied: string[]
    rolledBack: boolean
    startedAt: string
    finishedAt: string
}
