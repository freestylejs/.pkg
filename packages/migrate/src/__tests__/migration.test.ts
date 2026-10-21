import {
    existsSync,
    mkdirSync,
    mkdtempSync,
    readFileSync,
    rmSync,
    writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { applyPlan } from '../apply.ts'
import { scanRepo } from '../detect.ts'
import { createPlan } from '../plan.ts'
import type { MigrationPlan } from '../types.ts'

const dirs: string[] = []

function makeRepo(): string {
    const root = mkdtempSync(join(tmpdir(), 'freestyle-migrate-test-'))
    dirs.push(root)
    const write = (path: string, content: string) => {
        mkdirSync(dirname(join(root, path)), { recursive: true })
        writeFileSync(join(root, path), content, 'utf8')
    }

    write(
        'package.json',
        JSON.stringify(
            {
                name: 'fixture-monorepo',
                private: true,
                packageManager: 'pnpm@10.20.0',
                devDependencies: {
                    '@freestylejs/config': '1.2.5',
                    tsup: '8.5.0',
                    turbo: '2.6.0',
                    typescript: '6.0.2',
                },
                scripts: {
                    build: 'turbo run build',
                },
            },
            null,
            4
        )
    )
    write('pnpm-workspace.yaml', 'packages:\n    - packages/*\n')
    write(
        'tsconfig.json',
        JSON.stringify(
            {
                extends: '@freestylejs/config/tsconfig',
                compilerOptions: { ignoreDeprecations: '6.0' },
                include: ['packages'],
            },
            null,
            4
        )
    )
    write(
        'packages/lib/package.json',
        JSON.stringify(
            {
                name: '@fixture/lib',
                version: '1.0.0',
                type: 'module',
                main: './dist/index.js',
                module: './dist/index.js',
                types: './dist/index.d.ts',
                exports: {
                    './*': { import: './dist/*.js' },
                    '.': { import: './dist/index.js' },
                },
                scripts: {
                    build: 'tsup',
                    'build:fast': 'tsup --no-dts',
                    dev: 'pnpm build --watch',
                    'ts:typecheck': 'tsc --noEmit',
                },
            },
            null,
            4
        )
    )
    write(
        'packages/lib/tsconfig.json',
        JSON.stringify(
            {
                extends: '../../tsconfig.json',
                include: ['src/**/*'],
                compilerOptions: {
                    baseUrl: '.',
                    paths: { '~/*': ['src/*'] },
                },
            },
            null,
            4
        )
    )
    write(
        'packages/lib/tsup.config.ts',
        `import { defineConfig } from 'tsup'\nexport default defineConfig({ entry: { index: 'src/index.ts' }, format: ['cjs', 'esm'], dts: true })\n`
    )
    write('packages/lib/src/index.ts', 'export const value = 1\n')
    write(
        'packages/app/package.json',
        JSON.stringify(
            {
                name: '@fixture/app',
                version: '1.0.0',
                private: true,
                scripts: { build: 'next build', dev: 'next dev' },
            },
            null,
            4
        )
    )
    write(
        'packages/app/src/index.ts',
        `import { value } from '@fixture/lib/index'\nexport const app = value\n`
    )
    write(
        'packages/app/tsconfig.json',
        JSON.stringify(
            {
                compilerOptions: {
                    baseUrl: '.',
                    paths: { '@/*': ['./src/*'] },
                },
                include: ['src/**/*'],
            },
            null,
            4
        )
    )
    return root
}

afterEach(() => {
    for (const dir of dirs.splice(0))
        rmSync(dir, { recursive: true, force: true })
})

describe('migration detection and planning', () => {
    it('classifies library and app packages', () => {
        const root = makeRepo()
        const snapshot = scanRepo(root)
        const library = snapshot.packages.find(
            (pkg) => pkg.name === '@fixture/lib'
        )
        const app = snapshot.packages.find((pkg) => pkg.name === '@fixture/app')

        expect(library?.role).toBe('library')
        expect(library?.buildSystem).toBe('tsup')
        expect(library?.tsup?.entry.index).toBe('src/index.ts')
        expect(library?.tsconfig?.baseUrl).toBe('.')
        expect(app?.role).toBe('app')
        expect(app?.buildSystem).toBe('next')
    })

    it('detects wildcard exports used by another package', () => {
        const root = makeRepo()
        const snapshot = scanRepo(root)
        const library = snapshot.packages.find(
            (pkg) => pkg.name === '@fixture/lib'
        )
        expect(library?.wildcardExports).toBe(true)
        expect(library?.wildcardUsed).toBe(true)
    })

    it('plans build and TypeScript 7 changes without touching the app', () => {
        const root = makeRepo()
        const snapshot = scanRepo(root)
        const plan = createPlan(snapshot, ['build', 'ts7'])
        const paths = plan.phases.flatMap((phase) =>
            phase.changes.map((change) => change.path)
        )

        expect(paths).toContain(join(root, 'packages/lib/vite.config.ts'))
        expect(paths).toContain(join(root, 'packages/lib/tsconfig.build.json'))
        expect(paths).toContain(join(root, 'packages/lib/tsconfig.json'))
        expect(paths).toContain(join(root, 'tsconfig.ts7.json'))
        expect(paths).not.toContain(join(root, 'packages/app/vite.config.ts'))
        expect(
            plan.manualActions.some((item) => item.includes('@fixture/app'))
        ).toBe(true)
    })

    it('is idempotent when the plan is generated again', () => {
        const root = makeRepo()
        const first = createPlan(scanRepo(root), ['build', 'ts7'])
        const second = createPlan(scanRepo(root), ['build', 'ts7'])
        expect(second.planHash).toBe(first.planHash)
    })

    it('rolls back all applied changes when a later change fails', () => {
        const root = makeRepo()
        const existing = join(root, 'package.json')
        const before = readFileSync(existing, 'utf8')
        const newFile = join(root, 'generated.txt')
        const plan: MigrationPlan = {
            schemaVersion: 1,
            repo: root,
            repoName: 'fixture',
            generatedAt: new Date(0).toISOString(),
            branch: 'test',
            head: 'test',
            phases: [
                {
                    name: 'test',
                    changes: [
                        {
                            id: 'write',
                            phase: 'test',
                            kind: 'write-file',
                            path: newFile,
                            description: 'create file',
                            content: 'generated\n',
                        },
                        {
                            id: 'fail',
                            phase: 'test',
                            kind: 'write-file',
                            path: existing,
                            description: 'must not overwrite',
                            content: 'replacement\n',
                        },
                    ],
                },
            ],
            unsupported: [],
            manualActions: [],
            planHash: 'test',
        }

        expect(() => applyPlan(plan)).toThrow(/Refusing to overwrite/)
        expect(existsSync(newFile)).toBe(false)
        expect(readFileSync(existing, 'utf8')).toBe(before)
    })
})
