const output = document.getElementById("output");
const scanBtn = document.getElementById("scanBtn");
const repoInput = document.getElementById("repoInput");

// Maps to track exports/imports
const moduleExportsMap = {};
const moduleImportsMap = {};
const moduleContentMap = {};

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
    if (!ownerRepo) {
        logError("Invalid repository input.");
        return;
    }
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

        // Fetch all files
        for (const item of treeData.tree) {
            if (item.type !== "blob") continue;
            const path = item.path;
            try {
                const res = await fetch(`https://raw.githubusercontent.com/${ownerRepo}/${branch}/${path}`);
                if (!res.ok) continue;
                moduleContentMap[path] = await res.text();
            } catch {}
        }

        // Proofread
        for (const path in moduleContentMap) {
            await proofreadFile(path);
        }

        // Cross-check imports
        for (const file in moduleImportsMap) {
            for (const imp of moduleImportsMap[file]) {
                const targetExports = moduleExportsMap[imp.source];
                if (!targetExports || !imp.names.every(n => targetExports.has(n))) {
                    logError(`❌ ${file}: imports '${imp.names.join(", ")}' from '${imp.source}' which is not exported`);
                }
            }
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
   JS Parser: Babel primary, Esprima fallback
   ====================== */
function parseJS(code, path) {
    let ast;
    try {
        ast = Babel.transform(code, { ast: true, code: false, sourceType: "module" }).ast;
        processAST(ast, path);
    } catch (err) {
        log(`Babel parse failed for ${path}, falling back to Esprima.`);
        try {
            ast = esprima.parseModule(code, { tolerant: true });
            processASTEsprima(ast, path);
        } catch (e) {
            logError(`Cannot parse ${path}, skipped: ${e.message}`);
        }
    }
}

function processAST(ast, path) {
    const exportedSymbols = new Set();
    const importedItems = [];

    try {
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
                const names = node.specifiers.map(s => s.imported ? s.imported.name : "default");
                importedItems.push({ source: sourcePath, names });
            }
        });
    } catch (err) {
        log(`AST traverse failed for ${path}, some imports/exports may be missing.`);
    }

    moduleExportsMap[path] = exportedSymbols;
    moduleImportsMap[path] = importedItems;
}

function processASTEsprima(ast, path) {
    const exportedSymbols = new Set();
    const importedItems = [];

    for (const node of ast.body) {
        if (node.type === "ExportNamedDeclaration") {
            if (node.declaration?.id) exportedSymbols.add(node.declaration.id.name);
            if (node.specifiers) node.specifiers.forEach(s => exportedSymbols.add(s.exported.name));
        }
        if (node.type === "ExportDefaultDeclaration") exportedSymbols.add("default");
        if (node.type === "ImportDeclaration") {
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
            const names = node.specifiers.map(s => s.imported ? s.imported.name : "default");
            importedItems.push({ source: sourcePath, names });
        }
    }

    moduleExportsMap[path] = exportedSymbols;
    moduleImportsMap[path] = importedItems;
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