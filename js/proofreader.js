///// proofreader.js
///// Author: CCVO / CanC-Code
///// Purpose: GitHub Repo Proofreader with 3-tier JS parsing (Babel → Esprima → Acorn/Recast)
///// Handles HTML, CSS, JS. Tracks exports/imports. Final summary.

import * as acorn from './libs/acorn.js';
import * as recast from './libs/recast.js';
import * as esprima from './libs/esprima.js';

const output = document.getElementById("output");
const scanBtn = document.getElementById("scanBtn");
const repoInput = document.getElementById("repoInput");

// Module maps
const moduleExportsMap = {};
const moduleContentMap = {};
const moduleImportIssues = {};
const fileParseMethod = {};

// ======================
// Hash + Input Handling
// ======================
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

// ======================
// URL parsing
// ======================
function getRepoFromInput(input) {
    if (!input) return null;
    input = input.replace(/^https?:\/\//, "").replace(/\/$/, "");
    const match = input.match(/github\.com\/([^\/]+\/[^\/]+)/i);
    if (match) return match[1];
    if (/^[\w.-]+\/[\w.-]+$/.test(input)) return input.trim();
    return null;
}

// ======================
// Core scanning
// ======================
async function startScan(rawInput) {
    const ownerRepo = getRepoFromInput(rawInput);
    if (!ownerRepo) {
        logError("Invalid repository input.");
        return;
    }

    output.textContent = "";
    Object.keys(moduleContentMap).forEach(k => delete moduleContentMap[k]);
    Object.keys(moduleExportsMap).forEach(k => delete moduleExportsMap[k]);
    Object.keys(moduleImportIssues).forEach(k => delete moduleImportIssues[k]);
    Object.keys(fileParseMethod).forEach(k => delete fileParseMethod[k]);

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

        // Final summary
        log("\n=== Proofreading Summary ===");
        for (const path in moduleImportIssues) {
            moduleImportIssues[path].forEach(issue => logError(`❌ ${path}: ${issue}`));
        }
        log("Proofreading complete.");

    } catch (err) {
        logError(err.message);
    }
}

async function proofreadFile(path) {
    const content = moduleContentMap[path];
    if (!content) return;

    log(`Proofreading ${path}...`);

    if (path.endsWith(".js")) await parseJS(content, path);
    else if (path.endsWith(".html")) parseHTML(content, path);
    else if (path.endsWith(".css")) parseCSS(content, path);
}

// ======================
// JS Parsing: Babel → Esprima → Acorn/Recast
// ======================
async function parseJS(code, path) {
    // Try Babel
    try {
        const ast = Babel.transform(code, { ast: true, code: false, sourceType: "module" }).ast;
        fileParseMethod[path] = "Babel";
        traverseAST(ast, path);
        return;
    } catch {
        log(`AST traverse failed for ${path}, some imports/exports may be missing.`);
    }

    // Try Esprima
    try {
        const ast = esprima.parseModule(code, { tolerant: true });
        fileParseMethod[path] = "Esprima";
        traverseASTEsprima(ast, path);
        return;
    } catch {
        log(`Esprima parse failed for ${path}, attempting Acorn/Recast fallback.`);
    }

    // Try Acorn/Recast
    try {
        const ast = recast.parse(code, { parser: acorn });
        fileParseMethod[path] = "Acorn/Recast";
        traverseASTRecast(ast, path);
    } catch {
        logError(`Cannot parse ${path}, skipped.`);
    }
}

// ======================
// AST Traversal Helpers
// ======================
function traverseAST(ast, path) {
    try {
        const exportedSymbols = new Set();
        Babel.traverse(ast, {
            ExportNamedDeclaration({ node }) {
                if (node.declaration?.id) exportedSymbols.add(node.declaration.id.name);
                if (node.declaration?.declarations)
                    node.declaration.declarations.forEach(d => exportedSymbols.add(d.id.name));
                node.specifiers?.forEach(s => exportedSymbols.add(s.exported.name));
            },
            ExportDefaultDeclaration() { exportedSymbols.add("default"); }
        });
        moduleExportsMap[path] = exportedSymbols;

        Babel.traverse(ast, {
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
                    if (moduleExportsMap[sourcePath] && !moduleExportsMap[sourcePath].has(importedName)) return;
                    if (!moduleImportIssues[path]) moduleImportIssues[path] = [];
                    moduleImportIssues[path].push(`imports '${importedName}' from '${node.source.value}' (${sourcePath}) which is not exported`);
                });
            }
        });
    } catch {
        log(`AST traverse failed for ${path}, some imports/exports may be missing.`);
    }
}

// Esprima traversal
function traverseASTEsprima(ast, path) {
    try {
        const exportedSymbols = new Set();
        const imports = [];
        for (const node of ast.body) {
            if (node.type === "ExportNamedDeclaration") {
                if (node.declaration?.id) exportedSymbols.add(node.declaration.id.name);
                node.specifiers?.forEach(s => exportedSymbols.add(s.exported.name));
            }
            if (node.type === "ExportDefaultDeclaration") exportedSymbols.add("default");
            if (node.type === "ImportDeclaration") {
                imports.push({ source: node.source.value, names: node.specifiers.map(s => s.imported ? s.imported.name : "default") });
            }
        }
        moduleExportsMap[path] = exportedSymbols;
        // check imports
        imports.forEach(i => {
            i.names.forEach(n => {
                let sourcePath = i.source;
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
                if (!moduleExportsMap[sourcePath] || !moduleExportsMap[sourcePath].has(n)) {
                    if (!moduleImportIssues[path]) moduleImportIssues[path] = [];
                    moduleImportIssues[path].push(`imports '${n}' from '${i.source}' (${sourcePath}) which is not exported`);
                }
            });
        });
    } catch {
        log(`Esprima traverse failed for ${path}.`);
    }
}

// Acorn/Recast traversal
function traverseASTRecast(ast, path) {
    try {
        const exportedSymbols = new Set();
        recast.types.visit(ast, {
            visitExportNamedDeclaration(p) {
                if (p.node.declaration?.id) exportedSymbols.add(p.node.declaration.id.name);
                p.node.specifiers?.forEach(s => exportedSymbols.add(s.exported.name));
                this.traverse(p);
            },
            visitExportDefaultDeclaration(p) {
                exportedSymbols.add("default");
                this.traverse(p);
            },
            visitImportDeclaration(p) {
                const source = p.node.source.value;
                p.node.specifiers.forEach(s => {
                    const importedName = s.imported ? s.imported.name : "default";
                    if (!moduleExportsMap[source] || !moduleExportsMap[source].has(importedName)) {
                        if (!moduleImportIssues[path]) moduleImportIssues[path] = [];
                        moduleImportIssues[path].push(`imports '${importedName}' from '${source}' which is not exported`);
                    }
                });
                this.traverse(p);
            }
        });
        moduleExportsMap[path] = exportedSymbols;
    } catch {
        log(`Acorn/Recast traverse failed for ${path}.`);
    }
}

// ======================
// HTML + CSS Parsers
// ======================
function parseHTML(html, path) {
    try {
        const doc = new DOMParser().parseFromString(html, "text/html");
        if (doc.querySelector("parsererror")) logError(`HTML Parse Error in ${path}`);
    } catch (err) { logError(`HTML Error in ${path}:\n${err.message}`); }
}

function parseCSS(css, path) {
    try { new CSSStyleSheet().replaceSync(css); } 
    catch (err) { logError(`CSS Syntax Error in ${path}:\n${err.message}`); }
}

// ======================
// Logging
// ======================
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