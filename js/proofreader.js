///// proofreader.js
///// Author: CCVO / CanC-Code
///// Purpose: Proofread HTML, JS, CSS from GitHub repositories
///// Enhanced: Uses browser-safe parseJS.js + dynamic hash handling

import { parseJS } from "./js/parseJS.js";

/* -------------------------------
   DOM Elements
--------------------------------- */
const output = document.getElementById("output");
const scanBtn = document.getElementById("scanBtn");
const repoInput = document.getElementById("repoInput");

/* -------------------------------
   Module tracking
--------------------------------- */
const moduleExportsMap = {};
const moduleImportsMap = {};
const moduleContentMap = {};

/* ======================
   Input + Hash Handling
====================== */
scanBtn.onclick = () => startScan(repoInput.value.trim());

window.addEventListener("load", () => {
    const hash = decodeURIComponent(window.location.hash.slice(1));
    if (hash) {
        repoInput.value = hash;
        startScan(hash);
    }
});

window.addEventListener("hashchange", () => {
    const hash = decodeURIComponent(window.location.hash.slice(1));
    if (hash) {
        repoInput.value = hash;
        startScan(hash);
    }
});

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
   Core scanning logic
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

        const treeRes = await fetch(
            `https://api.github.com/repos/${ownerRepo}/git/trees/${branch}?recursive=1`
        );
        if (!treeRes.ok) throw new Error("Failed to fetch repository tree.");
        const treeData = await treeRes.json();

        // First pass: fetch all file contents
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

    if (path.endsWith(".js")) parseJS(content, path, moduleExportsMap, moduleImportsMap);
    else if (path.endsWith(".html")) parseHTML(content, path);
    else if (path.endsWith(".css")) parseCSS(content, path);
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

export function logError(msg) {
    const div = document.createElement("div");
    div.textContent = msg;
    div.style.color = "#ff6b6b";
    output.appendChild(div);
}