import ffmpegPath from 'ffmpeg-static';
import ffprobe from 'ffprobe-static';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, renameSync, unlinkSync } from 'node:fs';
import { dirname, delimiter, join } from 'node:path';
import { homedir } from 'node:os';
import { TrackMeta } from '@/src/types/track';
import { app } from 'electron';
export type Format = 'mp3';
export type Logger = (line: string) => void;
import { ProcessError, StopError, SkipTrack } from '@/src/types/error';

const YTDLP_BIN = app.isPackaged
    ? join(process.resourcesPath, 'bin', 'yt-dlp')
    : join(process.cwd(), 'node_modules/youtube-dl-exec/bin/yt-dlp');

export function findDeno(): string | null {
    const candidates = [
        '/opt/homebrew/bin/deno',                    // Apple Silicon Homebrew
        '/usr/local/bin/deno',                       // Intel Homebrew
        join(homedir(), '.deno', 'bin', 'deno'),     // curl installer
        join(homedir(), '.deno', 'bin', 'deno.exe'), // Windows (if ever)
    ];
    for (const p of candidates) if (existsSync(p)) return p;
    return null;
}

const extraBinDirs = [dirname(ffmpegPath), dirname(ffprobe.path)];
const denoPath = findDeno();
if (denoPath) extraBinDirs.push(dirname(denoPath));

const childEnv: NodeJS.ProcessEnv = {
    ...process.env,
    PATH: [...extraBinDirs, process.env.PATH ?? ''].join(delimiter),
};

const COOKIES_FROM_BROWSER = '';
const COOKIES_FILE = '';

export function safeName(input: string): string {
    const cleaned = input
        .replace(/[\\/:*?"<>|]/g, '')
        .replace(/\s+/g, ' ')
        .trim()
        .replace(/[. ]+$/, '');
    return cleaned || 'Unknown';
}

function spawnP(bin: string, args: string[], log?: Logger, signal?: AbortSignal): Promise<void> {
    const out = log ?? ((s: string) => console.log(s));

    return new Promise((done, reject) => {
        const child = spawn(bin, args, { shell: false, env: childEnv, signal });
        let stderrText = '';
        const forward = (buf: Buffer) => {
            for (const line of buf.toString().replace(/\r/g, '\n').split('\n')) {
                if (line.trim()) out(line.trimEnd());
            }
        };
        child.stdout?.on('data', forward);
        child.stderr?.on('data', (d: Buffer) => { stderrText += d.toString(); forward(d); });
        child.on('error', reject);
        child.on('close', (code) =>

            code === 0 ? done() : reject(new ProcessError(`${bin} exited with code ${code}`, stderrText)),
        );
    });
}

function cookieArgs(): string[] {
    if (COOKIES_FILE) return ['--cookies', COOKIES_FILE];
    if (COOKIES_FROM_BROWSER) return ['--cookies-from-browser', COOKIES_FROM_BROWSER];
    return [];
}

function ytArgs(query: string, outputTemplate: string): string[] {
    const common = [
        `ytsearch1:${query}`,
        '--output', outputTemplate,
        '--no-playlist',
        ...cookieArgs(),
    ];
    return [...common, '--extract-audio', '--audio-format', 'mp3', '--audio-quality', '0'];
}

function permanentReason(err: unknown): string | null {
    const text = err instanceof ProcessError ? err.stderr : String(err);
    if (/Sign in to confirm your age/i.test(text)) return 'AGE-RESTRICTED';
    if (/(Private video|This video is private)/i.test(text)) return 'PRIVATE';
    if (/(Video unavailable|is not available|no longer available|has been removed|been terminated)/i.test(text))
        return 'UNAVAILABLE';
    return null;
}

const RETRY_CAP_MS = 30_000;

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
        if (signal?.aborted) return reject(new StopError());
        const t = setTimeout(() => { cleanup(); resolve(); }, ms);
        const onAbort = () => { cleanup(); reject(new StopError()); };
        const cleanup = () => { clearTimeout(t); signal?.removeEventListener('abort', onAbort); };
        signal?.addEventListener('abort', onAbort, { once: true });
    });
}

async function withRetry<T>(
    fn: () => Promise<T>,
    label: string,
    log?: Logger,
    signal?: AbortSignal,
): Promise<T> {
    const out = log ?? ((s: string) => console.log(s));
    for (let attempt = 1; ; attempt += 1) {
        if (signal?.aborted) throw new StopError();
        try {
            return await fn();
        } catch (err) {
            if (signal?.aborted || err instanceof StopError) throw new StopError();
            const reason = permanentReason(err);
            if (reason) throw new SkipTrack(reason);
            const waitMs = Math.min(1500 * attempt, RETRY_CAP_MS);
            out('---------------------------------------------------------------------------------------------------');
            out(`[RETRY] (╥﹏╥) attempt ${attempt} failed. Retrying in ${waitMs / 1000}s...`);
            await sleep(waitMs, signal);
        }
    }
}

async function writeMetadata(file: string, format: Format, meta: TrackMeta, log?: Logger): Promise<void> {
    if (!existsSync(file)) return;
    const tmp = file.replace(new RegExp(`\\.${format}$`), `.tagging.${format}`);
    await spawnP(ffmpegPath, [
        '-i', file,
        '-c', 'copy',
        '-metadata', `title=${meta.title}`,
        '-metadata', `artist=${meta.artists.join(', ')}`,
        '-metadata', `album=${meta.album}`,
        '-y', tmp,
    ], log);
    unlinkSync(file);
    renameSync(tmp, file);
}

function targetDir(base: string, meta: TrackMeta): string {
    const artist = safeName(meta.artists[0] ?? 'Unknown Artist');
    const album = safeName(meta.album || 'Unknown Album');
    return join(base, artist, album);
}

export async function downloadTrack(
    meta: TrackMeta,
    format: Format,
    baseDir: string,
    log?: Logger,
    signal?: AbortSignal,
): Promise<string> {
    const out = log ?? ((s: string) => console.log(s));
    const dir = targetDir(baseDir, meta);
    const name = safeName(meta.title);
    const finalPath = join(dir, `${name}.${format}`);

    out('---------------------------------------------------------------------------------------------------');

    if (existsSync(finalPath)) {
        out(`[SKIPPING DUPLICATES] ᕙ( ᗒᗣᗕ )ᕗ ${meta.artists.join(', ')} - ${meta.album} - ${meta.title}`);
        return finalPath;
    }

    mkdirSync(dir, { recursive: true });

    const query = `${meta.artists.join(' ')} ${meta.title}`;
    out(`[DOWNLOADING] ♡⸜(˶˃ ᵕ ˂˶)⸝♡ ${meta.artists.join(', ')} - ${meta.album} - ${meta.title}`);
    try {
        await withRetry(
            () => spawnP(YTDLP_BIN, ytArgs(query, join(dir, `${name}.%(ext)s`)), log, signal),
            'YouTube 403/network',
            log,
            signal,
        );
    } catch (err) {
        if (err instanceof SkipTrack) {
            out(`[SKIPPING ${err.reason}] (ノಠ益ಠ)ノ彡┻━┻ ${meta.artists.join(', ')} - ${meta.album} - ${meta.title}`);
            return finalPath;
        }
        throw err;
    }

    await writeMetadata(finalPath, format, meta, log);
    return finalPath;
}