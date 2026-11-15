import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";
import { flatten, isObject, validateCatalog, type Catalog } from "../src/i18n/catalog";
import { LOCALES } from "../src/i18n/runtime";

const root = join(import.meta.dir, "..");
const directory = join(root, "src", "i18n", "locales");
const en = JSON.parse(readFileSync(join(directory, "en.json"), "utf8")) as Catalog;
const reference = flatten(en);
const errors = validateCatalog(en, en, "en").map((issue) => `en: ${issue}`);
const registered = new Set(LOCALES.map((locale) => locale.code as string));

for (const name of readdirSync(directory)
	.filter((name) => name.endsWith(".json"))
	.sort()) {
	const locale = name.slice(0, -5);
	if (!registered.has(locale))
		errors.push(`${locale}: register this language in src/i18n/runtime.ts`);
	try {
		const catalog: unknown = JSON.parse(readFileSync(join(directory, name), "utf8"));
		errors.push(...validateCatalog(en, catalog, locale).map((issue) => `${locale}: ${issue}`));
		const translated = flatten(catalog);
		const missing = [...reference.keys()].filter((key) => !translated.has(key));
		console.log(
			`${locale}: ${reference.size - missing.length}/${reference.size} English messages covered; ${missing.length} use English fallback`
		);
		if (process.argv.includes("--missing") && locale !== "en")
			for (const key of missing) console.log(`  ${key}`);
	} catch (error) {
		errors.push(`${locale}: ${String(error)}`);
	}
}

function walk(dir: string): string[] {
	return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
		entry.isDirectory() ? walk(join(dir, entry.name)) : [join(dir, entry.name)]
	);
}
let calls = 0;
function literalKeys(expression: ts.Expression): string[] {
	if (ts.isStringLiteralLike(expression)) return [expression.text];
	if (ts.isConditionalExpression(expression))
		return [...literalKeys(expression.whenTrue), ...literalKeys(expression.whenFalse)];
	if (ts.isParenthesizedExpression(expression)) return literalKeys(expression.expression);
	return [];
}
for (const file of walk(join(root, "src")).filter((file) => /\.(ts|tsx)$/.test(file))) {
	const source = ts.createSourceFile(
		file,
		readFileSync(file, "utf8"),
		ts.ScriptTarget.Latest,
		true
	);
	function visit(node: ts.Node) {
		if (
			ts.isCallExpression(node) &&
			ts.isIdentifier(node.expression) &&
			["t", "tCount"].includes(node.expression.text)
		) {
			const key = node.arguments[0];
			for (const literal of key ? literalKeys(key) : []) {
				calls++;
				const plural =
					node.expression.text === "tCount" &&
					reference.has(literal + "_one") &&
					reference.has(literal + "_other");
				if (!reference.has(literal) && !plural) {
					const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
					errors.push(`${relative(root, file)}:${line}: missing English key ${literal}`);
				}
			}
		}
		if (
			ts.isPropertyAssignment(node) &&
			node.name.getText(source) === "labelKey" &&
			ts.isStringLiteralLike(node.initializer) &&
			!reference.has(node.initializer.text)
		) {
			errors.push(`${relative(root, file)}: missing English labelKey ${node.initializer.text}`);
		}
		ts.forEachChild(node, visit);
	}
	visit(source);
}

if (!isObject(en) || reference.size === 0)
	errors.push("English source catalog must contain messages");
if (errors.length) {
	console.error(`\nTranslation check failed:\n${errors.map((error) => `- ${error}`).join("\n")}`);
	process.exit(1);
}
console.log(
	`Translation check passed: ${reference.size} English messages, ${calls} literal translation calls. Partial languages are allowed.`
);
