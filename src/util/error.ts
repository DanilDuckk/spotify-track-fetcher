export function requireEnv(name: string): string {
    const value = process.env[name];
    if (!value) throw new Error(`Env variable ${name} is not set.`);
    return value;
}

export function isSpawnError(err: unknown): boolean {
    const code = (err as NodeJS.ErrnoException | undefined)?.code;
    return code === 'ENOENT' || code === 'EACCES';
}