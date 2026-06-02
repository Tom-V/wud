const DURATION_MULTIPLIERS_MS: Record<string, number> = {
    s: 1000,
    m: 60_000,
    h: 3_600_000,
    d: 86_400_000,
    w: 604_800_000,
};

export function parseDurationMs(duration: string) {
    const match = String(duration)
        .trim()
        .match(/^(\d+)(s|m|h|d|w)$/i);
    if (!match) {
        throw new Error(
            `Invalid duration "${duration}". Expected a non-negative integer followed by one of: s, m, h, d, w`,
        );
    }

    const value = Number(match[1]);
    const unit = match[2].toLowerCase();
    return value * DURATION_MULTIPLIERS_MS[unit];
}

export function isDuration(duration: string) {
    try {
        parseDurationMs(duration);
        return true;
    } catch {
        return false;
    }
}
