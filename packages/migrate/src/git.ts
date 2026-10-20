import { spawnSync } from 'node:child_process'
import { removePath } from './utils.ts'

function git(root: string, args: string[]) {
    return spawnSync('git', args, {
        cwd: root,
        encoding: 'utf8',
        shell: false,
    })
}

export function isGitRepo(root: string): boolean {
    return git(root, ['rev-parse', '--is-inside-work-tree']).status === 0
}

export function isClean(root: string): boolean {
    const result = git(root, ['status', '--porcelain'])
    return result.status === 0 && result.stdout.trim() === ''
}

export function currentBranch(root: string): string | undefined {
    const result = git(root, ['branch', '--show-current'])
    return result.status === 0 ? result.stdout.trim() : undefined
}

export function currentHead(root: string): string | undefined {
    const result = git(root, ['rev-parse', 'HEAD'])
    return result.status === 0 ? result.stdout.trim() : undefined
}

export function restorePaths(root: string, paths: string[]): void {
    if (paths.length === 0) return
    git(root, [
        'restore',
        '--source=HEAD',
        '--staged',
        '--worktree',
        '--',
        ...paths,
    ])
}

export function removeUntracked(paths: string[]): void {
    for (const path of paths) removePath(path)
}

export function createBranch(root: string, branch: string): boolean {
    return git(root, ['switch', '-c', branch]).status === 0
}

export function commitPaths(
    root: string,
    paths: string[],
    message: string
): boolean {
    if (paths.length === 0) return true
    const add = git(root, ['add', '--', ...paths])
    if (add.status !== 0) return false
    return git(root, ['commit', '-m', message]).status === 0
}

export function gitStatus(root: string): string {
    return git(root, ['status', '--short']).stdout.trim()
}
