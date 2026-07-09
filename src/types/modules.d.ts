declare module 'ffmpeg-static' {
    const path: string;
    export default path;
}

declare module 'ffprobe-static' {
    const ffprobe: { path: string; version: string };
    export default ffprobe;
}