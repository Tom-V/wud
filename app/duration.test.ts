import { isDuration, parseDurationMs } from './duration';

test.each([
    ['0s', 0],
    ['30s', 30_000],
    ['15m', 900_000],
    ['12h', 43_200_000],
    ['3d', 259_200_000],
    ['1w', 604_800_000],
    [' 12H ', 43_200_000],
])('parseDurationMs should parse %s', (duration, expected) => {
    expect(parseDurationMs(duration)).toBe(expected);
});

test.each(['', '12', 'h', '1y', '-1h', '1.5h', '500ms'])(
    'parseDurationMs should reject %s',
    (duration) => {
        expect(() => parseDurationMs(duration)).toThrow();
        expect(isDuration(duration)).toBe(false);
    },
);
