import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");

const casesIndexPath = path.join(projectRoot, "data", "cases.json");
const ontologyPath = path.join(projectRoot, "ontology", "ontology_20.dot");
const outputPath = path.join(projectRoot, "embedded-data.js");

function toAppRelativeKey(absolutePath) {
  return `./${path.relative(projectRoot, absolutePath).replace(/\\/g, "/")}`;
}

async function loadCaseAssetPaths() {
  const casesJsonText = await fs.readFile(casesIndexPath, "utf8");
  const cases = JSON.parse(casesJsonText);
  const caseIndexDir = path.dirname(casesIndexPath);
  const assetPaths = new Set([casesIndexPath, ontologyPath]);

  for (const caseOption of cases) {
    const original = caseOption.languages?.original || {};
    const translation = caseOption.languages?.translation || {};
    const candidatePaths = [
      original.corpus,
      original.entities,
      translation.corpus || original.corpus,
      translation.entities || original.entities,
    ].filter(Boolean);

    for (const relativeAssetPath of candidatePaths) {
      assetPaths.add(path.resolve(caseIndexDir, relativeAssetPath));
    }
  }

  return [...assetPaths];
}

async function buildEmbeddedData() {
  const assetPaths = await loadCaseAssetPaths();
  const embeddedText = {};

  for (const assetPath of assetPaths) {
    embeddedText[toAppRelativeKey(assetPath)] = await fs.readFile(assetPath, "utf8");
  }

  const bundleSource = [
    "window.__KASEONTO_EMBEDDED_TEXT__ = Object.freeze(",
    `${JSON.stringify(embeddedText, null, 2)}`,
    ");",
    "",
  ].join("\n");

  await fs.writeFile(outputPath, bundleSource, "utf8");
  console.log(`Wrote ${path.basename(outputPath)} with ${assetPaths.length} embedded assets.`);
}

await buildEmbeddedData();
