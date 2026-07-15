import http from 'node:http';
import crypto from 'node:crypto';
import { exec } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { SpotifyConfig } from '@/src/types/config';
import { ItemsPage } from '@/src/types/track';
import { PlaylistMeta, PlaylistEntry } from '@/src/types/playlist';

const AUTH_URL = 'https://accounts.spotify.com/authorize';
const TOKEN_URL = 'https://accounts.spotify.com/api/token';
const API_BASE = 'https://api.spotify.com/v1';
const SCOPE = 'playlist-read-private';

type Logger = (line: string) => void;

export function createSpotify(cfg: SpotifyConfig, log: Logger = console.log) {
  const redirectUri = cfg.redirectUri ?? 'http://127.0.0.1:8888/callback';
  const tokenFile = join(cfg.cacheDir, '.cache.json');

  function loadRefreshToken(): string | null {
    try {
      if (!existsSync(tokenFile)) return null;
      const data = JSON.parse(readFileSync(tokenFile, 'utf8')) as { refresh_token?: string };
      return data.refresh_token ?? null;
    } catch { return null; }
  }
  
  function saveRefreshToken(token: string): void {
    writeFileSync(tokenFile, JSON.stringify({ refresh_token: token }, null, 2));
  }

  function getAuthCode(): Promise<string> {
    const state = crypto.randomBytes(16).toString('hex');
    
    const params = new URLSearchParams({
      client_id: cfg.clientId, response_type: 'code', redirect_uri: redirectUri, scope: SCOPE, state,
    });
    
    const authUrl = `${AUTH_URL}?${params.toString()}`;
    const port = Number(new URL(redirectUri).port) || 8888;
    
    return new Promise<string>((resolve, reject) => {
      const server = http.createServer((req, res) => {
        const url = new URL(req.url ?? '', `http://127.0.0.1:${port}`);
        const code = url.searchParams.get('code');
        const err = url.searchParams.get('error');
        if (!code && !err) { res.writeHead(204); res.end(); return; }
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end('Done! You can close this tab.');
        server.close();
        if (err) reject(new Error(`Authorization denied: ${err}`));
        else if (url.searchParams.get('state') !== state) reject(new Error('State mismatch — possible CSRF.'));
        else resolve(code as string);
      });
      
      server.listen(port, '127.0.0.1', () => {
        log('Opening browser for authorization...');
        const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start ""' : 'xdg-open';
        exec(`${cmd} "${authUrl}"`, (e) => { if (e) log(`Open manually: ${authUrl}`); });
      });
    });
  }

  async function tokenRequest(body: URLSearchParams) {
    const basic = Buffer.from(`${cfg.clientId}:${cfg.clientSecret}`).toString('base64');
    
    const resp = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { Authorization: `Basic ${basic}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
    
    if (!resp.ok) throw new Error(`Token error ${resp.status}: ${await resp.text()}`);
    
    return (await resp.json()) as { access_token: string; refresh_token?: string };
  }

  async function authorize(): Promise<string> {
    const cached = loadRefreshToken();
    
    if (cached) {
      try {
        const data = await tokenRequest(new URLSearchParams({ grant_type: 'refresh_token', refresh_token: cached }));
        if (data.refresh_token) saveRefreshToken(data.refresh_token);
        log('[INFO] Authorized from cache.');
        return data.access_token;
      } catch { log('Cached token invalid, re-authorization required.'); }
    }
    
    const code = await getAuthCode();
    const data = await tokenRequest(new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: redirectUri }));
    
    if (data.refresh_token) saveRefreshToken(data.refresh_token);
    
    return data.access_token;
  }

  async function fetchPlaylist(token: string): Promise<{ info: PlaylistMeta; items: PlaylistEntry[] }> {
    const headers = { Authorization: `Bearer ${token}` };
    const metaFields = encodeURIComponent('name,owner(display_name),items(total)');
    const metaResp = await fetch(`${API_BASE}/playlists/${cfg.playlistId}?fields=${metaFields}`, { headers });

    if (!metaResp.ok) throw new Error(`Playlist error ${metaResp.status}: ${await metaResp.text()}`);
   
    const info = (await metaResp.json()) as PlaylistMeta;
    const items: PlaylistEntry[] = [];
    const itemFields = encodeURIComponent('items(item(name,artists(name),album(name,release_date,images),external_urls(spotify))),next');
    
    let url: string | null = `${API_BASE}/playlists/${cfg.playlistId}/items?limit=100&fields=${itemFields}`;
    
    while (url) {
      const resp: Response = await fetch(url, { headers });
      if (!resp.ok) throw new Error(`Items error ${resp.status}: ${await resp.text()}`);
      const page = (await resp.json()) as ItemsPage;
      items.push(...page.items);
      url = page.next;
    }
   
    return { info, items };
  }

  return {
    async getPlaylistTracks() {
      const token = await authorize();
      return fetchPlaylist(token);
    },
  };
}