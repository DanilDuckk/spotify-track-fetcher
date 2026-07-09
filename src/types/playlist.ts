import { Track } from "@/src/types/track";

export interface PlaylistMeta {
    name: string;
    owner: { display_name: string };
    items: { total: number };
}

export interface PlaylistEntry {
    item: Track | null;
}
