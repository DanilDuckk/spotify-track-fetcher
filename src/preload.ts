import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('api', {
  startDownload: (config: unknown) => ipcRenderer.invoke('start-download', config),
  stop: () => ipcRenderer.invoke('stop-download'),
  chooseFolder: (): Promise<string | null> => ipcRenderer.invoke('choose-folder'),
  onLog: (cb: (line: string) => void) =>
    ipcRenderer.on('log', (_e, line: string) => cb(line)),
  onProgress: (cb: (p: { done: number; total: number }) => void) =>
    ipcRenderer.on('progress', (_e, p: { done: number; total: number }) => cb(p)),
});