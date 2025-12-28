// proofreader.js
// Author: CCVO / CanC-Code
// Purpose: GitHub Repo Proofreader - Main orchestrator

import { parseHTML } from './parseHTML.js';
import { parseCSS } from './parseCSS.js';
import { parseJS } from './parseJS.js';
import { resolveImports } from './resolver.js';
import { log, logError, clearLog } from './reporter.js';

const scanBtn = document.getElementById("scanBtn");
const repoInput = document.getElementById("repoInput");

// Module maps
const moduleExportsMap = {};
const moduleContentMap = {};
const moduleImportsMap = {};

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

    clearLog();
    Object.keys(moduleContentMap).forEach(k => delete moduleContentMap[k]);
    Object.keys(moduleExportsMap).forEach(k => delete moduleExportsMap[k]);
    Object.keys(moduleImportsMap).forEach(k => delete moduleImportsMap[k]);

    await proofreadRepo(ownerRepo);
    isScanning = false;
}

async function proofreadRepo(ownerRepo) {
    log("Fetching repository: " + ownerRepo);
    
    try {
        const repoRes = await fetch("https://api.github.com/repos/" + ownerRepo);
        if (!repoRes.ok) throw new Error("Failed to fetch repository info.");
        const repoData = await repoRes.json();
        const branch = repoData.default_branch || "main";

        const treeRes = await fetch("https://api.github.com/repos/" + ownerRepo + "/git/trees/" + branch + "?recursive=1");
        if (!treeRes.ok) throw new Error("Failed to fetch repository tree.");
        const treeData = await treeRes.json();

        // Fetch all files
        log("Fetching files...");
        for (const item of treeData.tree) {
            if (item.type !== "blob") continue;
            const path = item.path;
            try {
                const res = await fetch("https://raw.githubusercontent.com/" + ownerRepo + "/" + branch + "/" + path);
                if (!res.ok) continue;
                moduleContentMap[path] = await res.text();
            } catch {}
        }

        // Parse all files
        log("Parsing files...");
        for (const path in moduleContentMap) {
            const content = moduleContentMap[path];
            
            if (path.endsWith(".js")) {
                parseJS(content, path, moduleExportsMap, moduleImportsMap);
            } else if (path.endsWith(".html")) {
                parseHTML(content, path);
            } else if (path.endsWith(".css")) {
                parseCSS(content, path);
            }
        }

        // Resolve imports
        log("\nResolving imports...");
        resolveImports(moduleExportsMap, moduleImportsMap);

        // Summary
        log("\n=== Proofreading Complete ===");
        log("Files processed: " + Object.keys(moduleContentMap).length);
        log("JS modules: " + Object.keys(moduleExportsMap).length);

    } catch (err) {
        logError("Error: " + err.message);
    }
}