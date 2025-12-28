// proofreader.js
// Author: CCVO / CanC-Code
// Purpose: GitHub Repo Proofreader with 3-tier JS parsing (Babel → Esprima → Acorn/Recast)

import * as acorn from '../libs/acorn.js';
import * as recast from '../libs/recast.min.js';
import * as esprima from '../libs/esprima.js';

const output = document.getElementById("output");
const scanBtn = document.getElementById("scanBtn");
const repoInput = document.getElementById("repoInput");

// Module maps
const moduleExportsMap = {};
const moduleContentMap = {};
const moduleImportIssues = {};
const fileParseMethod = {};

// Prevent circular hash updates
let isScanning = false;

// ----------------------
// Hash + Input Handling
// ----------------------
function checkHash() {
    const hash = decodeURIComponent(window.location.hash.slice(1));
    if (!hash || isScanning) return;
    
    const repo = hash.replace(/^https?:\/\/github\.com\//, "").replace(/\/$/, "");
    if (repoInput && repo) {
        repoInput.value = repo;
        startScan(repo);
    }
}

// Only check hash once after DOM is fully loaded
window.addEventListener("load", () => {
    checkHash();
});

// Handle manual hash changes (but not during scans)
window.addEventListener("hashchange", () => {
    if (!isScanning) {
        checkHash();
    }
});

scanBtn.onclick = () => {
    const input = repoInput.value.trim();
    if (input) {
        // Update hash without triggering hashchange during scan
        const repo = getRepoFromInput(input);
        if (repo) {
            isScanning = true;
            window.location.hash = repo;
            setTimeout(() => {
                startScan(input);
            }, 10);
        }
    }
};

// ----------------------
// URL parsing
// ----------------------
function getRepoFromInput(input) {
    if (!input) return null;
    input = input.replace(/^https?:\/\//, "").replace(/\/$/, "");
    const match = input.match(/github\.com\/([^\/]+\/[^\/]+)/i);
    if (match) return match[1];
    if (/^[\w.-]+\/[\w.-]+$/.test(input)) return input.trim();
    return null;
}

// ----------------------
// Core scanning
// ----------------------
async function startScan(rawInput) {
    const ownerRepo = getRepoFromInput(rawInput);
    if (!ownerRepo) {
        logError("Invalid repository input.");
        isScanning = false;
        return;
    }

    output.textContent = "";
    Object.keys(moduleContentMap).forEach(k => delete moduleContentMap[k]);
    Object.keys(moduleExportsMap).forEach(k => delete moduleExportsMap[k]);
    Object.keys(moduleImportIssues).forEach(k => delete moduleImportIssues[k]);
    Object.keys(fileParseMethod).forEach(k => delete fileParseMethod[k]);

    await proofreadRepo(ownerRepo);
    isScanning = false;
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

        // Proofread all files first
        for (const path in moduleContentMap) {
            await proofreadFile(path);
        }

        // Final summary
        log("\n=== Proofreading Summary ===");
        let issueCount = 0;
        for (const path in moduleImportIssues) {
            moduleImportIssues[path].forEach(issue => {
                logError(`❌ ${path}: ${issue}`);
                issueCount++;
            });
        }
        
        if (issueCount === 0) {
            log("✅ No import/export issues found!");
        } else {
            log(`\nTotal issues found: ${issueCount}`);
        }
        
        log("\nParsing methods used:");
        for (const path in fileParseMethod) {
            log(`  ${path}: ${fileParseMethod[path]}`);
        }
        
        log("\nProofreading complete.");

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

// ----------------------
// Helper: Resolve relative imports
// ----------------------
function resolveImportPath(importSource, currentPath) {
    if (!importSource.startsWith(".")) {
        return importSource; // External module
    }

    const currentDir = currentPath.split("/").slice(0, -1);
    const importParts = importSource.split("/");
    
    for (const part of importParts) {
        if (part === ".") continue;
        else if (part === "..") currentDir.pop();
        else currentDir.push(part);
    }
    
    let resolved = currentDir.join("/");
    
    // Add .js extension if missing
    if (!resolved.endsWith(".js") && !resolved.endsWith(".mjs")) {
        resolved += ".js";
    }
    
    return resolved;
}

// ----------------------
// JS Parsing: Babel → Esprima → Acorn/Recast
// ----------------------
async function parseJS(code, path) {
    // Try Babel first
    try {
        const ast = Babel.transform(code, { ast: true, code: false, sourceType: "module" }).ast;
        fileParseMethod[path] = "Babel";
        traverseAST(ast, path);
        return;
    } catch {
        // Babel failed, continue to Esprima
    }

    // Try Esprima
    try {
        const ast = esprima.parseModule(code, { tolerant: true });
        fileParseMethod[path] = "Esprima";
        traverseASTEsprima(ast, path);
        return;
    } catch {
        // Esprima failed, continue to Acorn/Recast
    }

    // Try Acorn/Recast
    try {
        const ast = recast.parse(code, { parser: acorn });
        fileParseMethod[path] = "Acorn/Recast";
        traverseASTRecast(ast, path);
        return;
    } catch (err) {
        logError(`❌ Cannot parse ${path} with any parser: ${err.message}`);
        fileParseMethod[path] = "Failed";
    }
}

// AST Traversal Helpers
function traverseAST(ast, path) {
    const exportedSymbols = new Set();
    
    // First pass: collect exports
    Babel.traverse(ast, {
        ExportNamedDeclaration({ node }) {
            if (node.declaration?.id) exportedSymbols.add(node.declaration.id.name);
            node.declaration?.declarations?.forEach(d => exportedSymbols.add(d.id.name));
            node.specifiers?.forEach(s => exportedSymbols.add(s.exported.name));
        },
        ExportDefaultDeclaration() { 
            exportedSymbols.add("default"); 
        }
    });
    
    moduleExportsMap[path] = exportedSymbols;

    // Second pass: check imports
    Babel.traverse(ast, {
        ImportDeclaration({ node }) {
            const sourcePath = resolveImportPath(node.source.value, path);
            
            node.specifiers.forEach(s => {
                const importedName = s.imported ? s.imported.name : "default";
                
                // Only check if source is a local file
                if (node.source.value.startsWith(".")) {
                    if (!moduleExportsMap[sourcePath] || !moduleExportsMap[sourcePath].has(importedName)) {
                        if (!moduleImportIssues[path]) moduleImportIssues[path] = [];
                        moduleImportIssues[path].push(`imports '${importedName}' from '${node.source.value}' (resolved: ${sourcePath}) which is not exported`);
                    }
                }
            });
        }
    });
}

function traverseASTEsprima(ast, path) {
    const exportedSymbols = new Set();
    const imports = [];
    
    // Collect exports and imports
    for (const node of ast.body) {
        if (node.type === "ExportNamedDeclaration") {
            if (node.declaration?.id) exportedSymbols.add(node.declaration.id.name);
            if (node.declaration?.declarations) {
                node.declaration.declarations.forEach(d => exportedSymbols.add(d.id.name));
            }
            node.specifiers?.forEach(s => exportedSymbols.add(s.exported.name));
        }
        if (node.type === "ExportDefaultDeclaration") {
            exportedSymbols.add("default");
        }
        if (node.type === "ImportDeclaration") {
            const names = node.specifiers.map(s => s.imported ? s.imported.name : "default");
            imports.push({ source: node.source.value, names });
        }
    }
    
    moduleExportsMap[path] = exportedSymbols;
    
    // Check imports
    imports.forEach(imp => {
        const sourcePath = resolveImportPath(imp.source, path);
        
        imp.names.forEach(name => {
            if (imp.source.startsWith(".")) {
                if (!moduleExportsMap[sourcePath] || !moduleExportsMap[sourcePath].has(name)) {
                    if (!moduleImportIssues[path]) moduleImportIssues[path] = [];
                    moduleImportIssues[path].push(`imports '${name}' from '${imp.source}' (resolved: ${sourcePath}) which is not exported`);
                }
            }
        });
    });
}

function traverseASTRecast(ast, path) {
    const exportedSymbols = new Set();
    const imports = [];
    
    recast.types.visit(ast, {
        visitExportNamedDeclaration(p) {
            if (p.node.declaration?.id) exportedSymbols.add(p.node.declaration.id.name);
            if (p.node.declaration?.declarations) {
                p.node.declaration.declarations.forEach(d => exportedSymbols.add(d.id.name));
            }
            p.node.specifiers?.forEach(s => exportedSymbols.add(s.exported.name));
            this.traverse(p);
        },
        visitExportDefaultDeclaration(p) {
            exportedSymbols.add("default");
            this.traverse(p);
        },
        visitImportDeclaration(p) {
            const source = p.node.source.value;
            const names = p.node.specifiers.map(s => s.imported ? s.imported.name : "default");
            imports.push({ source, names });
            this.traverse(p);
        }
    });
    
    moduleExportsMap[path] = exportedSymbols;
    
    // Check imports
    imports.forEach(imp => {
        const sourcePath = resolveImportPath(imp.source, path);
        
        imp.names.forEach(name => {
            if (imp.source.startsWith(".")) {
                if (!moduleExportsMap[sourcePath] || !moduleExportsMap[sourcePath].has(name)) {
                    if (!moduleImportIssues[path]) moduleImportIssues[path] = [];
                    moduleImportIssues[path].push(`imports '${name}' from '${imp.source}' (resolved: ${sourcePath}) which is not exported`);
                }
            }
        });
    });
}

// HTML + CSS Parsers
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

function parseCSS(css, path) {
    try { 
        new CSSStyleSheet().replaceSync(css); 
    } catch (err) { 
        logError(`CSS Syntax Error in ${path}:\n${err.message}`); 
    }
}

// Logging
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