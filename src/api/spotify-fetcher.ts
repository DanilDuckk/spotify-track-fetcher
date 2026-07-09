import 'dotenv/config';
import http from 'node:http';
import crypto from 'node:crypto';
import { exec } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import {PlaylistEntry, PlaylistMeta} from "@/src/types/playlist";
import { ItemsPage } from "@/src/types/track";

const TOKEN_FILE = join(process.cwd(), '.spotify-cache.json');

function requireEnv(name: string): string {
    const value = process.env[name];
    if (!value) throw new Error(`Env variable ${name} is not set.`);
    return value;
}

const CLIENT_ID = requireEnv('CLIENT_ID');
const CLIENT_SECRET = requireEnv('CLIENT_SECRET');
const PLAYLIST_ID = requireEnv('PLAYLIST_ID');
const REDIRECT_URI = process.env.REDIRECT_URI ?? 'http://127.0.0.1:8888/callback';

const SCOPE = 'playlist-read-private';
const AUTH_URL = 'https://accounts.spotify.com/authorize';
const TOKEN_URL = 'https://accounts.spotify.com/api/token';
const API_BASE = 'https://api.spotify.com/v1';

function getAuthCode(): Promise<string> {
    const state = crypto.randomBytes(16).toString('hex');
    const params = new URLSearchParams({
        client_id: CLIENT_ID,
        response_type: 'code',
        redirect_uri: REDIRECT_URI,
        scope: SCOPE,
        state,
    });
    const authUrl = `${AUTH_URL}?${params.toString()}`;
    const port = Number(new URL(REDIRECT_URI).port) || 8888;

    return new Promise<string>((resolve, reject) => {
        const server = http.createServer((req, res) => {
            const url = new URL(req.url ?? '', `http://127.0.0.1:${port}`);
            const code = url.searchParams.get('code');
            const err = url.searchParams.get('error');
            if (!code && !err) {
                res.writeHead(204);
                res.end();
                return;
            }
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end('Authorization complete. You can close this window.');
            server.close();
            if (err) reject(new Error(`Authorization rejected: ${err}`));
            else if (url.searchParams.get('state') !== state)
                reject(new Error('State does not match. Possible CSRF attack.'));
            else resolve(code as string);
        });
        server.listen(port, '127.0.0.1', () => {
            console.log('Opening browser for authorization...');
            openBrowser(authUrl);
        });
    });
}

function openBrowser(url: string): void {
    const cmd =
        process.platform === 'darwin'
            ? 'open'
            : process.platform === 'win32'
                ? 'start ""'
                : 'xdg-open';
    exec(`${cmd} "${url}"`, (error) => {
        if (error) console.log(`Open manually:\n${url}`);
    });
}

interface TokenResponse {
    access_token: string;
    refresh_token?: string;
}

function loadRefreshToken(): string | null {
    try {
        if (!existsSync(TOKEN_FILE)) return null;
        const data = JSON.parse(readFileSync(TOKEN_FILE, 'utf8')) as {
            refresh_token?: string;
        };
        return data.refresh_token ?? null;
    } catch {
        return null;
    }
}

function saveRefreshToken(token: string): void {
    writeFileSync(TOKEN_FILE, JSON.stringify({ refresh_token: token }, null, 2));
}

async function tokenRequest(body: URLSearchParams): Promise<TokenResponse> {
    const basic = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64');
    const resp = await fetch(TOKEN_URL, {
        method: 'POST',
        headers: {
            Authorization: `Basic ${basic}`,
            'Content-Type': 'application/x-www-form-urlencoded',
        },
        body,
    });
    if (!resp.ok) throw new Error(`Token error ${resp.status}: ${await resp.text()}`);
    return (await resp.json()) as TokenResponse;
}

async function authorize(): Promise<string> {
    const cached = loadRefreshToken();

    if (cached) {
        try {
            const data = await tokenRequest(
                new URLSearchParams({ grant_type: 'refresh_token', refresh_token: cached }),
            );
            if (data.refresh_token) saveRefreshToken(data.refresh_token);
            console.log('Auth from cached token.');
            return data.access_token;
        } catch {
            console.log('Cached token is invalid, reauthorization needed.');
        }
    }

    const code = await getAuthCode();
    const data = await tokenRequest(
        new URLSearchParams({
            grant_type: 'authorization_code',
            code,
            redirect_uri: REDIRECT_URI,
        }),
    );
    if (data.refresh_token) saveRefreshToken(data.refresh_token);
    return data.access_token;
}

async function fetchPlaylist(
    token: string,
): Promise<{ info: PlaylistMeta; items: PlaylistEntry[] }> {
    const headers = { Authorization: `Bearer ${token}` };

    const metaFields = encodeURIComponent('name,owner(display_name),items(total)');
    const metaResp = await fetch(
        `${API_BASE}/playlists/${PLAYLIST_ID}?fields=${metaFields}`,
        { headers },
    );
    if (!metaResp.ok)
        throw new Error(`Playlist error ${metaResp.status}: ${await metaResp.text()}`);
    const info = (await metaResp.json()) as PlaylistMeta;

    const items: PlaylistEntry[] = [];
    const itemFields = encodeURIComponent(
        'items(item(name,artists(name),album(name,release_date,images),external_urls(spotify))),next',
    );
    let url: string | null =
        `${API_BASE}/playlists/${PLAYLIST_ID}/items?limit=100&fields=${itemFields}`;

    while (url) {
        const resp: Response = await fetch(url, { headers });
        if (!resp.ok)
            throw new Error(`Items error ${resp.status}: ${await resp.text()}`);
        const page = (await resp.json()) as ItemsPage;
        items.push(...page.items);
        url = page.next;
    }
    return { info, items };
}

export async function getPlaylistTracks(): Promise<{
    info: PlaylistMeta;
    items: PlaylistEntry[];
}> {
    const token = await authorize();
    return fetchPlaylist(token);
}