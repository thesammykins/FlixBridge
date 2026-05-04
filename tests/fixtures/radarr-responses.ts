/**
 * Radarr v3 API Response Fixtures
 * Based on official Radarr v3 OpenAPI specification
 */

export const radarrSystemStatus = {
	appName: "Radarr",
	instanceName: "radarr-main",
	version: "5.2.6.8376",
	buildTime: "2024-01-15T08:00:00Z",
	isDebug: false,
	isProduction: true,
	isAdmin: true,
	isUserInteractive: false,
	startupPath: "/app/radarr",
	appData: "/config",
	osName: "ubuntu",
	osVersion: "22.04",
	isMonoRuntime: false,
	isMono: false,
	isLinux: true,
	isOsx: false,
	isWindows: false,
	isDocker: true,
	mode: "console",
	branch: "master",
	databaseType: "sqlite3",
	databaseVersion: "3.43.2",
	authentication: "forms",
	migrationVersion: 234,
	urlBase: "",
	runtimeVersion: "8.0.0",
	runtimeName: ".NET",
	startTime: "2024-01-15T10:30:00Z",
	packageVersion: "5.2.6.8376",
	packageAuthor: "[Team Radarr]",
	packageUpdateMechanism: "docker",
};

export const radarrQueueResponse = {
	page: 1,
	pageSize: 25,
	sortKey: "progress",
	sortDirection: "descending",
	totalRecords: 3,
	records: [
		{
			id: 201,
			movieId: 101,
			movie: {
				id: 101,
				title: "The Matrix",
				sortTitle: "matrix",
				sizeOnDisk: 0,
				status: "released",
				overview: "Set in the 22nd century...",
				inCinemas: "1999-03-24T00:00:00Z",
				digitalRelease: "1999-06-01T00:00:00Z",
				physicalRelease: "1999-09-21T00:00:00Z",
				images: [],
				website: "",
				year: 1999,
				hasFile: false,
				youTubeTrailerId: "",
				studio: "Warner Bros.",
				path: "/media/movies/The Matrix (1999)",
				qualityProfileId: 2,
				monitored: true,
				minimumAvailability: "announced",
				isAvailable: true,
				folderName: "The Matrix (1999)",
				runtime: 136,
				cleanTitle: "matrix",
				imdbId: "tt0133093",
				tmdbId: 603,
				titleSlug: "the-matrix-603",
				certification: "R",
				genres: ["Action", "Science Fiction"],
				tags: [],
				added: "2024-01-15T09:00:00Z",
				ratings: {
					imdb: { votes: 1500000, value: 8.7 },
					tmdb: { votes: 20000, value: 8.2 },
				},
				movieFile: null,
			},
			languages: [
				{
					id: 1,
					name: "English",
				},
			],
			quality: {
				quality: {
					id: 7,
					name: "Bluray-1080p",
					source: "bluray",
					resolution: 1080,
					modifier: "none",
				},
				revision: {
					version: 1,
					real: 0,
					isRepack: false,
				},
			},
			customFormats: [
				{
					id: 1,
					name: "2160p - Notifiarr",
				},
				{
					id: 2,
					name: "DD+ ATMOS - Notifiarr",
				},
			],
			customFormatScore: 3105,
			size: 15728640000,
			title: "The.Matrix.1999.1080p.BluRay.x264-RELEASE",
			sizeleft: 3932160000,
			timeleft: "00:25:30",
			estimatedCompletionTime: "2024-01-15T12:00:00Z",
			added: "2024-01-15T11:00:00Z",
			status: "downloading",
			trackedDownloadStatus: "ok",
			trackedDownloadState: "downloading",
			statusMessages: [],
			errorMessage: null,
			downloadId: "SABnzbd_nzo_matrix123",
			protocol: "usenet",
			downloadClient: "SABnzbd",
			downloadClientHasPostImportCategory: false,
			indexer: "NZBgeek",
			outputPath:
				"/downloads/complete/The.Matrix.1999.1080p.BluRay.x264-RELEASE",
		},
		{
			id: 202,
			movieId: 102,
			movie: {
				id: 102,
				title: "Inception",
				year: 2010,
				hasFile: false,
			},
			languages: [{ id: 1, name: "English" }],
			quality: {
				quality: { id: 19, name: "Bluray-2160p" },
			},
			customFormats: [
				{
					id: 1,
					name: "2160p - Notifiarr",
				},
				{
					id: 2,
					name: "DD+ ATMOS - Notifiarr",
				},
				{
					id: 5,
					name: "x265 - Notifiarr",
				},
			],
			customFormatScore: 3105,
			size: 25769803776,
			title: "Inception.2010.2160p.UHD.BluRay.x265-RELEASE",
			sizeleft: 0,
			estimatedCompletionTime: "2024-01-15T10:45:00Z",
			added: "2024-01-15T09:00:00Z",
			status: "warning",
			trackedDownloadStatus: "warning",
			trackedDownloadState: "importPending",
			statusMessages: [
				{
					title: "Not a Custom Format upgrade for existing movie file(s).",
					messages: [
						"New: [2160p - Notifiarr, DD+ ATMOS - Notifiarr, x265 - Notifiarr] (3105) do not improve on Existing: [2160p - Notifiarr, DD+ ATMOS - Notifiarr, DV HDR10+, WEB Tier 01, x265 - Notifiarr] (6300)",
					],
				},
			],
			errorMessage: "Not a Custom Format upgrade for existing movie file(s).",
			downloadId: "SABnzbd_nzo_inception456",
			protocol: "usenet",
			downloadClient: "SABnzbd",
			outputPath:
				"/downloads/complete/Inception.2010.2160p.UHD.BluRay.x265-RELEASE",
		},
		{
			id: 203,
			movieId: 103,
			movie: {
				id: 103,
				title: "Interstellar",
				year: 2014,
				hasFile: false,
			},
			languages: [{ id: 1, name: "English" }],
			quality: {
				quality: { id: 7, name: "Bluray-1080p" },
			},
			customFormats: [],
			customFormatScore: 0,
			size: 12884901888,
			title: "Interstellar.2014.1080p.BluRay.x264-GROUP",
			sizeleft: 12884901888,
			timeleft: null,
			estimatedCompletionTime: null,
			added: "2024-01-15T08:00:00Z",
			status: "paused",
			trackedDownloadStatus: "warning",
			trackedDownloadState: "downloading",
			statusMessages: [
				{
					title: "Download paused",
					messages: ["The download was paused"],
				},
			],
			errorMessage: null,
			downloadId: "qBittorrent_interstellar789",
			protocol: "torrent",
			downloadClient: "qBittorrent",
			outputPath:
				"/downloads/incomplete/Interstellar.2014.1080p.BluRay.x264-GROUP",
		},
	],
};

