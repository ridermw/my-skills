/** UTC midnight for a strict ISO date, or null rather than a normalized rollover. */
export function isoDateTime(iso) {
    if (typeof iso !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
    const t = Date.parse(iso + "T00:00:00Z");
    return !Number.isNaN(t) && new Date(t).toISOString().slice(0, 10) === iso ? t : null;
}
