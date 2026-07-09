import { getPlaylistTracks } from '@/src/api/spotify-fetcher';
import { downloadTrack } from '@/src/api/youtube-fetcher';
import { TrackMeta } from "@/src/types/track";

const OUT_DIR = './downloads';

async function main(): Promise<void> {
    const { info, items } = await getPlaylistTracks();
    console.log(`\nPlaylist: ${info.name} -> ${info.items.total} tracks.`);

    let ok = 0;
    let failed = 0;

    for (const entry of items) {
        const track = entry.item;
        if (!track) continue;

        const meta: TrackMeta = {
            title: track.name,
            artists: track.artists.map((a) => a.name),
            album: track.album.name,
        };

        try {
            const path = await downloadTrack(meta, 'mp3', OUT_DIR);
            console.log(`  ✓ ${path}`);
            ok += 1;
        } catch (err) {
            failed += 1;
            console.error(`  ✗ ${meta.title}: ${err instanceof Error ? err.message : err}`);
        }
    }

    console.log("\n---------------------------------------------------------------------------------------------------");
    console.log(`\n[FINISHED] ( ˶ˆᗜˆ˵ )`);
    console.log(`Good boys: ${ok}, Naughty morons: ${failed}.`)
    console.log(`Dir path ./${OUT_DIR}/`)
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});