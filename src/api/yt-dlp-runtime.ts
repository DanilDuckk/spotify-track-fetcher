import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { delimiter, join } from 'node:path';

interface ResolveToolCommandOptions {
    env?: NodeJS.ProcessEnv;
    pathEntries?: string[];
}

function readPythonVersion(candidate: string): string | null {
    try {
        const result = spawnSync(candidate, ['-c', 'import sys; print(f"{sys.version_info[0]}.{sys.version_info[1]}")'], {
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'ignore'],
        });

        if (result.status === 0 && typeof result.stdout === 'string') {
            const version = result.stdout.trim();
            return version || null;
        }
    } catch {
        // Ignore and try other candidates.
    }

    return null;
}

function isPythonVersionSupported(version: string | null): boolean {
    if (!version) return false;
    const match = version.match(/^(\d+)\.(\d+)/);
    if (!match) return false;
    const major = Number(match[1]);
    const minor = Number(match[2]);
    return major > 3 || (major === 3 && minor >= 10);
}

function isPythonScript(path: string): boolean {
    try {
        const firstLine = readFileSync(path, 'utf8').split(/\r?\n/, 1)[0] ?? '';
        return firstLine.startsWith('#!') && /python/i.test(firstLine);
    } catch {
        return false;
    }
}

function normalizeCandidates(env: NodeJS.ProcessEnv, pathEntries: string[]): string[] {
    const explicitPython = [env.PYTHON, env.PYTHON3].filter((value): value is string => Boolean(value));
    const fromPath = pathEntries.flatMap((entry) => [
        join(entry, 'python3'),
        join(entry, 'python3.10'),
        join(entry, 'python3.11'),
        join(entry, 'python3.12'),
        join(entry, 'python3.13'),
    ]);

    return [...explicitPython, ...fromPath, '/opt/homebrew/bin/python3', '/usr/local/bin/python3', '/usr/bin/python3'];
}

export function resolveToolCommand(path: string, options: ResolveToolCommandOptions = {}): { command: string; args: string[] } {
    if (!isPythonScript(path)) {
        return { command: path, args: [] };
    }

    const env = options.env ?? process.env;
    const pathEntries = options.pathEntries ?? (env.PATH ?? '').split(delimiter).filter(Boolean);
    const candidates = normalizeCandidates(env, pathEntries);

    for (const candidate of candidates) {
        const version = readPythonVersion(candidate);
        if (isPythonVersionSupported(version)) {
            return { command: candidate, args: [path] };
        }
    }

    return { command: path, args: [] };
}
