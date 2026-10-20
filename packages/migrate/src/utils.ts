import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
    cpSync,
    existsSync,
    mkdirSync,
    readdirSync,
    readFileSync,
    rmSync,
    statSync,
    writeFileSync,
} from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import * as jsonc from 'jsonc-parser'
import type { CommandResult, JsoncEdit } from './types.ts'

export const JSON_FORMAT = {
    insertSpaces: true,
    tabSize: 4,
    eol: '\n',
}

export function readText(path: string): string {
    return readFileSync(path, 'utf8')
}

export function readJson<T = unknown>(path: string): T {
    return JSON.parse(readText(path)) as T
}

export function readJsonc<T = unknown>(path: string): T {
    const errors: jsonc.ParseError[] = []
    const value = jsonc.parse(readText(path), errors, {
        allowTrailingComma: true,
        disallowComments: false,
    }) as T
    if (errors.length > 0) {
        throw new Error(`Invalid JSONC: ${path}`)
    }
    return value
}

export function writeText(path: string, content: string): void {
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, content, 'utf8')
}

export function writeJsonc(path: string, value: unknown): void {
    writeText(path, `${JSON.stringify(value, null, 4)}\n`)
}

export function applyJsoncEdits(path: string, edits: JsoncEdit[]): void {
    let text = readText(path)
    for (const edit of edits) {
        text = jsonc.applyEdits(
            text,
            jsonc.modify(text, edit.path, edit.value, {
                formattingOptions: JSON_FORMAT,
            })
        )
    }
    writeText(path, text)
}

export function pathExists(path: string): boolean {
    return existsSync(path)
}

export function isDirectory(path: string): boolean {
    try {
        return statSync(path).isDirectory()
    } catch {
        return false
    }
}

export function ensureDir(path: string): void {
    mkdirSync(path, { recursive: true })
}

export function removePath(path: string): void {
    rmSync(path, { recursive: true, force: true })
}

export function copyPath(from: string, to: string): void {
    mkdirSync(dirname(to), { recursive: true })
    cpSync(from, to, { recursive: true })
}

export function relativePath(root: string, path: string): string {
    return relative(root, path).split(sep).join('/')
}

export function isInside(root: string, path: string): boolean {
    const rel = relative(root, path)
    return rel === '' || (!rel.startsWith('..') && !rel.startsWith(sep))
}

export function hashText(value: string): string {
    return createHash('sha256').update(value).digest('hex')
}

export function hashFile(path: string): string {
    return hashText(readText(path))
}

const IGNORED_DIRS = new Set([
    '.git',
    '.next',
    '.turbo',
    '.trace',
    'coverage',
    'dist',
    'node_modules',
])

export function walkFiles(
    root: string,
    options: {
        maxDepth?: number
        filter?: (path: string) => boolean
    } = {}
): string[] {
    const out: string[] = []
    const maxDepth = options.maxDepth ?? Number.POSITIVE_INFINITY

    const walk = (dir: string, depth: number) => {
        if (depth > maxDepth) return
        let entries
        try {
            entries = readdirSync(dir, { withFileTypes: true })
        } catch {
            return
        }
        for (const entry of entries) {
            if (IGNORED_DIRS.has(entry.name)) continue
            const full = join(dir, entry.name)
            if (entry.isDirectory()) {
                walk(full, depth + 1)
            } else if (entry.isFile()) {
                if (!options.filter || options.filter(full)) out.push(full)
            }
        }
    }

    walk(root, 0)
    return out.sort()
}

export function walkPackageJsonFiles(root: string): string[] {
    return walkFiles(root, {
        maxDepth: 8,
        filter: (path) =>
            path.endsWith(`${sep}package.json`) &&
            path !== join(root, 'package.json'),
    })
}

export function runCommand(
    command: string,
    args: string[],
    cwd: string,
    timeoutMs = 15 * 60 * 1000
): CommandResult {
    const started = Date.now()
    const result = spawnSync(command, args, {
        cwd,
        encoding: 'utf8',
        timeout: timeoutMs,
        env: { ...process.env, CI: '1', NO_COLOR: '1' },
        shell: false,
    })
    return {
        command: [command, ...args].join(' '),
        exitCode: result.status ?? (result.error ? 1 : 0),
        stdout: result.stdout ?? '',
        stderr: result.stderr ?? '',
        durationMs: Date.now() - started,
    }
}

export function runPnpmScript(cwd: string, script: string): CommandResult {
    return runCommand('pnpm', ['run', script], cwd)
}

export function runPnpm(cwd: string, args: string[]): CommandResult {
    return runCommand('pnpm', args, cwd)
}

export function formatDuration(ms: number): string {
    if (ms < 1000) return `${ms}ms`
    return `${(ms / 1000).toFixed(1)}s`
}

export function safeName(value: string): string {
    return value.replaceAll(/[^a-zA-Z0-9._-]+/g, '-').replaceAll(/^-+|-+$/g, '')
}

export function resolveFrom(base: string, path: string): string {
    return resolve(base, path)
}

export function ensureTrailingNewline(value: string): string {
    return value.endsWith('\n') ? value : `${value}\n`
}
