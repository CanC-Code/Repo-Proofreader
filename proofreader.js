///// made by CanC-Code / CCVO
///// Purpose: Proofread HTML, JS, and CSS from GitHub repositories
///// Parser: Babel Standalone (browser-compatible, ES module safe)
///// Enhanced: Static import/export checking for JS modules

const output = document.getElementById("output");
const scanBtn = document.getElementById("scanBtn");
const repoInput = document.getElementById("repoInput");

// Map to store exported symbols per module path
const moduleExportsMap = {};
// Map to store fetched file content per path
const moduleContentMap = {};

/* ======================
   Input + Auto-load
   ====================== */
scanBtn.onclick = () => startScan(repoInput.value);

window.addEventListener("load", () => {
    const hash = decodeURIComponent(window.location.hash.slice(1));
    if (hash) {
        repoInput.value = hash;
        startScan(hash);
    }
});

/* ======================
   Core Logic
   ====================== */
function startScan(rawInput) {
    const repo = extractRepo(rawInput);
    if (!repo) {
        logError("Invalid repository input.");
        return;
    }

    output.textContent = "";
    proofreadRepo(repo);
}

function extractRepo(input) {
    if (!input) return null;

    const urlMatch = input.match(/github\.com\/([^\/]+\/[^\/]+)/i);
    if (urlMatch) return urlMatch[1];

    if (input.includes("/")) return input.trim();

    return null;
}

async function proofreadRepo(ownerRepo) {
    log(`Fetching repository: ${ownerRepo}`);

    try {
        const repoRes = await fetch(`https://api.github.com/repos/${ownerRepo}`);
        if (!repoRes.ok) throw new Error("Failed to fetch repository info.");

        const repoData = await repoRes.json();
        const branch = repoData.default_branch || "main";

        const treeRes = await fetch(
            `https://api.github.com/repos/${ownerRepo}/git/trees/${branch}?recursive=1`
        );
        if (!treeRes.ok) throw new Error("Failed to fetch repository tree.");

        const treeData = await treeRes.json();

        // First pass: fetch all file contents and store
        for (const item of treeData.tree) {
            if (item.type !== "blob") continue;
            const path = item.path;
            try {
                const res = await fetch(`https://raw.githubusercontent.com/${ownerRepo}/${branch}/${path}`);
                if (!res.ok) continue;
                moduleContentMap[path] = await res.text();
            } catch {}
        }

        // Second pass: parse files
        for (const path in moduleContentMap) {
            await proofreadFile(path);
        }

        log("Proofreading complete.");

    } catch (err) {
        logError(err.message);
    }
}

async function proofreadFile(path) {
    log(`Proofreading ${path}...`);
    const content = moduleContentMap[path];
    if (!content) return;

    if (path.endsWith(".js")) parseJS(content, path);
    else if (path.endsWith(".html")) parseHTML(content, path);
    else if (path.endsWith(".css")) parseCSS(content, path);
}

/* ======================
   JS Parser with Import/Export Check
   ====================== */
function parseJS(code, path) {
    try {
        const ast = Babel.transform(code, { ast: true, code: false, sourceType: "module" }).ast;

        // Collect exports
        const exportedSymbols = new Set();
        Babel.traverse(ast, {
            ExportNamedDeclaration({ node }) {
                if (node.declaration) {
                    if (node.declaration.id) exportedSymbols.add(node.declaration.id.name);
                    else if (node.declaration.declarations) {
                        node.declaration.declarations.forEach(d => exportedSymbols.add(d.id.name));
                    }
                }
                if (node.specifiers) node.specifiers.forEach(s => exportedSymbols.add(s.exported.name));
            },
            ExportDefaultDeclaration() { exportedSymbols.add("default"); }
        });
        moduleExportsMap[path] = exportedSymbols;

        // Check imports
        Babel.traverse(ast, {
            ImportDeclaration({ node }) {
                const sourceRaw = node.source.value;
                // Resolve relative path
                let sourcePath = sourceRaw;
                if (sourceRaw.startsWith(".")) {
                    const segments = path.split("/").slice(0, -1);
                    const relativeSegments = sourceRaw.split("/");
                    for (const seg of relativeSegments) {
                        if (seg === ".") continue;
                        else if (seg === "..") segments.pop();
                        else segments.push(seg);
                    }
                    sourcePath = segments.join("/");
                    if (!sourcePath.endsWith(".js")) sourcePath += ".js";
                }

                node.specifiers.forEach(s => {
                    const importedName = s.imported ? s.imported.name : "default";
                    if (moduleExportsMap[sourcePath] && !moduleExportsMap[sourcePath].has(importedName)) {
                        logError(`❌ ${path}: imports '${importedName}' from '${sourceRaw}' (${sourcePath}) which is not exported`);
                    }
                });
            }
        });

    } catch (err) {
        logError(`JS Syntax Error in ${path}:\n${err.message}`);
    }
}

/* ======================
   HTML Parser
   ====================== */
function parseHTML(html, path) {
    try {
        const doc = new DOMParser().parseFromString(html, "text/html");
        if (doc.querySelector("parsererror")) {
            logError(`HTML Parse Error in ${path}`);
        }
    } catch (err) {
        logError(`HTML Error in ${path}:\n${err.message}`);
    }
}

/* ======================
   CSS Parser
   ====================== */
function parseCSS(css, path) {
    try {
        const sheet = new CSSStyleSheet();
        sheet.replaceSync(css);
    } catch (err) {
        logError(`CSS Syntax Error in ${path}:\n${err.message}`);
    }
}

/* ======================
   Logging
   ====================== */
function log(msg) {
    const div = document.createElement("div");
    div.textContent = msg;
    output.appendChild(div);
}

function logError(msg) {
    const div = document.createElement("div");
    div.textContent = msg;
    div.style.color = "#ff6b6b";
    output.appendChild(div);
}