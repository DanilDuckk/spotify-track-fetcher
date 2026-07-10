import { app, BrowserWindow, ipcMain } from 'electron';
import path from 'node:path';

interface DownloadConfig {
  playlistId: string;
  clientId: string;
  clientSecret: string;
}

function createWindow(): void {
  const win = new BrowserWindow({
    width: 900,
    height: 650,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));

  ipcMain.handle('start-download', async (_event, config: DownloadConfig) => {
    const log = (line: string) => win.webContents.send('log', line);
    const progress = (done: number, total: number) =>
      win.webContents.send('progress', { done, total });

    log('Config:');
    log('  PLAYLIST_ID = ' + (config.playlistId || '(empty)'));
    log('  CLIENT_ID = ' + (config.clientId || '(empty)'));
    log('  CLIENT_SECRET = ' + (config.clientSecret ? '******' : '(empty)'));

    // ЗАГЛУШКА: імітуємо прогрес, щоб перевірити конвеєр IPC.
    const total = 5;
    for (let done = 1; done <= total; done += 1) {
      await new Promise((r) => setTimeout(r, 500));
      log('[FAKE] track ' + done + '/' + total + ' downloaded');
      progress(done, total);
    }
    log('Done (fake). Now we connect the real logic.');
    return { ok: true };
  });
}

app.whenReady().then(createWindow);
app.on('window-all-closed', () => app.quit());