export interface ProviderIds {
	tvdb?: string;
	tmdb?: string;
	imdb?: string;
}

export interface LibraryFile {
	id: number;
	path: string;
	sizeBytes: number;
	episodeIds: number[];
}

export interface LibraryEpisode {
	id: number;
	seasonNumber: number;
	episodeNumber: number;
	title: string;
	airDate?: string;
	fileId?: number;
	monitored: boolean;
}

export interface LibraryItem {
	service: string;
	id: number;
	mediaKind: "series" | "movie";
	title: string;
	year?: number;
	providerIds: ProviderIds;
	path: string;
	sizeBytes: number;
	addedAt?: string;
	status: string;
	monitored: boolean;
	tags: string[];
	ratings: Array<{ source: string; value: number; scale: number; votes?: number }>;
	seasons: Array<{ seasonNumber: number; monitored: boolean }>;
	episodes: LibraryEpisode[];
	files: LibraryFile[];
	complete: boolean;
	apiFamily: 3 | 5;
}

export interface LibrarySnapshot {
	items: LibraryItem[];
	complete: boolean;
	errors: Array<{ service: string; message: string }>;
	observedAt: string;
}

export interface ViewerScope {
	server: string;
	userId: string;
}

export interface WatchEvidence {
	complete: boolean;
	activePlayback: boolean | null;
	favourite: boolean | null;
	viewers: Array<{
		server: string;
		userId: string;
		status: "watched" | "partial" | "unwatched" | "unknown";
		lastWatchedAt?: string;
		episodes: Array<{
			seasonNumber: number;
			episodeNumber: number;
			status: "watched" | "partial" | "unwatched" | "unknown";
		}>;
	}>;
	blockers: string[];
}
