import { parseJS } from "./js/parseJS.js";
import { parseHTML } from "./js/parseHTML.js";
import { parseCSS } from "./js/parseCSS.js";
import { resolveImports } from "./js/resolver.js";
import { log, logError, clearLog } from "./js/reporter.js";

const repoInput = document.getElementById("repoInput");
const scanBtn = document.getElementById("scanBtn");

const fileContents = {};
const moduleExports = {};
const moduleImports = {};

scanBtn.onclick = () => startScan(repoInput.value);

async function startScan(input) {
  clearLog();

  const repo = extractRepo(input);
  if (!repo) {
    logError("Invalid repository input.");
    return;
  }

  log(`Fetching repository: ${repo}`);

  try {
    const repoRes = await fetch(`https://api.github.com/repos/${repo}`);
    const repoData = await repoRes.json();
    const branch = repoData.default_branch || "main";

    const treeRes = await fetch(
      `https://api.github.com/repos/${repo}/git/trees/${branch}?recursive=1`
    );
    const treeData = await treeRes.json();

    // Phase 1: fetch all files
    for (const item of treeData.tree) {
      if (item.type !== "blob") continue;
      const raw = await fetch(
        `https://raw.githubusercontent.com/${repo}/${branch}/${item.path}`
      );
      if (raw.ok) fileContents[item.path] = await raw.text();
    }

    // Phase 2: parse
    for (const path in fileContents) {
      const content = fileContents[path];

      if (path.endsWith(".js")) {
        parseJS(content, path, moduleExports, moduleImports);
      } else if (path.endsWith(".html")) {
        parseHTML(content, path);
      } else if (path.endsWith(".css")) {
        parseCSS(content, path);
      }
    }

    // Phase 3: resolve imports
    resolveImports(moduleExports, moduleImports);

    log("✔ Proofreading complete.");

  } catch (err) {
    logError(err.message);
  }
}

function extractRepo(input) {
  if (!input) return null;
  const m = input.match(/github\.com\/([^\/]+\/[^\/]+)/i);
  if (m) return m[1];
  if (input.includes("/")) return input.trim();
  return null;
}