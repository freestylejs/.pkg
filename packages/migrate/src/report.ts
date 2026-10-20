import { join } from 'node:path'
import type { MigrationPlan, MigrationReport, RepoSnapshot } from './types.ts'
import { ensureDir, safeName, writeText } from './utils.ts'

export function printSnapshot(snapshot: RepoSnapshot): void {
    console.log(`repository: ${snapshot.rootPackage.name}`)
    console.log(
        `branch: ${snapshot.gitBranch ?? 'unknown'} (${snapshot.gitHead?.slice(0, 7) ?? 'unknown'})`
    )
    console.log(`clean: ${snapshot.gitClean}`)
    console.log(`package manager: ${snapshot.packageManager}`)
    console.log(`workspace: ${snapshot.workspacePatterns.join(', ')}`)
    console.log('')
    for (const pkg of snapshot.packages) {
        const details = [
            pkg.relativePath,
            pkg.name,
            pkg.role,
            pkg.buildSystem,
            pkg.tsconfig ? 'tsconfig' : 'no-tsconfig',
            pkg.tsup ? 'tsup' : pkg.hasViteConfig ? 'vite' : '',
            pkg.wildcardExports
                ? pkg.wildcardUsed
                    ? 'wildcard-used'
                    : 'wildcard'
                : '',
        ].filter(Boolean)
        console.log(`- ${details.join(' | ')}`)
        if (pkg.typescriptApiConsumers.length > 0) {
            console.log(
                `  TS API consumers: ${pkg.typescriptApiConsumers.join(', ')}`
            )
        }
        if (pkg.customScripts.length > 0) {
            console.log(`  custom scripts: ${pkg.customScripts.join(', ')}`)
        }
    }
    console.log('')
    console.log(`toolchain: ${JSON.stringify(snapshot.toolchain)}`)
}

export function printPlan(plan: MigrationPlan): void {
    console.log(
        `plan: ${plan.repoName} @ ${plan.branch} (${plan.head.slice(0, 7)})`
    )
    console.log(`hash: ${plan.planHash}`)
    for (const phase of plan.phases) {
        console.log(`\n[${phase.name}] ${phase.changes.length} change(s)`)
        for (const change of phase.changes) {
            console.log(`  - ${change.kind}: ${change.path}`)
            console.log(`    ${change.description}`)
        }
    }
    if (plan.unsupported.length > 0) {
        console.log('\nunsupported:')
        for (const item of plan.unsupported) {
            console.log(`  - ${item.package}: ${item.reason}`)
            console.log(`    action: ${item.action}`)
        }
    }
    if (plan.manualActions.length > 0) {
        console.log('\nmanual actions:')
        for (const item of plan.manualActions) console.log(`  - ${item}`)
    }
}

export function writeReport(
    root: string,
    plan: MigrationPlan,
    report: MigrationReport
): string {
    const dir = join(root, '.trace', 'migrate', 'reports')
    ensureDir(dir)
    const path = join(
        dir,
        `${safeName(plan.repoName)}-${plan.planHash.slice(0, 8)}.json`
    )
    writeText(path, `${JSON.stringify(report, null, 4)}\n`)
    return path
}
