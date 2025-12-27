const output = document.getElementById("proofreaderResults");
const repoInput = document.getElementById("repoInput");
const scanBtn = document.getElementById("scanBtn");
const repoInfo = document.getElementById("repoInfo");
const fileTreeContainer = document.getElementById("fileTree");

const moduleExportsMap = {};
const moduleContentMap = {};

// ---------------------------
// Utilities
// ---------------------------
function getRepoFromInput(input) {
    if (!input) return null;

    // owner/repo format
    if (/^[\w.-]+\/[\w.-]+$/.test(input)) return input.trim();

    // full GitHub URL
    const match = input.match(/github\.com\/([^\/]+\/[^\/]+)/i);
    if (match) return match[1];

    return null;
}

function log(msg, type="") {
    const div = document.createElement("div");
    div.textContent = msg;
    if(type==="error") div.className = "error";
    else if(type==="ok") div.className = "ok";
    output.appendChild(div);
}

// ---------------------------
// Event listeners
// ---------------------------
scanBtn.addEventListener("click", () => {
    const rawInput = repoInput.value.trim();
    const repo = getRepoFromInput(rawInput);
    if (!repo) { alert("Invalid repository input."); return; }
    window.location.hash = encodeURIComponent(rawInput);
    startScan(repo);
});

window.addEventListener("hashchange", () => {
    const hash = decodeURIComponent(window.location.hash.slice(1));
    if (hash) {
        repoInput.value = hash;
        const repo = getRepoFromInput(hash);
        if (repo) startScan(repo);
    }
});

window.addEventListener("load", () => {
    const hash = decodeURIComponent(window.location.hash.slice(1));
    if (hash) {
        repoInput.value = hash;
        const repo = getRepoFromInput(hash);
        if (repo) startScan(repo);
    }
});

// ---------------------------
// Core scan
// ---------------------------
async function startScan(ownerRepo) {
    output.textContent = "";
    fileTreeContainer.innerHTML = "";
    repoInfo.textContent = `Fetching repository: ${ownerRepo}...`;

    try {
        const repoRes = await fetch(`https://api.github.com/repos/${ownerRepo}`);
        if(!repoRes.ok) throw new Error("Failed to fetch repo info.");
        const repoData = await repoRes.json();
        const branch = repoData.default_branch || "main";

        const treeRes = await fetch(`https://api.github.com/repos/${ownerRepo}/git/trees/${branch}?recursive=1`);
        if(!treeRes.ok) throw new Error("Failed to fetch repository tree.");
        const treeData = await treeRes.json();

        repoInfo.textContent = `Repository: ${ownerRepo} | Branch: ${branch} | ${treeData.tree.length} items`;

        // Fetch file content first
        for(const item of treeData.tree) {
            if(item.type!=="blob") continue;
            const path = item.path;
            try{
                const res = await fetch(`https://raw.githubusercontent.com/${ownerRepo}/${branch}/${path}`);
                if(res.ok) moduleContentMap[path] = await res.text();
            } catch {}
        }

        // Build file tree
        const root = {};
        treeData.tree.forEach(item => {
            const parts = item.path.split("/");
            let cur = root;
            parts.forEach((part, i) => {
                if(!cur[part]) cur[part] = { _type: i===parts.length-1 ? item.type : "tree", _path: item.path };
                cur = cur[part];
            });
        });
        fileTreeContainer.appendChild(buildTreeList(root, ownerRepo, branch));

        // Parse all JS/HTML/CSS
        for(const path in moduleContentMap) {
            await proofreadFile(path);
        }

        log("Proofreading complete.", "ok");

    } catch(err) {
        repoInfo.textContent = `Error: ${err.message}`;
    }
}

// ---------------------------
// File tree
// ---------------------------
function buildTreeList(tree, ownerRepo, branch){
    const ul = document.createElement("ul");
    for(const key in tree){
        if(key.startsWith("_")) continue;
        const li = document.createElement("li");
        li.textContent = key;
        li.className = tree[key]._type==="tree" ? "folder":"file";
        if(tree[key]._type==="tree"){
            li.appendChild(buildTreeList(tree[key], ownerRepo, branch));
        }else{
            li.onclick = async ()=>{
                if(li.querySelector("pre")) return;
                const pre = document.createElement("pre");
                pre.textContent = `Loading ${tree[key]._path}...`;
                li.appendChild(pre);
                try{
                    const content = moduleContentMap[tree[key]._path];
                    pre.textContent = content;
                }catch(err){
                    pre.textContent = `Error: ${err.message}`;
                }
            };
        }
        ul.appendChild(li);
    }
    return ul;
}

// ---------------------------
// Proofreader
// ---------------------------
async function proofreadFile(path){
    const content = moduleContentMap[path];
    if(!content) return;

    if(path.endsWith(".js")) parseJS(content, path);
    else if(path.endsWith(".html")) parseHTML(content, path);
    else if(path.endsWith(".css")) parseCSS(content, path);
}

function parseJS(code, path){
    try{
        Babel.transform(code,{ ast:true, code:false, sourceType:"module" });
        log(`JS parsed: ${path}`, "ok");
    }catch(err){
        log(`JS Syntax Error in ${path}:\n${err.message}`, "error");
    }
}

function parseHTML(html, path){
    try{
        const doc = new DOMParser().parseFromString(html, "text/html");
        if(doc.querySelector("parsererror")) log(`HTML parse error in ${path}`,"error");
        else log(`HTML parsed: ${path}`, "ok");
    }catch(err){
        log(`HTML Error in ${path}:\n${err.message}`,"error");
    }
}

function parseCSS(css, path){
    try{
        const sheet = new CSSStyleSheet();
        sheet.replaceSync(css);
        log(`CSS parsed: ${path}`,"ok");
    }catch(err){
        log(`CSS Syntax Error in ${path}:\n${err.message}`,"error");
    }
}