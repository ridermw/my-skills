export function parseMarkdownTableRow(line) {
    const row = line.trim();
    const out = [];
    let cell = "";
    let backslashes = 0;
    for (let i = row.startsWith("|") ? 1 : 0; i < row.length; i++) {
        const char = row[i];
        if (char === "\\") {
            backslashes++;
            continue;
        }
        // Only an odd backslash run escapes a pipe; other backslashes stay verbatim.
        if (char === "|" && backslashes % 2 === 0) {
            cell += "\\".repeat(backslashes);
            out.push(cell.trim());
            cell = "";
        } else {
            cell += "\\".repeat(backslashes - (char === "|" ? 1 : 0)) + char;
        }
        backslashes = 0;
    }
    cell += "\\".repeat(backslashes);
    if (cell || !row.endsWith("|")) out.push(cell.trim());
    return out;
}
