export interface Album {
    name: string;
    release_date: string;
    images: AlbumImage[];
}

export interface AlbumImage {
    url: string;
    height: number;
    width: number;
}
