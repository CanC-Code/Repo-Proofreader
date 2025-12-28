///// proofreader.js
///// Author: CCVO / CanC-Code
///// Purpose: GitHub Repo Proofreader with multi-layer AST parsing

const output = document.getElementById("output");
const scanBtn = document.getElementById("scanBtn");
const repoInput = document.getElementById("repoInput");

// Maps to track modules
const moduleExportsMap = {};
const moduleContentMap = {};
const moduleImportsMap = {}; // track imports for verification

/* ======================
   Hash + Input Handling
   ====================== */
function checkHash() {
    const hash = decodeURIComponent(window.location.hash.slice(1));
    if (!hash) return;
    const repo = hash.replace(/^https?:\/\//, "").replace(/\/$/, "");
    repoInput.value = repo;
    startScan(repo);
}

window.addEventListener("load", checkHash);
window.addEventListener("hashchange", checkHash);
scanBtn.onclick = () => startScan(repoInput.value.trim());

/* ======================
   URL parsing
   ====================== */
function getRepoFromInput(input) {
    if (!input) return null;
    input = input.replace(/^https?:\/\//, "").replace(/\/$/, "");
    const match = input.match(/github\.com\/([^\/]+\/[^\/]+)/i);
    if (match) return match[1];
    if (/^[\w.-]+\/[\w.-]+$/.test(input)) return input.trim();
    return null;
}

/* ======================
   Core scanning
   ====================== */
async function startScan(rawInput) {
    const ownerRepo = getRepoFromInput(rawInput);
    if (!ownerRepo) return logError("Invalid repository input.");
    output.textContent = "";
    await proofreadRepo(ownerRepo);
}

async function proofreadRepo(ownerRepo) {
    log(`Fetching repository: ${ownerRepo}`);
    try {
        const repoRes = await fetch(`https://api.github.com/repos/${ownerRepo}`);
        if (!repoRes.ok) throw new Error("Failed to fetch repository info.");
        const repoData = await repoRes.json();
        const branch = repoData.default_branch || "main";

        const treeRes = await fetch(`https://api.github.com/repos/${ownerRepo}/git/trees/${branch}?recursive=1`);
        if (!treeRes.ok) throw new Error("Failed to fetch repository tree.");
        const treeData = await treeRes.json();

        for (const item of treeData.tree) {
            if (item.type !== "blob") continue;
            const path = item.path;
            try {
                const res = await fetch(`https://raw.githubusercontent.com/${ownerRepo}/${branch}/${path}`);
                if (!res.ok) continue;
                moduleContentMap[path] = await res.text();
            } catch {}
        }

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

    if (path.endsWith(".js")) await parseJSMulti(content, path);
    else if (path.endsWith(".html")) parseHTML(content, path);
    else if (path.endsWith(".css")) parseCSS(content, path);
}

/* ======================
   JS Multi-layer Parser
   ====================== */
async function parseJSMulti(code, path) {
    // Try Babel first
    try {
        const ast = Babel.transform(code, { ast: true, code: false, sourceType: "module" }).ast;
        traverseAST(ast, path);
        return;
    } catch (err) {
        log(`AST traverse failed for ${path}, some imports/exports may be missing.`);
    }

    // Fallback to Esprima
    try {
        const ast = esprima.parseModule(code, { tolerant: true, jsx: true });
        traverseASTEsprima(ast, path);
        return;
    } catch (err) {
        log(`Esprima parse failed for ${path}, attempting Acorn/Recast fallback.`);
    }

    // Tertiary fallback to Acorn/Recast
    try {
        const ast = acorn.parse(code, { ecmaVersion: "latest", sourceType: "module" });
        traverseASTAcorn(ast, path);
    } catch (err) {
        logError(`Cannot parse ${path}, skipped: ${err.message}`);
    }
}

/* ======================
   AST Traversal Helpers
   ====================== */
function traverseAST(ast, path) {
    const exportedSymbols = new Set();
    const imports = [];

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
        ExportDefaultDeclaration() { exportedSymbols.add("default"); },
        ImportDeclaration({ node }) {
            let sourcePath = node.source.value;
            if (sourcePath.startsWith(".")) {
                const segments = path.split("/").slice(0, -1);
                const relative = sourcePath.split("/");
                for (const seg of relative) {
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
                    logError(`❌ ${path}: imports '${importedName}' from '${node.source.value}' (${sourcePath}) which is not exported`);
                }
            });
        }
    });

    moduleExportsMap[path] = exportedSymbols;
    moduleImportsMap[path] = imports;
}

function traverseASTEsprima(ast, path) {
    const exportedSymbols = new Set();
    const imports = [];

    for (const node of ast.body) {
        if (node.type === "ExportNamedDeclaration") {
            if (node.declaration?.id) exportedSymbols.add(node.declaration.id.name);
            if (node.specifiers) node.specifiers.forEach(s => exportedSymbols.add(s.exported.name));
        }
        if (node.type === "ExportDefaultDeclaration") exportedSymbols.add("default");
        if (node.type === "ImportDeclaration") {
            imports.push({
                source: node.source.value,
                names: node.specifiers.map(s => s.imported ? s.imported.name : "default")
            });
        }
    }

    moduleExportsMap[path] = exportedSymbols;
    moduleImportsMap[path] = imports;
}

function traverseASTAcorn(ast, path) {
    const exportedSymbols = new Set();
    const imports = [];

    for (const node of ast.body) {
        if (node.type === "ExportNamedDeclaration") {
            if (node.declaration?.id) exportedSymbols.add(node.declaration.id.name);
            if (node.specifiers) node.specifiers.forEach(s => exportedSymbols.add(s.exported.name));
        }
        if (node.type === "ExportDefaultDeclaration") exportedSymbols.add("default");
        if (node.type === "ImportDeclaration") {
            imports.push({
                source: node.source.value,
                names: node.specifiers.map(s => s.imported ? s.imported.name : "default")
            });
        }
    }

    moduleExportsMap[path] = exportedSymbols;
    moduleImportsMap[path] = imports;
}

/* ======================
   HTML Parser
   ====================== */
function parseHTML(html, path) {
    try {
        const doc = new DOMParser().parseFromString(html, "text/html");
        if (doc.querySelector("parsererror")) logError(`HTML Parse Error in ${path}`);
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