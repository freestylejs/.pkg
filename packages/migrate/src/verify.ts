import { readdirSync } from 'node:fs'
import { join, relative } from 'node:path'
import type { CommandResult, VerificationReport } from './types.ts'
import { pathExists, runPnpmScript } from './utils.ts'

export type VerifyPhase = 'build' | 'ts7' | 'test' | 'lint' | 'run'

function truncate(value: string, max = 20_000): string {
    return value.length <= max
        ? value
        : `${value.slice(0, max)}\n...[truncated]`
}

function normalizeResult(result: CommandResult): CommandResult {
    return {
        ...result,
        stdout: truncate(result.stdout),
        stderr: truncate(result.stderr),
    }
}

export function distInventory(root: string): Record<string, string[]> {
    const out: Record<string, string[]> = {}
    const visit = (dir: string) => {
        let entries
        try {
            entries = readdirSync(dir, { withFileTypes: true })
        } catch {
            return
        }
        for (const entry of entries) {
            const full = join(dir, entry.name)
            if (entry.isDirectory()) {
                if (
                    entry.name === 'node_modules' ||
                    entry.name === '.git' ||
                    entry.name === '.next'
                )
                    continue
                visit(full)
            } else if (entry.isFile()) {
                const rel = relative(root, full).split('\\').join('/')
                if (rel.includes('/dist/')) {
                    const packageDir = rel.slice(0, rel.indexOf('/dist/'))
                    out[packageDir] ??= []
                    out[packageDir].push(rel)
                }
            }
        }
    }
    visit(root)
    for (const key of Object.keys(out)) {
        const files = out[key]
        if (files) out[key] = files.toSorted()
    }
    return Object.fromEntries(
        Object.entries(out).toSorted(([a], [b]) => a.localeCompare(b))
    )
}

function diffInventory(
    before: Record<string, string[]> | undefined,
    after: Record<string, string[]>
): string[] {
    if (!before) return []
    const notes: string[] = []
    for (const [pkg, files] of Object.entries(before)) {
        const next = after[pkg] ?? []
        const missing = files.filter((file) => !next.includes(file))
        if (missing.length > 0)
            notes.push(`${pkg}: missing dist files: ${missing.join(', ')}`)
    }
    for (const [pkg, files] of Object.entries(after)) {
        const prev = before[pkg] ?? []
        const added = files.filter((file) => !prev.includes(file))
        if (added.length > 0)
            notes.push(`${pkg}: added dist files: ${added.join(', ')}`)
    }
    return notes
}

export function verifyPhase(
    root: string,
    phase: VerifyPhase,
    baselineDist?: Record<string, string[]>
): VerificationReport {
    const commands: CommandResult[] = []
    const scripts =
        phase === 'build'
            ? ['build']
            : phase === 'ts7'
              ? ['build', 'ts:typecheck']
              : phase === 'test'
                ? ['test:coverage']
                : phase === 'lint'
                  ? ['check']
                  : ['test:ci']

    let status: VerificationReport['status'] = 'passed'
    for (const script of scripts) {
        const packageJson = pathExists(join(root, 'package.json'))
        if (!packageJson) {
            status = 'failed'
            commands.push({
                command: `pnpm run ${script}`,
                exitCode: 1,
                stdout: '',
                stderr: 'No package.json',
                durationMs: 0,
            })
            break
        }
        const result = runPnpmScript(root, script)
        commands.push(normalizeResult(result))
        if (result.exitCode !== 0) {
            status = 'failed'
            break
        }
    }

    const after = distInventory(root)
    const notes = diffInventory(baselineDist, after)
    return {
        schemaVersion: 1,
        repo: root,
        phase,
        status,
        commands,
        dist: after,
        notes,
    }
}
