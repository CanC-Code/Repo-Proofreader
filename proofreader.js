///// made by CanC-Code / CCVO
///// Purpose: Proofread HTML, JS, and CSS from GitHub repositories
///// Parser: Babel Standalone (browser-compatible)

const output = document.getElementById("output");
const scanBtn = document.getElementById("scanBtn");
const repoInput = document.getElementById("repoInput");

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

        for (const item of treeData.tree) {
            if (item.type !== "blob") continue;
            await proofreadFile(ownerRepo, branch, item.path);
        }

        log("Proofreading complete.");

    } catch (err) {
        logError(err.message);
    }
}

async function proofreadFile(ownerRepo, branch, path) {
    log(`Proofreading ${path}...`);

    try {
        const res = await fetch(
            `https://raw.githubusercontent.com/${ownerRepo}/${branch}/${path}`
        );
        if (!res.ok) return;

        const content = await res.text();

        if (path.endsWith(".js")) parseJS(content, path);
        else if (path.endsWith(".html")) parseHTML(content, path);
        else if (path.endsWith(".css")) parseCSS(content, path);

    } catch (err) {
        logError(`${path}: ${err.message}`);
    }
}

/* ======================
   Parsers
   ====================== */

function parseJS(code, path) {
    try {
        Babel.transform(code, {
            ast: true,
            code: false,
            sourceType: "module",
            parserOpts: {
                allowReturnOutsideFunction: true,
                errorRecovery: false
            },
            plugins: [
                "jsx",
                "classProperties",
                "classPrivateProperties",
                "classPrivateMethods",
                "optionalChaining",
                "nullishCoalescingOperator",
                "dynamicImport",
                "topLevelAwait",
                "objectRestSpread"
            ]
        });
    } catch (err) {
        logError(`JS Syntax Error in ${path}:\n${err.message}`);
    }
}

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