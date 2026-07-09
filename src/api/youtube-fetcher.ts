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

function spawnP(bin: string, args: string[]): Promise<void> {
    return new Promise((done, reject) => {
        const child = spawn(bin, args, { stdio: 'inherit', shell: false, env: childEnv });
        child.on('error', reject);
        child.on('close', (code) =>
            code === 0 ? done() : reject(new Error(`${bin} exited with code ${code}`)),
        );
    });
}

function ytArgs(query: string, outputTemplate: string): string[] {
    const common = [`ytsearch1:${query}`, '--output', outputTemplate, '--no-playlist'];
    return [...common, '--extract-audio', '--audio-format', 'mp3', '--audio-quality', '0'];
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
    await spawnP(YTDLP_BIN, ytArgs(query, join(dir, `${name}.%(ext)s`)));

    await writeMetadata(finalPath, format, meta);
    return finalPath;
}