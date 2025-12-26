// Very basic starter proofreader
// Extend with more rules later

function proofreadFile(path, content) {
    const issues = [];

    // Basic syntax check for JS files
    if (path.endsWith(".js")) {
        try {
            new Function(content);
        } catch (err) {
            issues.push(`JS Syntax Error: ${err.message}`);
        }
    }

    // Basic check for HTML unclosed tags
    if (path.endsWith(".html")) {
        const openTags = content.match(/<([a-z]+)(?!.*\/>)/gi) || [];
        const closeTags = content.match(/<\/([a-z]+)>/gi) || [];
        if (openTags.length !== closeTags.length) {
            issues.push(`HTML tag mismatch: ${openTags.length} open vs ${closeTags.length} close tags`);
        }
    }

    // Cross-file checks can be added later
    return issues;
}