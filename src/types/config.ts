export interface SpotifyConfig {
  clientId: string;
  clientSecret: string;
  playlistId: string;
  cacheDir: string;
  redirectUri?: string;
}

export interface DownloadConfig {
  playlistId: string;
  clientId: string;
  clientSecret: string;
  downloadDir: string;
}