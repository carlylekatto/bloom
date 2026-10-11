import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const version = process.argv[2];
// Prerelease suffixes are accepted alongside plain major.minor.patch. A fork
// shares its version line with upstream, so a bare 3.9.3 here would collide with
// whatever they cut next; a prerelease sorts below it but above what is already
// out. Note that the MSI target only accepts a numeric-only suffix, since WiX
// has no room for text there.
if (!/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(version ?? "")) {
	console.error("Usage: bun run bump <major.minor.patch[-prerelease]>");
	process.exit(1);
}

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function updateJson(relativePath) {
	const path = resolve(root, relativePath);
	const raw = readFileSync(path, "utf8");
	const json = JSON.parse(raw);
	json.version = version;
	// Keep whatever indentation the file already uses. JSON.stringify has no
	// "match the current style" mode, so passing 2 unconditionally rewrote all
	// of package.json on every bump — a one-line version change buried in a
	// 42-line whole-file diff, every single time.
	const indent = /^\t/m.test(raw) ? "\t" : 2;
	writeFileSync(path, JSON.stringify(json, null, indent) + "\n");
}

function updateCargoToml() {
	const path = resolve(root, "src-tauri/Cargo.toml");
	const content = readFileSync(path, "utf8");
	writeFileSync(path, content.replace(/^version = "[^"]*"/m, `version = "${version}"`));
}

function updateCargoLock() {
	const path = resolve(root, "src-tauri/Cargo.lock");
	const content = readFileSync(path, "utf8");
	writeFileSync(
		path,
		content.replace(
			/(\[\[package\]\]\r?\nname = "bloom"\r?\nversion = ")[^"]*(")/,
			`$1${version}$2`
		)
	);
}

updateJson("package.json");
updateJson("src-tauri/tauri.conf.json");
updateCargoToml();
updateCargoLock();

console.log(`Bumped package.json, tauri.conf.json, Cargo.toml and Cargo.lock to ${version}`);