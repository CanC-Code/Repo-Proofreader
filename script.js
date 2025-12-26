///// script.js
///// Author: CCVO
///// Purpose: Repository loading and file tree management

const repoInput = document.getElementById("repoInput");
const loadBtn = document.getElementById("loadBtn");
const fileTreeContainer = document.getElementById("fileTree");
const repoInfo = document.getElementById("repoInfo");
const proofreaderResults = document.getElementById("proofreaderResults");

const loadAllFiles = true;

// --- Load repository ---
async function loadRepository(ownerRepo) {
    repoInfo.textContent = `Fetching repository info for ${ownerRepo}...`;
    fileTreeContainer.innerHTML = "";
    proofreaderResults.innerHTML = "";

    try {
        const repoRes = await fetch(`https://api.github.com/repos/${ownerRepo}`);
        if (!repoRes.ok) throw new Error("Failed to fetch repo info.");
        const repoData = await repoRes.json();
        const branch = repoData.default_branch || "main";

        const treeRes = await fetch(`https://api.github.com/repos/${ownerRepo}/git/trees/${branch}?recursive=1`);
        if (!treeRes.ok) throw new Error("Failed to fetch repo tree.");
        const treeData = await treeRes.json();

        repoInfo.textContent = `Repository: ${ownerRepo} (branch: ${branch}) | ${treeData.tree.length} items`;

        const root = {};
        treeData.tree.forEach(item => {
            const parts = item.path.split("/");
            let cur = root;
            parts.forEach((part, i) => {
                if (!cur[part]) cur[part] = { _type: i === parts.length - 1 ? item.type : "tree", _path: item.path };
                cur = cur[part];
            });
        });

        const ul = buildTreeList(root, ownerRepo, branch);
        fileTreeContainer.appendChild(ul);

        if (loadAllFiles) {
            const fileElements = fileTreeContainer.querySelectorAll("li.file");
            fileElements.forEach(li => li.click());
        }

        window.__github_explorer_files = { ownerRepo, branch, files: treeData.tree };

    } catch (err) {
        repoInfo.textContent = `Error: ${err.message}`;
    }
}

// --- Build tree ---
function buildTreeList(tree, ownerRepo, branch) {
    const ul = document.createElement("ul");
    for (const key in tree) {
        if (key.startsWith("_")) continue;
        const li = document.createElement("li");
        li.textContent = key;
        li.className = tree[key]._type === "tree" ? "folder" : "file";

        if (tree[key]._type === "tree") {
            li.appendChild(buildTreeList(tree[key], ownerRepo, branch));
        } else {
            li.onclick = async () => {
                if (li.querySelector("pre")) return;
                const pre = document.createElement("pre");
                pre.textContent = `Loading ${tree[key]._path}...`;
                li.appendChild(pre);
                try {
                    const res = await fetch(`https://raw.githubusercontent.com/${ownerRepo}/${branch}/${tree[key]._path}`);
                    const content = res.ok ? await res.text() : `Error: ${res.statusText}`;
                    pre.textContent = content;
                    Prism.highlightAll();

                    // Send file content to proofreader
                    proofreaderResults.appendChild(document.createTextNode(`Proofreading ${tree[key]._path}...\n`));
                    const issues = window.proofreader.proofreadFile(tree[key]._path, content);
                    issues.forEach(issue => {
                        proofreaderResults.appendChild(document.createTextNode(issue + "\n"));
                    });

                } catch (err) {
                    pre.textContent = `Error: ${err.message}`;
                }
            };
        }
        ul.appendChild(li);
    }
    return ul;
}

// --- Button ---
loadBtn.onclick = () => {
    let repo = repoInput.value.trim();
    const urlMatch = repo.match(/github\.com\/([^\/]+\/[^\/]+)(\/|$)/i);
    if (urlMatch) repo = urlMatch[1];

    if (repo) {
        window.location.hash = repoInput.value.trim();
        loadRepository(repo);
    }
};

// --- Hash or query ---
function checkURL() {
    const params = new URLSearchParams(window.location.search);
    let repo = params.get("repo");
    if (!repo && window.location.hash) repo = window.location.hash.slice(1);

    if (repo) {
        const urlMatch = repo.match(/github\.com\/([^\/]+\/[^\/]+)/i);
        if (urlMatch) repo = urlMatch[1];
        repoInput.value = repo;
        loadRepository(repo);
    }
}

checkURL();