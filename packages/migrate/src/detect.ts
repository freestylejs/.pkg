import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { basename, dirname, join, resolve } from 'node:path'
import { parse } from '@babel/parser'
import type {
    BuildSystem,
    PackageInfo,
    PackageRole,
    RepoSnapshot,
    TsConfigInfo,
    TsupInfo,
} from './types.ts'
import {
    isDirectory,
    pathExists,
    readJson,
    readJsonc,
    readText,
    relativePath,
    walkFiles,
    walkPackageJsonFiles,
} from './utils.ts'

type AstNode = {
    type: string
    [key: string]: unknown
}

const TEMPLATE_SCRIPTS = new Set([
    'dev',
    'build',
    'build:fast',
    'start',
    'test',
    'test:watch',
    'test:coverage',
    'test:ci',
    'ts:typecheck',
    'ts:perf',
    'lint',
    'format',
    'check',
    'report',
    'reset:turbo',
    'reset:dist',
    'reset:modules',
    'reset',
    'pkg:init',
    'pkg:version',
    'pkg:publish',
    'pre-commit',
])

const TYPESCRIPT_API_CONSUMERS = [
    'typescript-eslint',
    '@typescript-eslint/parser',
    '@typescript-eslint/eslint-plugin',
    'vue-tsc',
    'svelte-check',
    'astro',
    'ts-morph',
    'typedoc',
    '@microsoft/api-extractor',
    'vite-plugin-dts',
    'unplugin-dts',
    'ts-jest',
]

function isObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readWorkspacePatterns(root: string): string[] {
    const path = join(root, 'pnpm-workspace.yaml')
    if (!pathExists(path)) return ['packages/*']
    const patterns: string[] = []
    let inPackages = false
    for (const line of readText(path).split('\n')) {
        const trimmed = line.trim()
        if (trimmed === 'packages:') {
            inPackages = true
            continue
        }
        if (!inPackages) continue
        if (trimmed.startsWith('- ')) {
            patterns.push(trimmed.slice(2).replaceAll(/^['"]|['"]$/g, ''))
        } else if (trimmed !== '' && !trimmed.startsWith('#')) {
            inPackages = false
        }
    }
    return patterns.length > 0 ? patterns : ['packages/*']
}

function matchWorkspacePattern(relative: string, pattern: string): boolean {
    if (pattern.endsWith('/*')) {
        const prefix = pattern.slice(0, -2)
        return (
            relative.startsWith(`${prefix}/`) &&
            !relative.slice(prefix.length + 1).includes('/')
        )
    }
    return relative === pattern
}

function discoverPackageJsonFiles(root: string, patterns: string[]): string[] {
    const candidates = [
        join(root, 'package.json'),
        ...walkPackageJsonFiles(root),
    ]
    return candidates
        .filter(
            (path) =>
                path === join(root, 'package.json') ||
                patterns.some((pattern) =>
                    matchWorkspacePattern(
                        relativePath(root, dirname(path)),
                        pattern
                    )
                )
        )
        .toSorted()
}

function resolveExtends(
    specifier: string,
    fromDir: string,
    root: string
): string | undefined {
    if (specifier.startsWith('.') || specifier.startsWith('/')) {
        const base = resolve(fromDir, specifier)
        return pathExists(base)
            ? base
            : pathExists(`${base}.json`)
              ? `${base}.json`
              : undefined
    }

    const known: Record<string, string> = {
        '@freestylejs/config/tsconfig':
            'node_modules/@freestylejs/config/src/ts/tsconfig.json',
        '@freestylejs/config/tsconfig-ts7':
            'node_modules/@freestylejs/config/src/ts/tsconfig.ts7.json',
    }
    const knownPath = known[specifier]
    if (knownPath && pathExists(join(root, knownPath)))
        return join(root, knownPath)

    try {
        const requireFromRoot = createRequire(join(root, 'package.json'))
        return requireFromRoot.resolve(specifier)
    } catch {
        return undefined
    }
}

export function readTsConfig(
    path: string,
    root: string
): TsConfigInfo | undefined {
    if (!pathExists(path)) return undefined
    const seen = new Set<string>()
    const chain: string[] = []

    const visit = (file: string): Record<string, unknown> => {
        if (seen.has(file)) return {}
        seen.add(file)
        const json = readJsonc<Record<string, unknown>>(file)
        const extended = json.extends
        let merged: Record<string, unknown> = {}
        const specs = Array.isArray(extended)
            ? extended.filter(
                  (item): item is string => typeof item === 'string'
              )
            : typeof extended === 'string'
              ? [extended]
              : []
        for (const spec of specs) {
            chain.push(spec)
            const resolved = resolveExtends(spec, dirname(file), root)
            if (resolved) {
                const base = visit(resolved)
                merged = deepMerge(merged, base)
            }
        }
        const compilerOptions = isObject(json.compilerOptions)
            ? json.compilerOptions
            : {}
        merged = deepMerge(merged, compilerOptions)
        return merged
    }

    const merged = visit(path)
    const raw = readJsonc<Record<string, unknown>>(path)
    const compilerOptions = isObject(raw.compilerOptions)
        ? raw.compilerOptions
        : {}
    const paths = isObject(merged.paths)
        ? Object.fromEntries(
              Object.entries(merged.paths).map(([key, value]) => [
                  key,
                  Array.isArray(value)
                      ? value.filter(
                            (item): item is string => typeof item === 'string'
                        )
                      : [],
              ])
          )
        : {}
    return {
        path,
        extends: chain,
        baseUrl:
            typeof merged.baseUrl === 'string' ? merged.baseUrl : undefined,
        paths,
        ignoreDeprecations:
            typeof merged.ignoreDeprecations === 'string'
                ? merged.ignoreDeprecations
                : undefined,
        include: Array.isArray(raw.include)
            ? raw.include.filter(
                  (item): item is string => typeof item === 'string'
              )
            : Array.isArray(merged.include)
              ? merged.include.filter(
                    (item): item is string => typeof item === 'string'
                )
              : [],
        rootDir:
            typeof compilerOptions.rootDir === 'string'
                ? compilerOptions.rootDir
                : undefined,
    }
}

function deepMerge(
    base: Record<string, unknown>,
    override: Record<string, unknown>
): Record<string, unknown> {
    const out: Record<string, unknown> = { ...base }
    for (const [key, value] of Object.entries(override)) {
        if (isObject(value) && isObject(out[key])) {
            out[key] = deepMerge(out[key] as Record<string, unknown>, value)
        } else {
            out[key] = value
        }
    }
    return out
}

function findProperty(object: AstNode, name: string): AstNode | undefined {
    const properties = object.properties
    if (!Array.isArray(properties)) return undefined
    for (const property of properties) {
        const node = property as AstNode
        if (node.type !== 'ObjectProperty' && node.type !== 'ObjectMethod')
            continue
        const key = node.key as AstNode | undefined
        const keyName =
            key?.type === 'Identifier'
                ? key.name
                : key?.type === 'StringLiteral'
                  ? key.value
                  : undefined
        if (keyName === name) return node
    }
    return undefined
}

function literal(node: AstNode | undefined): unknown {
    if (!node) return undefined
    if (
        node.type === 'StringLiteral' ||
        node.type === 'NumericLiteral' ||
        node.type === 'BooleanLiteral'
    ) {
        return node.value
    }
    if (node.type === 'NullLiteral') return null
    if (node.type === 'ArrayExpression') {
        return (node.elements as Array<AstNode | null>).map((item) =>
            item ? literal(item) : undefined
        )
    }
    if (node.type === 'ObjectExpression') {
        const out: Record<string, unknown> = {}
        for (const property of node.properties as AstNode[]) {
            if (property.type !== 'ObjectProperty') continue
            const key = property.key as AstNode
            const name =
                key.type === 'Identifier'
                    ? key.name
                    : key.type === 'StringLiteral'
                      ? key.value
                      : undefined
            if (typeof name === 'string')
                out[name] = literal(property.value as AstNode)
        }
        return out
    }
    return undefined
}

function findConfigObject(node: AstNode): AstNode | undefined {
    if (node.type === 'ObjectExpression') return node
    if (
        node.type === 'ArrowFunctionExpression' ||
        node.type === 'FunctionExpression'
    ) {
        return findReturnedObject(node.body as AstNode)
    }
    if (node.type === 'CallExpression') {
        const args = node.arguments as AstNode[] | undefined
        return args?.[0] ? findConfigObject(args[0]) : undefined
    }
    return undefined
}

function findReturnedObject(node: AstNode): AstNode | undefined {
    if (node.type === 'ObjectExpression') return node
    const body = node.body
    if (Array.isArray(body)) {
        for (const statement of body as AstNode[]) {
            const found = findReturnedObject(statement)
            if (found) return found
        }
        return undefined
    }
    if (node.type === 'ReturnStatement' && node.argument) {
        return findConfigObject(node.argument as AstNode)
    }
    if (node.type === 'ParenthesizedExpression' && node.expression) {
        return findReturnedObject(node.expression as AstNode)
    }
    return undefined
}

function collectCalls(node: AstNode, name: string, out: AstNode[]): void {
    if (node.type === 'CallExpression') {
        const callee = node.callee as AstNode | undefined
        if (callee?.type === 'Identifier' && callee.name === name)
            out.push(node)
    }
    for (const value of Object.values(node)) {
        if (Array.isArray(value)) {
            for (const item of value) {
                if (isObject(item) && typeof item.type === 'string')
                    collectCalls(item as AstNode, name, out)
            }
        } else if (isObject(value) && typeof value.type === 'string') {
            collectCalls(value as AstNode, name, out)
        }
    }
}

export function readTsupConfig(path: string): TsupInfo | undefined {
    if (!pathExists(path)) return undefined
    let ast: AstNode
    try {
        ast = parse(readText(path), {
            sourceType: 'module',
            plugins: ['typescript'],
        }) as unknown as AstNode
    } catch {
        return {
            path,
            entry: {},
            format: [],
            dts: true,
            unsupported: ['config parse failed'],
        }
    }

    const calls: AstNode[] = []
    collectCalls(ast, 'defineConfig', calls)
    const firstCallArgs = calls[0]?.arguments as AstNode[] | undefined
    const object = firstCallArgs?.[0]
        ? findConfigObject(firstCallArgs[0])
        : undefined
    if (!object) {
        return {
            path,
            entry: {},
            format: [],
            dts: true,
            unsupported: ['dynamic config could not be statically analyzed'],
        }
    }

    const unsupported: string[] = []
    const read = (name: string): unknown => {
        const property = findProperty(object, name)
        if (!property) return undefined
        if (property.type === 'ObjectMethod') {
            unsupported.push(`${name} is a method`)
            return undefined
        }
        const value = property.value as AstNode
        if (
            value.type === 'FunctionExpression' ||
            value.type === 'ArrowFunctionExpression'
        ) {
            unsupported.push(`${name} is dynamic`)
            return undefined
        }
        return literal(value)
    }

    const entryValue = read('entry')
    const entry: Record<string, string> = {}
    if (isObject(entryValue)) {
        for (const [key, value] of Object.entries(entryValue)) {
            if (typeof value === 'string') entry[key] = value
        }
    } else if (Array.isArray(entryValue)) {
        for (const value of entryValue) {
            if (typeof value === 'string') entry[basename(value, '.ts')] = value
        }
    }

    const formatValue = read('format')
    const format = Array.isArray(formatValue)
        ? formatValue.filter((item): item is string => typeof item === 'string')
        : typeof formatValue === 'string'
          ? [formatValue]
          : []

    const dtsValue = read('dts')
    const dts =
        typeof dtsValue === 'boolean'
            ? dtsValue
            : isObject(dtsValue)
              ? {
                    generator:
                        typeof dtsValue.generator === 'string'
                            ? dtsValue.generator
                            : undefined,
                }
              : true

    return {
        path,
        entry,
        format,
        dts,
        clean:
            typeof read('clean') === 'boolean'
                ? (read('clean') as boolean)
                : undefined,
        outDir:
            typeof read('outDir') === 'string'
                ? (read('outDir') as string)
                : undefined,
        target:
            typeof read('target') === 'string'
                ? (read('target') as string)
                : undefined,
        sourcemap:
            typeof read('sourcemap') === 'boolean'
                ? (read('sourcemap') as boolean)
                : undefined,
        platform:
            typeof read('platform') === 'string'
                ? (read('platform') as string)
                : undefined,
        fixedExtension: undefined,
        unsupported,
    }
}

function detectBuildSystem(scripts: Record<string, string>): BuildSystem {
    const build = scripts.build ?? ''
    if (build.includes('next')) return 'next'
    if (build.includes('astro')) return 'astro'
    if (build.includes('webpack')) return 'webpack'
    if (build.includes('storybook')) return 'storybook'
    if (build.includes('vite')) return 'vite'
    if (
        build.includes('tsup') ||
        build.includes('tsdown') ||
        build.includes('vp pack')
    )
        return 'tsup'
    return 'other'
}

function detectRole(
    scripts: Record<string, string>,
    buildSystem: BuildSystem
): PackageRole {
    if (
        buildSystem === 'next' ||
        buildSystem === 'astro' ||
        buildSystem === 'webpack'
    )
        return 'app'
    if (buildSystem === 'tsup' || buildSystem === 'vite') return 'library'
    if (!scripts.build) return 'tooling'
    return 'other' as PackageRole
}

function findTsConfig(path: string): string | undefined {
    const direct = join(path, 'tsconfig.json')
    return pathExists(direct) ? direct : undefined
}

function hasWildcardExports(exportsValue: unknown): boolean {
    return isObject(exportsValue) && Object.hasOwn(exportsValue, './*')
}

function findTypeScriptApiConsumers(pkg: Record<string, unknown>): string[] {
    const all = new Set<string>()
    for (const field of [
        'dependencies',
        'devDependencies',
        'peerDependencies',
    ]) {
        const deps = pkg[field]
        if (!isObject(deps)) continue
        for (const name of Object.keys(deps)) {
            if (TYPESCRIPT_API_CONSUMERS.includes(name)) all.add(name)
        }
    }
    return [...all].toSorted()
}

function sourceUsage(root: string, packageName: string): boolean {
    const files = walkFiles(root, {
        maxDepth: 12,
        filter: (path) =>
            /\.(?:ts|tsx|js|jsx|mts|cts)$/.test(path) &&
            !path.includes('/dist/') &&
            !path.includes('/.next/') &&
            !path.includes('/coverage/'),
    })
    const needle = `${packageName}/`
    for (const file of files) {
        const text = readText(file)
        if (text.includes(needle)) return true
    }
    return false
}

export function scanRepo(root: string): RepoSnapshot {
    const rootPackagePath = join(root, 'package.json')
    if (!pathExists(rootPackagePath))
        throw new Error(`No package.json at ${root}`)
    const rootPackage = readJson<Record<string, unknown>>(rootPackagePath)
    const workspacePatterns = readWorkspacePatterns(root)
    const packageFiles = discoverPackageJsonFiles(root, workspacePatterns)

    const packages: PackageInfo[] = []
    for (const file of packageFiles) {
        const pkg = readJson<Record<string, unknown>>(file)
        const dir = dirname(file)
        const scripts = isObject(pkg.scripts)
            ? Object.fromEntries(
                  Object.entries(pkg.scripts).filter(
                      (entry): entry is [string, string] =>
                          typeof entry[1] === 'string'
                  )
              )
            : {}
        const buildSystem = detectBuildSystem(scripts)
        const role =
            dir === root ||
            (typeof pkg.name === 'string' &&
                pkg.name === '@freestylejs/migrate')
                ? 'tooling'
                : detectRole(scripts, buildSystem)
        const tsconfigPath = findTsConfig(dir)
        const tsconfig = tsconfigPath
            ? readTsConfig(tsconfigPath, root)
            : undefined
        const tsupPath = join(dir, 'tsup.config.ts')
        const tsup = readTsupConfig(tsupPath)
        const exportsValue = pkg.exports
        const wildcardExports = hasWildcardExports(exportsValue)
        packages.push({
            path: dir,
            relativePath: relativePath(root, dir) || '.',
            name:
                typeof pkg.name === 'string'
                    ? pkg.name
                    : relativePath(root, dir),
            version: typeof pkg.version === 'string' ? pkg.version : '0.0.0',
            private: pkg.private === true,
            role,
            buildSystem,
            scripts,
            dependencies: isObject(pkg.dependencies)
                ? (pkg.dependencies as Record<string, string>)
                : {},
            devDependencies: isObject(pkg.devDependencies)
                ? (pkg.devDependencies as Record<string, string>)
                : {},
            peerDependencies: isObject(pkg.peerDependencies)
                ? (pkg.peerDependencies as Record<string, string>)
                : {},
            exports: exportsValue,
            main: typeof pkg.main === 'string' ? pkg.main : undefined,
            module: typeof pkg.module === 'string' ? pkg.module : undefined,
            types: typeof pkg.types === 'string' ? pkg.types : undefined,
            tsconfig,
            tsup,
            hasViteConfig: pathExists(join(dir, 'vite.config.ts')),
            hasVitestConfig: pathExists(join(dir, 'vitest.config.ts')),
            wildcardExports,
            wildcardUsed:
                wildcardExports &&
                sourceUsage(root, typeof pkg.name === 'string' ? pkg.name : ''),
            typescriptApiConsumers: findTypeScriptApiConsumers(pkg),
            customScripts: Object.keys(scripts).filter(
                (name) => !TEMPLATE_SCRIPTS.has(name)
            ),
        })
    }

    const rootInfo = packages.find((pkg) => pkg.path === root)
    if (!rootInfo) throw new Error('Root package was not discovered')

    const dev = rootInfo.devDependencies
    const toolchain = {
        typescript: dev.typescript ?? rootInfo.dependencies.typescript,
        vitePlus: dev['vite-plus'] ?? rootInfo.dependencies['vite-plus'],
        vite: dev.vite ?? rootInfo.dependencies.vite,
        vitest: dev.vitest ?? rootInfo.dependencies.vitest,
        tsup: dev.tsup ?? rootInfo.dependencies.tsup,
        turbo: dev.turbo ?? rootInfo.dependencies.turbo,
        biome: dev['@biomejs/biome'] ?? rootInfo.dependencies['@biomejs/biome'],
    }

    const { currentBranch, currentHead, isClean } = requireGit(root)
    return {
        root,
        packageManager:
            typeof rootPackage.packageManager === 'string'
                ? rootPackage.packageManager
                : 'pnpm',
        workspacePatterns,
        packages,
        rootPackage: rootInfo,
        hasTurbo: pathExists(join(root, 'turbo.json')),
        hasBiome: pathExists(join(root, 'biome.json')),
        hasChangesets: isDirectory(join(root, '.changeset')),
        gitBranch: currentBranch,
        gitHead: currentHead,
        gitClean: isClean,
        toolchain,
    }
}

function requireGit(root: string): {
    currentBranch?: string | undefined
    currentHead?: string | undefined
    isClean: boolean
} {
    const branch = spawnSync('git', ['branch', '--show-current'], {
        cwd: root,
        encoding: 'utf8',
        shell: false,
    })
    const head = spawnSync('git', ['rev-parse', 'HEAD'], {
        cwd: root,
        encoding: 'utf8',
        shell: false,
    })
    const status = spawnSync('git', ['status', '--porcelain'], {
        cwd: root,
        encoding: 'utf8',
        shell: false,
    })
    return {
        currentBranch: branch.status === 0 ? branch.stdout.trim() : undefined,
        currentHead: head.status === 0 ? head.stdout.trim() : undefined,
        isClean: status.status === 0 && status.stdout.trim() === '',
    }
}
