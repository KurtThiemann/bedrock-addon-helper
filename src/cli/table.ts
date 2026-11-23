/** Formats rows as left-aligned columns separated by two spaces. */
export function formatTable(header: readonly string[], rows: readonly (readonly string[])[]): string {
    const widths = header.map((title, column) =>
        Math.max(title.length, ...rows.map((row) => (row[column] ?? "").length)),
    );
    const format = (row: readonly string[]) =>
        row
            .map((cell, column) => cell.padEnd(widths[column] ?? 0))
            .join("  ")
            .trimEnd();
    return `${[header, ...rows].map(format).join("\n")}\n`;
}
