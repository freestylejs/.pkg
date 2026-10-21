import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import type { Change, MigrationPlan } from './types.ts'
import {
    applyJsoncEdits,
    ensureDir,
    isInside,
    pathExists,
    removePath,
    writeText,
} from './utils.ts'

export interface ApplyResult {
    applied: string[]
    backupDir: string
    rollback: () => void
    cleanup: () => void
}

interface Backup {
    path: string
    existed: boolean
    content: string | undefined
}

export function applyPlan(plan: MigrationPlan): ApplyResult {
    const root = plan.repo
    const backupDir = mkdtempSync(join(tmpdir(), 'freestyle-migrate-'))
    const backups: Backup[] = []
    const applied: string[] = []

    const backup = (path: string) => {
        if (backups.some((item) => item.path === path)) return
        const existed = pathExists(path)
        backups.push({
            path,
            existed,
            content: existed ? readFileSync(path, 'utf8') : undefined,
        })
    }

    const applyChange = (change: Change) => {
        if (!isInside(root, change.path)) {
            throw new Error(
                `Refusing to write outside repository: ${change.path}`
            )
        }
        backup(change.path)
        switch (change.kind) {
            case 'mkdir':
                ensureDir(change.path)
                break
            case 'write-file':
                if (pathExists(change.path) && !change.overwrite) {
                    throw new Error(
                        `Refusing to overwrite existing file: ${change.path}`
                    )
                }
                ensureDir(dirname(change.path))
                writeText(change.path, change.content ?? '')
                break
            case 'edit-jsonc':
                if (!pathExists(change.path)) {
                    throw new Error(
                        `Cannot edit missing JSONC file: ${change.path}`
                    )
                }
                applyJsoncEdits(change.path, change.edits ?? [])
                break
            case 'delete-file':
                if (!pathExists(change.path)) break
                removePath(change.path)
                break
            default:
                throw new Error(`Unknown change kind: ${String(change.kind)}`)
        }
        applied.push(change.path)
    }

    const rollback = () => {
        for (const item of [...backups].toReversed()) {
            if (item.existed) {
                ensureDir(dirname(item.path))
                writeFileSync(item.path, item.content ?? '', 'utf8')
            } else {
                removePath(item.path)
            }
        }
    }

    try {
        for (const phase of plan.phases) {
            for (const change of phase.changes) applyChange(change)
        }
    } catch (error) {
        rollback()
        throw error
    }

    return {
        applied,
        backupDir,
        rollback,
        cleanup: () => rmSync(backupDir, { recursive: true, force: true }),
    }
}
