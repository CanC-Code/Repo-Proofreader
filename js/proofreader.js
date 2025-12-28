const output = document.getElementById("output");
const scanBtn = document.getElementById("scanBtn");
const repoInput = document.getElementById("repoInput");

const moduleExportsMap = {};
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

    if (path.endsWith(".js")) parseJS(content, path);
    else if (path.endsWith(".html")) parseHTML(content, path);
    else if (path.endsWith(".css")) parseCSS(content, path);
}

/* ======================
   JS Parser - Manual AST Walk
   ====================== */
function parseJS(code, path) {
    let ast;
    try {
        ast = Babel.transform(code, { ast: true, code: false, sourceType: "module" }).ast;
    } catch (err) {
        logWarning(`Cannot parse ${path} (skipped): ${err.message}`);
        return;
    }

    const exportsSet = new Set();
    const importsArr = [];

    for (const node of ast.program.body) {
        // Export handling
        if (node.type === "ExportNamedDeclaration") {
            if (node.declaration?.id) exportsSet.add(node.declaration.id.name);
            if (node.declaration?.declarations) {
                node.declaration.declarations.forEach(d => exportsSet.add(d.id.name));
            }
            if (node.specifiers) node.specifiers.forEach(s => exportsSet.add(s.exported.name));
        }
        if (node.type === "ExportDefaultDeclaration") exportsSet.add("default");

        // Import handling
        if (node.type === "ImportDeclaration") {
            const sourcePath = node.source.value;
            node.specifiers.forEach(s => {
                const importedName = s.imported ? s.imported.name : "default";
                importsArr.push({ source: sourcePath, name: importedName });
            });
        }
    }

    moduleExportsMap[path] = exportsSet;

    // Check imports
    for (const imp of importsArr) {
        if (imp.source.startsWith(".")) {
            const segments = path.split("/").slice(0, -1);
            const relative = imp.source.split("/");
            for (const seg of relative) {
                if (seg === ".") continue;
                else if (seg === "..") segments.pop();
                else segments.push(seg);
            }
            let resolved = segments.join("/");
            if (!resolved.endsWith(".js")) resolved += ".js";

            if (moduleExportsMap[resolved] && !moduleExportsMap[resolved].has(imp.name)) {
                logError(`❌ ${path}: imports '${imp.name}' from '${imp.source}' (${resolved}) which is not exported`);
            }
        }
    }
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

function logWarning(msg) {
    const div = document.createElement("div");
    div.textContent = msg;
    div.style.color = "#ffa500";
    output.appendChild(div);
}