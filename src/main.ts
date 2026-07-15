import { app, BrowserWindow, ipcMain, dialog } from 'electron';
import path from 'node:path';
import { createSpotify } from '@/src/api/spotify-fetcher';
import { downloadTrack, YTDLP_BIN } from '@/src/api/youtube-fetcher';
import { StopError } from '@/src/types/error';
import { DownloadConfig } from '@/src/types/config';

let controller: AbortController | null = null;

function createWindow(): void {
  const win = new BrowserWindow({
    width: 800,
    height: 500,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  win.loadFile(path.join(__dirname, '..', 'index.html'));
    const log = (line: string) => win.webContents.send('log', line);
    const progress = (done: number, total: number) =>
      win.webContents.send('progress', { done, total });

  ipcMain.handle('choose-folder', async () => {
    const result = await dialog.showOpenDialog(win, {
      properties: ['openDirectory', 'createDirectory'],
    });
    return result.canceled ? null : result.filePaths[0];
  });

  ipcMain.handle('stop-download', () => {
    if (controller) {
      controller.abort();
      log('[INFO] Stopping... (finishing current step)');
    }
    return { ok: true };
  });

  ipcMain.handle('start-download', async (_event, config: DownloadConfig) => {


    if (!config.clientId || !config.clientSecret || !config.playlistId) {
      log('[ERROR] Please fill in Playlist ID, Client ID and Client Secret.');
      return { ok: false };
    }
    if (!config.downloadDir) {
      log('[ERROR] Please choose a download folder first.');
      return { ok: false };
    }

    controller = new AbortController();
    const { signal } = controller;

    try {
      const spotify = createSpotify(
        {
          clientId: config.clientId,
          clientSecret: config.clientSecret,
          playlistId: config.playlistId,
          cacheDir: app.getPath('userData'),
        },
        log,
      );

      log('[INFO] Fetching playlist from Spotify...');
      log(`[INFO] yt-dlp binary: ${YTDLP_BIN}`);
      const { info, items } = await spotify.getPlaylistTracks();
      const tracks = items.filter((e) => e.item);
      log(`[INFO] Playlist "${info.name}" — ${tracks.length} tracks. Starting download...`);

      let done = 0;
      let ok = 0;
      let failed = 0;
      for (const entry of items) {
        const track = entry.item;
        if (!track) continue;
        if (signal.aborted) break;

        const meta = {
          title: track.name,
          artists: track.artists.map((a) => a.name),
          album: track.album.name,
        };
        log('---------------------------------------------');
        log(`[STATUS] ${done + 1}/${tracks.length}`);
        try {
          await downloadTrack(meta, 'mp3', config.downloadDir, log, signal);
          ok += 1;
          log(`[INFO] SUCCESS`);
        } catch (err) {
          if (err instanceof StopError) {
            log('[INFO] Stopped by user.');
            break;
          }
          failed += 1;
          log(`[ERROR] ${err instanceof Error ? err.message : String(err)}`);
        }
        done += 1;
        progress(done, tracks.length);
      }

      if (!signal.aborted) {
        log(`[INFO] Done. Success: ${ok}, failed: ${failed}. Folder: ${config.downloadDir}`);
      }
      return { ok: true, stopped: signal.aborted };
    } catch (err) {
      if (err instanceof StopError) {
        log('[INFO] Stopped by user.');
        return { ok: false, stopped: true };
      }
      log(`[ERROR] ${err instanceof Error ? err.message : String(err)}`);
      return { ok: false };
    } finally {
      controller = null;
    }
  });
}

app.whenReady().then(createWindow);
app.on('window-all-closed', () => app.quit());