export const radarrQueueStuckItems = {
	totalRecords: 2,
	records: [
		{
			id: 300,
			movieId: 201,
			title: "Sample.Movie.2023.2160p.WEB-DL.x265-RELEASE",
			status: "warning",
			trackedDownloadStatus: "warning",
			trackedDownloadState: "importPending",
			statusMessages: [
				{
					title: "Not a Custom Format upgrade for existing movie file(s).",
					messages: [
						"New: [2160p] (1500) do not improve on Existing: [2160p, DV HDR10+] (3000)",
					],
				},
			],
			errorMessage: "Not a Custom Format upgrade for existing movie file(s).",
			downloadId: "SABnzbd_nzo_downgrade123",
			protocol: "usenet",
			size: 15728640000,
			sizeleft: 0,
		},
		{
			id: 301,
			movieId: 202,
			title: "Network.Issue.Movie.2023.1080p.WEB.x264-STUCK",
			status: "warning",
			trackedDownloadStatus: "warning",
			trackedDownloadState: "downloading",
			statusMessages: [
				{
					title: "Connection timeout",
					messages: ["Network timeout when contacting download client"],
				},
			],
			errorMessage: "Network timeout occurred",
			downloadId: "SABnzbd_nzo_timeout456",
			protocol: "usenet",
			size: 8589934592,
			sizeleft: 2147483648,
		},
	],
};

