// Global model to hold all files
window.__repoFiles = {
    html: {},
    js: {},
    css: {}
};

// --- Public function to process a file ---
function proofreadFile(path, content) {
    // Save content in global model
    if (path.endsWith(".html")) window.__repoFiles.html[path] = content;
    else if (path.endsWith(".js")) window.__repoFiles.js[path] = content;
    else if (path.endsWith(".css")) window.__repoFiles.css[path] = content;

    // Return immediate syntax issues for this file
    return getSyntaxIssues(path, content);
}

// --- Syntax checks for individual files ---
function getSyntaxIssues(path, content) {
    const issues = [];

    if (path.endsWith(".js")) {
        try {
            esprima.parseScript(content, { tolerant: true });
        } catch (err) {
            issues.push(`JS Syntax Error: ${err.message}`);
        }
    }

    if (path.endsWith(".html")) {
        try {
            const parser = new DOMParser();
            const doc = parser.parseFromString(content, "text/html");
            const parseErrors = doc.querySelectorAll("parsererror");
            if (parseErrors.length) {
                issues.push(`HTML Parse Error: ${parseErrors[0].textContent}`);
            }
        } catch (err) {
            issues.push(`HTML Parse Exception: ${err.message}`);
        }
    }

    if (path.endsWith(".css")) {
        try {
            // Simple CSS parsing: detect unmatched braces
            let stack = [];
            for (let i = 0; i < content.length; i++) {
                if (content[i] === "{") stack.push("{");
                else if (content[i] === "}") {
                    if (stack.length === 0) issues.push(`CSS unmatched closing brace at char ${i}`);
                    else stack.pop();
                }
            }
            if (stack.length > 0) issues.push(`CSS unmatched opening brace(s)`);
        } catch (err) {
            issues.push(`CSS Parse Exception: ${err.message}`);
        }
    }

    return issues;
}

// --- Cross-file analysis ---
function runCrossFileAnalysis() {
    const issues = [];

    // --- HTML checks ---
    const allIDs = new Set();
    const allClasses = new Set();
    for (const path in window.__repoFiles.html) {
        const content = window.__repoFiles.html[path];
        const parser = new DOMParser();
        const doc = parser.parseFromString(content, "text/html");

        // Check IDs for duplicates
        const ids = Array.from(doc.querySelectorAll("[id]")).map(el => el.id);
        ids.forEach(id => {
            if (allIDs.has(id)) issues.push(`${path}: Duplicate HTML ID '${id}'`);
            else allIDs.add(id);
        });

        // Track classes for cross-file CSS check
        const classes = Array.from(doc.querySelectorAll("[class]"))
            .map(el => el.className.split(/\s+/))
            .flat();
        classes.forEach(cls => allClasses.add(cls));

        // Check linked scripts and styles
        const scripts = Array.from(doc.querySelectorAll("script[src]")).map(el => el.getAttribute("src"));
        scripts.forEach(src => {
            if (!window.__repoFiles.js[src] && !window.__repoFiles.js[src.replace(/^\.\//,"")])
                issues.push(`${path}: Missing JS file referenced: ${src}`);
        });
        const links = Array.from(doc.querySelectorAll("link[rel='stylesheet']")).map(el => el.getAttribute("href"));
        links.forEach(href => {
            if (!window.__repoFiles.css[href] && !window.__repoFiles.css[href.replace(/^\.\//,"")])
                issues.push(`${path}: Missing CSS file referenced: ${href}`);
        });
    }

    // --- JS cross-file checks ---
    const definedFunctions = {};
    for (const path in window.__repoFiles.js) {
        const content = window.__repoFiles.js[path];
        const ast = esprima.parseScript(content, { tolerant: true });
        ast.body.forEach(node => {
            if (node.type === "FunctionDeclaration" && node.id && node.id.name) {
                definedFunctions[node.id.name] = path;
            }
        });
    }

    for (const path in window.__repoFiles.js) {
        const content = window.__repoFiles.js[path];
        const ast = esprima.parseScript(content, { tolerant: true });
        // Check function calls
        traverseAST(ast, node => {
            if (node.type === "CallExpression" && node.callee.type === "Identifier") {
                const fn = node.callee.name;
                if (!definedFunctions[fn]) issues.push(`${path}: Call to undefined function '${fn}'`);
            }
        });
    }

    // --- CSS cross-file checks ---
    const cssSelectors = new Set();
    for (const path in window.__repoFiles.css) {
        const content = window.__repoFiles.css[path];
        const regex = /\.([a-zA-Z0-9_-]+)/g;
        let m;
        while ((m = regex.exec(content)) !== null) {
            cssSelectors.add(m[1]);
        }
    }

    allClasses.forEach(cls => {
        if (!cssSelectors.has(cls)) issues.push(`HTML class '${cls}' used but not defined in any CSS`);
    });

    return issues;
}

// --- Utility: simple AST traversal ---
function traverseAST(node, cb) {
    cb(node);
    for (const key in node) {
        if (node.hasOwnProperty(key)) {
            const child = node[key];
            if (Array.isArray(child)) child.forEach(n => n && typeof n.type === "string" && traverseAST(n, cb));
            else if (child && typeof child.type === "string") traverseAST(child, cb);
        }
    }
}

// --- Exported for script.js ---
window.proofreader = {
    proofreadFile,
    runCrossFileAnalysis
};