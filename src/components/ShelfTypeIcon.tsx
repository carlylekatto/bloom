import {
	AppWindow,
	Disc,
	File,
	FileArchive,
	FileCode,
	FileImage,
	FileMusic,
	FileSpreadsheet,
	FileText,
	FileType,
	FileVideoCamera,
	Folder,
	Presentation
} from "lucide-react";

// File extensions grouped by the icon a shelf tile shows while it has no
// preview (or for files Windows can't preview at all).
const GROUPS: [typeof File, string[]][] = [
	[
		FileImage,
		[
			"png",
			"jpg",
			"jpeg",
			"gif",
			"webp",
			"bmp",
			"ico",
			"tif",
			"tiff",
			"heic",
			"heif",
			"avif",
			"svg",
			"raw",
			"psd"
		]
	],
	[
		FileVideoCamera,
		["mp4", "mkv", "mov", "avi", "webm", "wmv", "flv", "m4v", "mpg", "mpeg", "3gp"]
	],
	[
		FileMusic,
		["mp3", "wav", "flac", "aac", "ogg", "oga", "m4a", "wma", "opus", "aiff", "mid", "midi"]
	],
	[FileSpreadsheet, ["xls", "xlsx", "xlsm", "csv", "tsv", "ods", "numbers"]],
	[Presentation, ["ppt", "pptx", "odp", "key"]],
	[FileText, ["pdf", "txt", "md", "rtf", "doc", "docx", "odt", "pages", "epub", "log"]],
	[FileArchive, ["zip", "rar", "7z", "tar", "gz", "tgz", "bz2", "xz", "zst", "cab"]],
	[
		FileCode,
		[
			"js",
			"jsx",
			"ts",
			"tsx",
			"mjs",
			"cjs",
			"py",
			"rs",
			"c",
			"h",
			"cpp",
			"hpp",
			"cs",
			"java",
			"kt",
			"go",
			"rb",
			"php",
			"swift",
			"html",
			"htm",
			"css",
			"scss",
			"json",
			"xml",
			"yml",
			"yaml",
			"toml",
			"ini",
			"sh",
			"ps1",
			"bat",
			"cmd",
			"sql",
			"lua"
		]
	],
	[AppWindow, ["exe", "msi", "msix", "appx", "appinstaller", "lnk", "url"]],
	[Disc, ["iso", "img", "vhd", "vhdx"]],
	[FileType, ["ttf", "otf", "woff", "woff2", "fon"]]
];

const BY_EXTENSION = new Map(
	GROUPS.flatMap(([icon, exts]) => exts.map((ext) => [ext, icon] as const))
);

/** Icon for a shelf item's type, by folder or file extension. */
export function ShelfTypeIcon({
	name,
	folder,
	size = 26,
	className
}: {
	name: string;
	folder: boolean;
	size?: number;
	className?: string;
}) {
	const Icon = folder
		? Folder
		: (BY_EXTENSION.get(name.slice(name.lastIndexOf(".") + 1).toLowerCase()) ?? File);
	return <Icon size={size} strokeWidth={size < 16 ? 2 : 1.75} className={className} />;
}