export const radarrMovieLookup = [
	{
		title: "The Matrix",
		originalTitle: "The Matrix",
		alternateTitles: [],
		secondaryYearSourceId: 0,
		sortTitle: "matrix",
		sizeOnDisk: 0,
		status: "released",
		overview:
			"Set in the 22nd century, The Matrix tells the story of a computer hacker who joins a group of underground insurgents fighting the vast and powerful computers who now rule the earth.",
		inCinemas: "1999-03-24T00:00:00Z",
		physicalRelease: "1999-09-21T00:00:00Z",
		digitalRelease: "1999-06-01T00:00:00Z",
		images: [],
		website: "http://www.warnerbros.com/matrix",
		remotePoster:
			"https://image.tmdb.org/t/p/original/f89U3ADr1oiB1s9GkdPOEpXUk5H.jpg",
		year: 1999,
		youTubeTrailerId: "vKQi3bBA1y8",
		studio: "Warner Bros. Pictures",
		path: "",
		qualityProfileId: 0,
		monitored: false,
		minimumAvailability: "announced",
		isAvailable: true,
		folderName: "",
		runtime: 136,
		cleanTitle: "matrix",
		imdbId: "tt0133093",
		tmdbId: 603,
		titleSlug: "the-matrix-603",
		certification: "R",
		genres: ["Action", "Science Fiction"],
		tags: [],
		added: "0001-01-01T00:00:00Z",
		ratings: {
			imdb: { votes: 1500000, value: 8.7, type: "user" },
			tmdb: { votes: 20000, value: 8.2, type: "user" },
			metacritic: { votes: 0, value: 73, type: "user" },
			rottenTomatoes: { votes: 0, value: 88, type: "user" },
		},
		movieFile: null,
		collection: {
			name: "The Matrix Collection",
			tmdbId: 2344,
			images: [],
		},
	},
];

export const radarrQualityProfiles = [
	{
		id: 1,
		name: "Any",
		upgradeAllowed: true,
		cutoff: 20,
		items: [
			{
				id: 0,
				name: "Unknown",
				quality: { id: 0, name: "Unknown" },
				allowed: false,
			},
			{
				id: 1,
				name: "SDTV",
				quality: { id: 1, name: "SDTV" },
				allowed: true,
			},
		],
		minFormatScore: 0,
		cutoffFormatScore: 0,
		formatItems: [],
		language: { id: 1, name: "English" },
	},
	{
		id: 2,
		name: "HD-1080p",
		upgradeAllowed: true,
		cutoff: 7,
		items: [
			{
				id: 4,
				name: "HDTV-1080p",
				quality: { id: 4, name: "HDTV-1080p" },
				allowed: true,
			},
			{
				id: 7,
				name: "Bluray-1080p",
				quality: { id: 7, name: "Bluray-1080p" },
				allowed: true,
			},
			{
				id: 9,
				name: "WEBDL-1080p",
				quality: { id: 9, name: "WEBDL-1080p" },
				allowed: true,
			},
		],
		minFormatScore: 0,
		cutoffFormatScore: 0,
		formatItems: [],
		language: { id: 1, name: "English" },
	},
	{
		id: 3,
		name: "4K-2160p",
		upgradeAllowed: false,
		cutoff: 19,
		items: [
			{
				id: 16,
				name: "HDTV-2160p",
				quality: { id: 16, name: "HDTV-2160p" },
				allowed: true,
			},
			{
				id: 18,
				name: "WEBDL-2160p",
				quality: { id: 18, name: "WEBDL-2160p" },
				allowed: true,
			},
			{
				id: 19,
				name: "Bluray-2160p",
				quality: { id: 19, name: "Bluray-2160p" },
				allowed: true,
			},
		],
		minFormatScore: 0,
		cutoffFormatScore: 0,
		formatItems: [],
		language: { id: 1, name: "English" },
	},
];

