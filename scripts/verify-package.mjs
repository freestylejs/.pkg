import {
    mkdtempSync,
    mkdirSync,
    readdirSync,
    rmSync,
    writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const packageDir = join(root, 'packages/pkg')
const temp = mkdtempSync(join(tmpdir(), 'freestyle-pkg-consumer-'))
const packDir = join(temp, 'pack')

function run(command, args, cwd) {
    const result = spawnSync(command, args, {
        cwd,
        encoding: 'utf8',
        env: { ...process.env, CI: '1', NO_COLOR: '1' },
        shell: false,
    })
    if (result.status !== 0) {
        throw new Error(
            `${command} ${args.join(' ')} failed\n${result.stdout ?? ''}\n${result.stderr ?? ''}`
        )
    }
    return result.stdout ?? ''
}

function write(path, content) {
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, content, 'utf8')
}

try {
    mkdirSync(packDir, { recursive: true })
    run('pnpm', ['pack', '--pack-destination', packDir], packageDir)
    const tarball = readdirSync(packDir).find((name) => name.endsWith('.tgz'))
    if (!tarball) throw new Error('pnpm pack did not produce a tarball')

    write(
        join(temp, 'package.json'),
        `${JSON.stringify(
            {
                name: 'freestyle-pkg-consumer',
                private: true,
                type: 'module',
                dependencies: {
                    '@freestylejs/pkg': `file:${join(packDir, tarball)}`,
                },
                devDependencies: {
                    '@types/node': '24.10.0',
                    typescript: '7.0.2',
                },
            },
            null,
            4
        )}\n`
    )
    write(
        join(temp, 'esm.mjs'),
        `import { ModuleA, ModuleB, PKG } from '@freestylejs/pkg'\n` +
            `if (ModuleA() !== 1 || ModuleB() !== 2 || PKG !== 1) throw new Error('ESM contract failed')\n` +
            `console.log('ESM contract ok')\n`
    )
    write(
        join(temp, 'cjs.cjs'),
        `const { ModuleA, ModuleB, PKG } = require('@freestylejs/pkg')\n` +
            `if (ModuleA() !== 1 || ModuleB() !== 2 || PKG !== 1) throw new Error('CJS contract failed')\n` +
            `console.log('CJS contract ok')\n`
    )
    write(
        join(temp, 'index.ts'),
        `import { ModuleA, ModuleB, PKG } from '@freestylejs/pkg'\n` +
            `const a: number = ModuleA()\n` +
            `const b: number = ModuleB()\n` +
            `const p: 1 = PKG\n` +
            `void [a, b, p]\n`
    )
    write(
        join(temp, 'tsconfig.json'),
        `${JSON.stringify(
            {
                compilerOptions: {
                    strict: true,
                    target: 'es2021',
                    module: 'esnext',
                    moduleResolution: 'Bundler',
                    noEmit: true,
                    skipLibCheck: true,
                },
                include: ['index.ts'],
            },
            null,
            4
        )}\n`
    )

    run('pnpm', ['install', '--ignore-workspace'], temp)
    run(process.execPath, ['esm.mjs'], temp)
    run(process.execPath, ['cjs.cjs'], temp)
    run('pnpm', ['exec', 'tsc', '--noEmit'], temp)
    process.stdout.write('package contract verification passed\n')
} finally {
    rmSync(temp, { recursive: true, force: true })
}
