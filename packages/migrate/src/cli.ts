#!/usr/bin/env node
import { readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { applyPlan } from './apply.ts'
import { scanRepo } from './detect.ts'
import { isClean, isGitRepo } from './git.ts'
import { createPlan, type PhaseName } from './plan.ts'
import { printPlan, printSnapshot, writeReport } from './report.ts'
import type {
    MigrationPlan,
    MigrationReport,
    RepoSnapshot,
    VerificationReport,
} from './types.ts'
import {
    pathExists,
    readText,
    runCommand,
    runPnpm,
    writeText,
} from './utils.ts'
import { distInventory, type VerifyPhase, verifyPhase } from './verify.ts'

interface Args {
    command: string
    repo: string
    phases: PhaseName[]
    json: boolean
    write: boolean
    allowDirty: boolean
    verify: boolean
    forceUnsupported: boolean
}

const EXIT = {
    ok: 0,
    usage: 2,
    unsupported: 3,
    unsafe: 4,
    verify: 5,
    rollback: 6,
}

function usage(): never {
    console.error(`Usage:
  freestyle-migrate scan <repo> [--json]
  freestyle-migrate plan <repo> [--phase build,ts7] [--json]
  freestyle-migrate apply <repo> [--phase build,ts7] [--write] [--allow-dirty]
  freestyle-migrate verify <repo> [--phase build,ts7] [--json]
  freestyle-migrate doctor <repo>
  freestyle-migrate batch <root> [--json]

Default is dry-run. Mutations require --write.`)
    process.exit(EXIT.usage)
}

function parseArgs(argv: string[]): Args {
    const [command = '', ...rest] = argv
    if (!command) usage()
    let repo = process.cwd()
    const phases: PhaseName[] = []
    let json = false
    let write = false
    let allowDirty = false
    let verify = true
    let forceUnsupported = false

    for (let i = 0; i < rest.length; i += 1) {
        const value = rest[i]
        if (value === undefined) break
        if (value === '--json') {
            json = true
        } else if (value === '--write') {
            write = true
        } else if (value === '--allow-dirty') {
            allowDirty = true
        } else if (value === '--no-verify') {
            verify = false
        } else if (value === '--force-unsupported') {
            forceUnsupported = true
        } else if (value === '--phase') {
            const next = rest[i + 1]
            if (!next) usage()
            phases.push(
                ...next.split(',').map((item) => item.trim() as PhaseName)
            )
            i += 1
        } else if (value.startsWith('--phase=')) {
            phases.push(
                ...value
                    .slice('--phase='.length)
                    .split(',')
                    .map((item) => item.trim() as PhaseName)
            )
        } else if (value.startsWith('-')) {
            console.error(`Unknown option: ${value}`)
            usage()
        } else {
            repo = value
        }
    }

    const validPhases = new Set<PhaseName>(['build', 'ts7'])
    for (const phase of phases) {
        if (!validPhases.has(phase)) {
            console.error(`Unsupported phase: ${phase}`)
            process.exit(EXIT.unsupported)
        }
    }
    if (phases.length === 0) phases.push('build', 'ts7')

    return {
        command,
        repo: resolve(repo),
        phases,
        json,
        write,
        allowDirty,
        verify,
        forceUnsupported,
    }
}

function guardUnsupported(plan: MigrationPlan, force: boolean): void {
    if (plan.unsupported.length === 0) return
    for (const item of plan.unsupported) {
        console.error(`unsupported: ${item.package}: ${item.reason}`)
        console.error(`  action: ${item.action}`)
    }
    if (!force) {
        console.error(
            'Refusing to apply with unsupported items. Re-run with --force-unsupported after review.'
        )
        process.exit(EXIT.unsupported)
    }
}

function reportFrom(
    plan: MigrationPlan,
    verification: VerificationReport[],
    applied: string[],
    rolledBack: boolean
): MigrationReport {
    return {
        schemaVersion: 1,
        repo: plan.repo,
        plan,
        verification,
        applied,
        rolledBack,
        startedAt: new Date().toISOString(),
        finishedAt: new Date().toISOString(),
    }
}

function commandApply(
    args: Args,
    snapshot: RepoSnapshot,
    plan: MigrationPlan
): number {
    if (!args.write) {
        if (args.json) console.log(JSON.stringify(plan, null, 4))
        else printPlan(plan)
        return EXIT.ok
    }

    guardUnsupported(plan, args.forceUnsupported)
    if (!isGitRepo(args.repo)) {
        console.error('Refusing to apply: not a git repository')
        return EXIT.unsafe
    }
    if (!args.allowDirty && !isClean(args.repo)) {
        console.error(
            'Refusing to apply: git worktree is dirty. Commit or use --allow-dirty in a disposable copy.'
        )
        return EXIT.unsafe
    }

    const beforeDist = distInventory(args.repo)
    const lockfilePath = join(args.repo, 'pnpm-lock.yaml')
    const lockfileBefore = pathExists(lockfilePath)
        ? readText(lockfilePath)
        : undefined
    let applied: string[] = []
    const verification: VerificationReport[] = []
    let rollback: (() => void) | undefined
    let cleanup: (() => void) | undefined
    let verifyFailed = false
    try {
        const result = applyPlan(plan)
        applied = result.applied
        rollback = result.rollback
        cleanup = result.cleanup

        const formattable = applied.filter((path) => pathExists(path))
        if (formattable.length > 0) {
            const oxfmtBin = join(args.repo, 'node_modules', '.bin', 'oxfmt')
            const biomeBin = join(args.repo, 'node_modules', '.bin', 'biome')
            if (pathExists(oxfmtBin)) {
                const format = runCommand(
                    'pnpm',
                    ['exec', 'oxfmt', ...formattable],
                    args.repo
                )
                if (format.exitCode !== 0) {
                    console.warn('note: oxfmt could not format generated files')
                }
            } else if (pathExists(biomeBin)) {
                const format = runCommand(
                    'pnpm',
                    ['exec', 'biome', 'format', '--write', ...formattable],
                    args.repo
                )
                if (format.exitCode !== 0) {
                    console.warn('note: Biome could not format generated files')
                }
            } else {
                console.warn(
                    'note: no supported formatter found for generated files'
                )
            }
        }

        const install = runPnpm(args.repo, ['install', '--no-frozen-lockfile'])
        if (install.exitCode !== 0) {
            console.error(install.stdout)
            console.error(install.stderr)
            throw new Error('pnpm install failed')
        }

        if (args.verify) {
            for (const phase of args.phases) {
                const report = verifyPhase(
                    args.repo,
                    phase as VerifyPhase,
                    beforeDist
                )
                verification.push(report)
                if (report.status === 'failed') {
                    verifyFailed = true
                    throw new Error(`verification failed for phase ${phase}`)
                }
            }
        }

        const report = reportFrom(plan, verification, applied, false)
        const path = writeReport(args.repo, plan, report)
        cleanup?.()
        if (args.json) console.log(JSON.stringify(report, null, 4))
        else {
            console.log(`applied ${applied.length} change(s)`)
            console.log(`report: ${path}`)
        }
        return EXIT.ok
    } catch (error) {
        rollback?.()
        if (lockfileBefore !== undefined)
            writeText(lockfilePath, lockfileBefore)
        cleanup?.()
        console.error(
            `apply failed: ${error instanceof Error ? error.message : String(error)}`
        )
        for (const report of verification) {
            for (const command of report.commands) {
                if (command.exitCode !== 0) {
                    console.error(
                        `\n${command.command} (exit ${command.exitCode})`
                    )
                    console.error(
                        (command.stderr || command.stdout).slice(-6000)
                    )
                }
            }
        }
        const report = reportFrom(plan, verification, applied, true)
        writeReport(args.repo, plan, report)
        return verifyFailed ? EXIT.verify : EXIT.rollback
    }
}

function commandVerify(args: Args, plan: MigrationPlan): number {
    const beforeDist = distInventory(args.repo)
    const verification: VerificationReport[] = []
    for (const phase of args.phases) {
        const report = verifyPhase(args.repo, phase as VerifyPhase, beforeDist)
        verification.push(report)
        if (!args.json) {
            console.log(`[${phase}] ${report.status}`)
            for (const command of report.commands) {
                console.log(`  ${command.command} -> ${command.exitCode}`)
            }
            for (const note of report.notes) console.log(`  note: ${note}`)
        }
    }
    const report = reportFrom(plan, verification, [], false)
    const path = writeReport(args.repo, plan, report)
    if (args.json) console.log(JSON.stringify(report, null, 4))
    else console.log(`report: ${path}`)
    return verification.every((item) => item.status === 'passed')
        ? EXIT.ok
        : EXIT.verify
}

function commandBatch(args: Args): number {
    const rows: Array<{
        repo: string
        name?: string | undefined
        branch?: string | undefined
        clean?: boolean | undefined
        packages?: number | undefined
        roles?: Record<string, number> | undefined
        error?: string | undefined
    }> = []
    for (const entry of readdirSync(args.repo, { withFileTypes: true })) {
        if (!entry.isDirectory() || entry.name.startsWith('.')) continue
        const repo = join(args.repo, entry.name)
        if (!pathExists(join(repo, 'package.json'))) continue
        try {
            const snapshot = scanRepo(repo)
            const roles: Record<string, number> = {}
            for (const pkg of snapshot.packages)
                roles[pkg.role] = (roles[pkg.role] ?? 0) + 1
            rows.push({
                repo: entry.name,
                name: snapshot.rootPackage.name,
                branch: snapshot.gitBranch,
                clean: snapshot.gitClean,
                packages: snapshot.packages.length,
                roles,
            })
        } catch (error) {
            rows.push({
                repo: entry.name,
                error: error instanceof Error ? error.message : String(error),
            })
        }
    }
    if (args.json) {
        console.log(JSON.stringify(rows, null, 4))
    } else {
        for (const row of rows) {
            if (row.error) {
                console.log(`${row.repo}: error: ${row.error}`)
            } else {
                console.log(
                    `${row.repo}: ${row.packages} package(s) ${JSON.stringify(row.roles)} branch=${row.branch ?? '?'} clean=${row.clean}`
                )
            }
        }
    }
    return EXIT.ok
}

function main(): number {
    const args = parseArgs(process.argv.slice(2))
    if (args.command === 'batch') return commandBatch(args)
    const snapshot = scanRepo(args.repo)
    if (args.command === 'scan') {
        if (args.json) console.log(JSON.stringify(snapshot, null, 4))
        else printSnapshot(snapshot)
        return EXIT.ok
    }
    if (args.command === 'doctor') {
        console.log(`repo: ${snapshot.root}`)
        console.log(`git: ${isGitRepo(args.repo)} clean=${isClean(args.repo)}`)
        console.log(`node: ${process.version}`)
        console.log(`package manager: ${snapshot.packageManager}`)
        console.log(
            `vite-plus: ${snapshot.toolchain.vitePlus ?? 'not installed'}`
        )
        console.log(
            `typescript: ${snapshot.toolchain.typescript ?? 'not installed'}`
        )
        console.log(`packages: ${snapshot.packages.length}`)
        return EXIT.ok
    }

    const plan = createPlan(snapshot, args.phases)
    if (args.command === 'plan') {
        if (args.json) console.log(JSON.stringify(plan, null, 4))
        else printPlan(plan)
        return EXIT.ok
    }
    if (args.command === 'apply') return commandApply(args, snapshot, plan)
    if (args.command === 'verify') return commandVerify(args, plan)
    usage()
}

try {
    process.exitCode = main()
} catch (error) {
    console.error(
        error instanceof Error ? (error.stack ?? error.message) : String(error)
    )
    process.exitCode = EXIT.usage
}
