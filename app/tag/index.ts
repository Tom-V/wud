/**
 * Semver utils.
 */
import semver from 'semver';
import log from '../log';

/**
 * Parse partial semver prereleases with a missing patch number.
 * Examples: 0.8-rc1 -> 0.8.0-rc1, v0.8-beta1 -> 0.8.0-beta1.
 * This preserves prerelease metadata that semver.coerce would otherwise drop.
 * Other non-standard versions are handled by the later semver.coerce fallback.
 */
function parsePartialSemverWithPrerelease(rawVersion) {
    const versionWithoutPrefix =
        rawVersion.startsWith('v') || rawVersion.startsWith('V')
            ? rawVersion.substring(1)
            : rawVersion;
    const prereleaseSeparatorIndex = versionWithoutPrefix.indexOf('-');
    if (prereleaseSeparatorIndex === -1) {
        return null;
    }

    const versionParts = versionWithoutPrefix
        .substring(0, prereleaseSeparatorIndex)
        .split('.');
    if (versionParts.length !== 2) {
        return null;
    }

    const prerelease = versionWithoutPrefix.substring(
        prereleaseSeparatorIndex + 1,
    );
    return semver.parse(`${versionParts.join('.')}.0-${prerelease}`);
}

/**
 * Parse a string to a semver (return null is it cannot be parsed as a valid semver).
 * @param rawVersion
 * @returns {*|SemVer}
 */
export function parse(rawVersion) {
    const rawVersionCleaned = semver.clean(rawVersion, { loose: true });
    const rawVersionSemver = semver.parse(
        rawVersionCleaned !== null ? rawVersionCleaned : rawVersion,
    );
    // Hurrah!
    if (rawVersionSemver !== null) {
        return rawVersionSemver;
    }

    const partialSemverWithPrerelease =
        parsePartialSemverWithPrerelease(rawVersion);
    if (partialSemverWithPrerelease !== null) {
        return partialSemverWithPrerelease;
    }

    // Last chance; try to coerce (all data behind patch digit will be lost).
    return semver.coerce(rawVersion);
}

/**
 * Return true if version1 is semver greater than version2.
 * @param version1
 * @param version2
 */
export function isGreater(version1, version2) {
    const version1Semver = parse(version1);
    const version2Semver = parse(version2);

    // No comparison possible
    if (version1Semver === null || version2Semver === null) {
        return false;
    }
    return semver.gte(version1Semver, version2Semver);
}

/**
 * Diff between 2 semver versions.
 * @param version1
 * @param version2
 * @returns {*|string|null}
 */
export function diff(version1, version2) {
    const version1Semver = parse(version1);
    const version2Semver = parse(version2);

    // No diff possible
    if (version1Semver === null || version2Semver === null) {
        return null;
    }
    return semver.diff(version1Semver, version2Semver);
}

/**
 * Transform a tag using a formula.
 * @param transformFormula
 * @param originalTag
 * @return {*}
 */
export function transform(transformFormula, originalTag) {
    // No formula ? return original tag value
    if (!transformFormula || transformFormula === '') {
        return originalTag;
    }
    try {
        const transformFormulaSplit = transformFormula.split(/\s*=>\s*/);
        const transformRegex = new RegExp(transformFormulaSplit[0]);
        const placeholders = transformFormulaSplit[1].match(/\$\d+/g);
        const originalTagMatches = originalTag.match(transformRegex);

        let transformedTag = transformFormulaSplit[1];
        placeholders.forEach((placeholder) => {
            const placeholderIndex = Number.parseInt(
                placeholder.substring(1),
                10,
            );
            transformedTag = transformedTag.replace(
                new RegExp(placeholder.replace('$', '\\$'), 'g'),
                // An optional capture group may not participate in the match
                // (for example an optional group in the formula). Substitute
                // an empty string for it, rather than letting replace() coerce
                // undefined into the literal "undefined" and corrupt the tag.
                originalTagMatches[placeholderIndex] !== undefined
                    ? originalTagMatches[placeholderIndex]
                    : '',
            );
        });
        return transformedTag;
    } catch (e) {
        // Upon error; log & fallback to original tag value
        log.warn(
            `Error when applying transform function [${transformFormula}]to tag [${originalTag}]`,
        );
        log.debug(JSON.stringify(e));
        return originalTag;
    }
}
