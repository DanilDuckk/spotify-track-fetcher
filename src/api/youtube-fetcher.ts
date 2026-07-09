import ytdlp from 'youtube-dl-exec';
import ffmpegPath from 'ffmpeg-static';
import ffprobe from 'ffprobe-static';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, renameSync, unlinkSync } from 'node:fs';
import { dirname, delimiter, join } from 'node:path';
import {TrackMeta} from "@/src/types/track";
export type Format = 'mp3';

const YTDLP_BIN = (
    ytdlp as unknown as { constants: { YOUTUBE_DL_PATH: string } }
).constants.YOUTUBE_DL_PATH;

const childEnv: NodeJS.ProcessEnv = {
    ...process.env,
    PATH: [dirname(ffmpegPath), dirname(ffprobe.path), process.env.PATH ?? ''].join(
        delimiter,
    ),
};

export function safeName(input: string): string {
    const cleaned = input
        .replace(/[\\/:*?"<>|]/g, '')
        .replace(/\s+/g, ' ')
        .trim()
        .replace(/[. ]+$/, '');
    return cleaned || 'Unknown';
}

class ProcessError extends Error {
    constructor(message: string, readonly stderr: string) {
        super(message);
    }
}

function spawnP(bin: string, args: string[]): Promise<void> {
    return new Promise((done, reject) => {
        const child = spawn(bin, args, { shell: false, env: childEnv });
        let stderrText = '';
        child.stdout?.on('data', (d: Buffer) => process.stdout.write(d));
        child.stderr?.on('data', (d: Buffer) => {
            stderrText += d.toString();
            process.stderr.write(d);
        });
        child.on('error', reject);
        child.on('close', (code) =>
            code === 0
                ? done()
                : reject(new ProcessError(`${bin} exited with code ${code}`, stderrText)),
        );
    });
}

const COOKIES_FROM_BROWSER = '';
const COOKIES_FILE = '';

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

class SkipTrack extends Error {
    constructor(readonly reason: string) {
        super(reason);
    }
}

const RETRY_CAP_MS = 30_000;

async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
    for (let attempt = 1; ; attempt += 1) {
        try {
            return await fn();
        } catch (err) {
            const reason = permanentReason(err);
            if (reason) throw new SkipTrack(reason);

            const waitMs = Math.min(1500 * attempt, RETRY_CAP_MS);
            console.log("\n---------------------------------------------------------------------------------------------------");
            console.log(
                `\n[RETRY] (╥﹏╥) attempt ${attempt} failed, retrying in ${waitMs / 1000}s...`,
            );
            await new Promise((r) => setTimeout(r, waitMs));
        }
    }
}

async function writeMetadata(
    file: string,
    format: Format,
    meta: TrackMeta,
): Promise<void> {
    if (!existsSync(file)) return;
    const tmp = file.replace(new RegExp(`\\.${format}$`), `.tagging.${format}`);
    await spawnP(ffmpegPath, [
        '-i', file,
        '-c', 'copy',
        '-metadata', `title=${meta.title}`,
        '-metadata', `artist=${meta.artists.join(', ')}`,
        '-metadata', `album=${meta.album}`,
        '-y', tmp,
    ]);
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
): Promise<string> {
    const dir = targetDir(baseDir, meta);
    const name = safeName(meta.title);
    const finalPath = join(dir, `${name}.${format}`);

    console.log("\n---------------------------------------------------------------------------------------------------");

    if (existsSync(finalPath)) {
        console.log(`\n[SKIPPING DUPLICATES] ᕙ( ᗒᗣᗕ )ᕗ ${meta.artists.join(', ')} - ${meta.album} - ${meta.title}`);
        return finalPath;
    }

    mkdirSync(dir, { recursive: true });

    const query = `${meta.artists.join(' ')} ${meta.title}`;
    console.log(`\n[DOWNLOADING] ♡⸜(˶˃ ᵕ ˂˶)⸝♡ ${meta.artists.join(', ')} - ${meta.album} - ${meta.title}`);
    try {
        await withRetry(
            () => spawnP(YTDLP_BIN, ytArgs(query, join(dir, `${name}.%(ext)s`))),
        );
    } catch (err) {
        if (err instanceof SkipTrack) {
            console.log(
                `\n[SKIPPING ${err.reason}] (ノಠ益ಠ)ノ彡┻━┻ ${meta.artists.join(', ')} - ${meta.album} - ${meta.title}`,
            );
            return finalPath;
        }
        throw err;
    }

    await writeMetadata(finalPath, format, meta);
    return finalPath;
}