export const radarrRootFolders = [
	{
		id: 1,
		path: "/media/movies",
		accessible: true,
		freeSpace: 2000000000000,
		unmappedFolders: [],
	},
	{
		id: 2,
		path: "/media/movies-4k",
		accessible: true,
		freeSpace: 1000000000000,
		unmappedFolders: [],
	},
];

export const radarrHistoryResponse = {
	page: 1,
	pageSize: 10,
	sortKey: "date",
	sortDirection: "descending",
	totalRecords: 15,
	records: [
		{
			id: 2001,
			movieId: 101,
			sourceTitle: "The.Matrix.1999.1080p.BluRay.x264-RELEASE",
			quality: {
				quality: { id: 7, name: "Bluray-1080p" },
			},
			qualityCutoffNotMet: false,
			date: "2024-01-15T11:00:00Z",
			downloadId: "SABnzbd_nzo_matrix123",
			eventType: "grabbed",
			data: {
				indexer: "NZBgeek",
				nzbInfoUrl: "https://nzbgeek.info/details/matrix123",
				releaseGroup: "RELEASE",
				age: "2",
				ageHours: "48",
				ageMinutes: "2880",
				publishedDate: "2024-01-13T11:00:00Z",
				downloadClient: "SABnzbd",
				size: "15728640000",
				downloadUrl: "https://api.nzbgeek.info/api?t=get&id=matrix123",
				guid: "https://nzbgeek.info/geekseek.php?guid=matrix123",
				protocol: "usenet",
				tmdbId: "603",
				imdbId: "tt0133093",
			},
		},
		{
			id: 2002,
			movieId: 101,
			sourceTitle: "The.Matrix.1999.1080p.BluRay.x264-RELEASE",
			quality: {
				quality: { id: 7, name: "Bluray-1080p" },
			},
			qualityCutoffNotMet: false,
			date: "2024-01-15T12:30:00Z",
			downloadId: "SABnzbd_nzo_matrix123",
			eventType: "downloadFolderImported",
			data: {
				droppedPath:
					"/downloads/complete/The.Matrix.1999.1080p.BluRay.x264-RELEASE",
				importedPath:
					"/media/movies/The Matrix (1999)/The Matrix (1999) - Bluray-1080p.mkv",
				downloadClient: "SABnzbd",
			},
		},
	],
};

export const radarrManualImportCandidates = [
	{
		id: 0,
		path: "/downloads/complete/Inception.2010.2160p.UHD.BluRay.x265.mkv",
		relativePath: "Inception.2010.2160p.UHD.BluRay.x265.mkv",
		folderName: "Inception.2010.2160p.UHD.BluRay.x265",
		name: "Inception.2010.2160p.UHD.BluRay.x265.mkv",
		size: 25769803776,
		movie: {
			id: 102,
			title: "Inception",
		},
		releaseGroup: "RELEASE",
		quality: {
			quality: { id: 19, name: "Bluray-2160p" },
		},
		languages: [{ id: 1, name: "English" }],
		qualityWeight: 19000,
		downloadId: "SABnzbd_nzo_inception456",
		customFormats: [
			{ id: 1, name: "2160p - Notifiarr" },
			{ id: 2, name: "DD+ ATMOS - Notifiarr" },
			{ id: 5, name: "x265 - Notifiarr" },
		],
		customFormatScore: 3105,
		indexerFlags: 0,
		rejections: [],
	},
];

export const radarrManualImportRejected = [
	{
		id: 0,
		path: "/downloads/complete/Unknown.Movie.2023.mkv",
		relativePath: "Unknown.Movie.2023.mkv",
		folderName: "Unknown.Movie.2023",
		name: "Unknown.Movie.2023.mkv",
		size: 8589934592,
		movie: null,
		quality: {
			quality: { id: 7, name: "Bluray-1080p" },
		},
		languages: [{ id: 1, name: "English" }],
		downloadId: "SABnzbd_nzo_unknown",
		rejections: [
			{
				reason: "Unknown Movie",
				type: "permanent",
			},
		],
	},
];
