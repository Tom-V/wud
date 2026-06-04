import joi from 'joi';
import flat from 'flat';
import { snakeCase } from 'snake-case';
import * as tag from '../tag';
const { parse: parseSemver, diff: diffSemver, transform: transformTag } = tag;

export interface ContainerImage {
    id: string;
    registry: {
        name: string;
        url: string;
    };
    name: string;
    tag: {
        value: string;
        semver: boolean;
    };
    digest: {
        watch: boolean;
        value?: string;
        repo?: string;
    };
    architecture: string;
    os: string;
    variant?: string;
    created?: string;
}

export interface ContainerResult {
    tag?: string;
    digest?: string;
    created?: string;
    link?: string;
    updateKind?: ContainerUpdateKind;
    updateAvailable?: boolean;
    updatePending?: boolean;
    updatePendingReason?: 'minimum-age';
    updatePendingUntil?: string;
    selected?: boolean;
}

export interface ContainerResultSelection {
    mode: 'auto' | 'manual';
    tag?: string;
    digest?: string;
    created?: string;
    baselineTag?: string;
    baselineDigest?: string;
    baselineCreated?: string;
}

export interface ContainerUpdateKind {
    kind: 'tag' | 'digest' | 'unknown';
    localValue?: string;
    remoteValue?: string;
    semverDiff?: 'major' | 'minor' | 'patch' | 'prerelease' | 'unknown';
}

export interface Container {
    id: string;
    name: string;
    displayName: string;
    displayIcon: string;
    status: string;
    watcher: string;
    includeTags?: string;
    excludeTags?: string;
    includePrerelease?: boolean;
    transformTags?: string;
    linkTemplate?: string;
    link?: string;
    minAge?: string;
    triggerInclude?: string;
    triggerExclude?: string;
    image: ContainerImage;
    result?: ContainerResult;
    results: ContainerResult[];
    resultSelection: ContainerResultSelection;
    error?: {
        message: string;
    };
    updateAvailable: boolean;
    updatePending: boolean;
    updatePendingReason?: 'minimum-age';
    updatePendingUntil?: string;
    updateKind: ContainerUpdateKind;
    labels?: Record<string, string>;
    resultChanged?: (otherContainer: Container | undefined) => boolean;
}

const updateKindSchema = joi.object({
    kind: joi.string().allow('tag', 'digest', 'unknown').required(),
    localValue: joi.string(),
    remoteValue: joi.string(),
    semverDiff: joi
        .string()
        .allow('major', 'minor', 'patch', 'prerelease', 'unknown'),
});

const resultSchema = joi.object({
    tag: joi.string().min(1),
    digest: joi.string(),
    created: joi.string().isoDate(),
    link: joi.string(),
    updateKind: updateKindSchema,
    updateAvailable: joi.boolean(),
    updatePending: joi.boolean(),
    updatePendingReason: joi.string().allow('minimum-age'),
    updatePendingUntil: joi.string().isoDate(),
    selected: joi.boolean(),
});

const resultSelectionSchema = joi.object({
    mode: joi.string().allow('auto', 'manual').required(),
    tag: joi.string().min(1),
    digest: joi.string(),
    created: joi.string().isoDate(),
    baselineTag: joi.string().min(1),
    baselineDigest: joi.string(),
    baselineCreated: joi.string().isoDate(),
});

// Container data schema
const schema = joi.object({
    id: joi.string().min(1).required(),
    name: joi.string().min(1).required(),
    displayName: joi.string().default(joi.ref('name')),
    displayIcon: joi.string().default('mdi:docker'),
    status: joi.string().default('unknown'),
    watcher: joi.string().min(1).required(),
    includeTags: joi.string(),
    excludeTags: joi.string(),
    includePrerelease: joi.boolean(),
    transformTags: joi.string(),
    linkTemplate: joi.string(),
    link: joi.string(),
    minAge: joi.string(),
    triggerInclude: joi.string(),
    triggerExclude: joi.string(),
    image: joi
        .object({
            id: joi.string().min(1).required(),
            registry: joi
                .object({
                    name: joi.string().min(1).required(),
                    url: joi.string().min(1).required(),
                })
                .required(),
            name: joi.string().min(1).required(),
            tag: joi
                .object({
                    value: joi.string().min(1).required(),
                    semver: joi.boolean().default(false),
                })
                .required(),
            digest: joi
                .object({
                    watch: joi.boolean().default(false),
                    value: joi.string(),
                    repo: joi.string(),
                })
                .required(),
            architecture: joi.string().min(1).required(),
            os: joi.string().min(1).required(),
            variant: joi.string(),
            created: joi.string().isoDate(),
        })
        .required(),
    result: resultSchema,
    results: joi.array().items(resultSchema).default([]),
    resultSelection: resultSelectionSchema.default({ mode: 'auto' }),
    error: joi.object({
        message: joi.string().min(1).required(),
    }),
    updateAvailable: joi.boolean().default(false),
    updatePending: joi.boolean().default(false),
    updatePendingReason: joi.string().allow('minimum-age'),
    updatePendingUntil: joi.string().isoDate(),
    updateKind: updateKindSchema.default({ kind: 'unknown' }),
    resultChanged: joi.function(),
    labels: joi.object(),
});

/**
 * Render Link template.
 * @param container
 * @returns {undefined|*}
 */
function getLink(container: Container, originalTagValue: string) {
    if (!container || !container.linkTemplate) {
        return undefined;
    }

    // Export vars for dynamic template interpolation
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const raw = originalTagValue; // deprecated, kept for backward compatibility
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const original = originalTagValue;
    const transformed = container.transformTags
        ? transformTag(container.transformTags, originalTagValue)
        : originalTagValue;
    let major = '';
    let minor = '';
    let patch = '';
    let prerelease = '';

    if (container.image.tag.semver) {
        const versionSemver = parseSemver(transformed);
        if (versionSemver) {
            // eslint-disable-next-line @typescript-eslint/no-unused-vars
            major = String(versionSemver.major);
            // eslint-disable-next-line @typescript-eslint/no-unused-vars
            minor = String(versionSemver.minor);
            // eslint-disable-next-line @typescript-eslint/no-unused-vars
            patch = String(versionSemver.patch);
            // eslint-disable-next-line @typescript-eslint/no-unused-vars
            prerelease =
                versionSemver.prerelease && versionSemver.prerelease.length > 0
                    ? String(versionSemver.prerelease[0])
                    : '';
        }
    }

    return eval('`' + container.linkTemplate + '`');
}

function hasUpdateCandidate(container: Container, result: ContainerResult) {
    if (container.image === undefined || result === undefined) {
        return false;
    }

    // Compare digests if we have them
    if (
        container.image.digest.watch &&
        container.image.digest.value !== undefined &&
        result.digest !== undefined
    ) {
        return container.image.digest.value !== result.digest;
    }

    let updateAvailable = false;
    if (result.tag !== undefined) {
        const localTag = transformTag(
            container.transformTags,
            container.image.tag.value,
        );
        const remoteTag = transformTag(container.transformTags, result.tag);
        updateAvailable = localTag !== remoteTag;
    }

    // Fallback to image created date (especially for legacy v1 manifests)
    if (container.image.created !== undefined && result.created !== undefined) {
        const createdDate = new Date(container.image.created).getTime();
        const createdDateResult = new Date(result.created).getTime();

        updateAvailable = updateAvailable || createdDate !== createdDateResult;
    }
    return updateAvailable;
}

function getUpdateKind(
    container: Container,
    result: ContainerResult | undefined,
    candidateUpdateAvailable?: boolean,
    candidateUpdatePending?: boolean,
) {
    const updateKind: ContainerUpdateKind = {
        kind: 'unknown',
        localValue: undefined,
        remoteValue: undefined,
        semverDiff: undefined,
    };
    if (container.image === undefined || result === undefined) {
        return updateKind;
    }
    if (!candidateUpdateAvailable && !candidateUpdatePending) {
        return updateKind;
    }

    if (result.tag !== undefined && container.image.tag.value !== result.tag) {
        updateKind.kind = 'tag';
        let semverDiffWud: ContainerUpdateKind['semverDiff'] = 'unknown';
        const isSemver = container.image.tag.semver;
        if (isSemver) {
            const semverDiff = diffSemver(
                transformTag(
                    container.transformTags,
                    container.image.tag.value,
                ),
                transformTag(container.transformTags, result.tag),
            );
            switch (semverDiff) {
                case 'major':
                    semverDiffWud = 'major';
                    break;
                case 'minor':
                    semverDiffWud = 'minor';
                    break;
                case 'patch':
                    semverDiffWud = 'patch';
                    break;
                case 'premajor':
                case 'preminor':
                case 'prepatch':
                case 'prerelease':
                    semverDiffWud = 'prerelease';
                    break;
                default:
                    semverDiffWud = 'unknown';
            }
        }
        updateKind.localValue = container.image.tag.value;
        updateKind.remoteValue = result.tag;
        updateKind.semverDiff = semverDiffWud;
    } else if (
        container.image.digest &&
        result.digest !== undefined &&
        container.image.digest.value !== result.digest
    ) {
        updateKind.kind = 'digest';
        updateKind.localValue = container.image.digest.value;
        updateKind.remoteValue = result.digest;
    }
    return updateKind;
}

/**
 * Computed function to check whether there is an update.
 * @param container
 * @returns {boolean}
 */
function addUpdateAvailableProperty(container: Container) {
    Object.defineProperty(container, 'updateAvailable', {
        enumerable: true,
        get(this: Container) {
            if (this.image === undefined || this.result === undefined) {
                return false;
            }
            if (this.updatePending) {
                return false;
            }
            return hasUpdateCandidate(container, this.result);
        },
    });
}

/**
 * Computed link property.
 * @param container
 * @returns {undefined|*}
 */
function addLinkProperty(container: Container) {
    if (container.linkTemplate) {
        Object.defineProperty(container, 'link', {
            enumerable: true,
            get(this: Container) {
                return getLink(container, container.image.tag.value);
            },
        });

        if (container.result) {
            addResultLinkProperty(container, container.result);
        }
        container.results.forEach((result) => {
            if (result.tag) {
                addResultLinkProperty(container, result);
            }
        });
    }
}

function addResultLinkProperty(container: Container, result: ContainerResult) {
    Object.defineProperty(result, 'link', {
        enumerable: true,
        get() {
            return getLink(container, result.tag ?? '');
        },
    });
}

function resultMatches(
    result1: ContainerResult | undefined,
    result2: ContainerResult | undefined,
) {
    if (result1 === undefined || result2 === undefined) {
        return false;
    }

    if (result2.tag === undefined && result2.digest !== undefined) {
        return (
            result1.digest === result2.digest &&
            (result2.created === undefined ||
                result1.created === result2.created)
        );
    }

    return (
        result1.tag === result2.tag &&
        result1.digest === result2.digest &&
        result1.created === result2.created
    );
}

function hasReferenceFields(reference: Partial<ContainerResult> | undefined) {
    return (
        reference !== undefined &&
        (reference.tag !== undefined ||
            reference.digest !== undefined ||
            reference.created !== undefined)
    );
}

export function candidateMatchesReference(
    candidate: ContainerResult | undefined,
    reference: Partial<ContainerResult> | undefined,
) {
    if (!candidate || !hasReferenceFields(reference)) {
        return false;
    }
    if (reference?.tag !== undefined && candidate.tag !== reference.tag) {
        return false;
    }
    if (
        reference?.digest !== undefined &&
        candidate.digest !== reference.digest
    ) {
        return false;
    }
    if (
        reference?.created !== undefined &&
        candidate.created !== reference.created
    ) {
        return false;
    }
    return true;
}

export function getCandidateReference(candidate: ContainerResult | undefined) {
    return {
        tag: candidate?.tag,
        digest: candidate?.digest,
        created: candidate?.created,
    };
}

export function getSelectionReference(
    selection: ContainerResultSelection | undefined,
) {
    return {
        tag: selection?.tag,
        digest: selection?.digest,
        created: selection?.created,
    };
}

export function getSelectionBaselineReference(
    selection: ContainerResultSelection | undefined,
) {
    return {
        tag: selection?.baselineTag,
        digest: selection?.baselineDigest,
        created: selection?.baselineCreated,
    };
}

export function getAutomaticResultCandidate(results: ContainerResult[] = []) {
    return results.find((result) => !result.updatePending) ?? results[0];
}

export function applyResultCandidate(
    container: Container,
    candidate: ContainerResult | undefined,
) {
    delete container.updatePendingReason;
    delete container.updatePendingUntil;
    container.updatePending = false;

    if (!candidate) {
        container.result = { tag: container.image.tag.value };
        return;
    }

    const selectedResult: ContainerResult = {
        tag: candidate.tag ?? container.image.tag.value,
    };
    if (candidate.digest !== undefined) {
        selectedResult.digest = candidate.digest;
    }
    if (candidate.created !== undefined) {
        selectedResult.created = candidate.created;
    }
    container.result = selectedResult;

    container.updatePending = candidate.updatePending ?? false;
    if (candidate.updatePendingReason !== undefined) {
        container.updatePendingReason = candidate.updatePendingReason;
    }
    if (candidate.updatePendingUntil !== undefined) {
        container.updatePendingUntil = candidate.updatePendingUntil;
    }
}

function addResultsProperties(container: Container) {
    container.results = container.results.filter((result) => {
        const hasCandidateUpdate = hasUpdateCandidate(container, result);
        result.updatePending = result.updatePending ?? false;
        result.updateAvailable = result.updatePending
            ? false
            : hasCandidateUpdate;
        result.updateKind = getUpdateKind(
            container,
            result,
            result.updateAvailable,
            result.updatePending && hasCandidateUpdate,
        );
        result.selected = resultMatches(container.result, result);
        return hasCandidateUpdate;
    });
}

/**
 * Computed updateKind property.
 * @param container
 * @returns {{semverDiff: undefined, kind: string, remoteValue: undefined, localValue: undefined}}
 */
function addUpdateKindProperty(container: Container) {
    Object.defineProperty(container, 'updateKind', {
        enumerable: true,
        get(this: Container) {
            return getUpdateKind(
                container,
                container.result,
                container.updateAvailable,
                container.updatePending,
            );
        },
    });
}

/**
 * Computed function to check whether the result is different.
 * @param otherContainer
 * @returns {boolean}
 */
function resultChangedFunction(
    this: Container,
    otherContainer: Container | undefined,
) {
    return (
        otherContainer === undefined ||
        this.result?.tag !== otherContainer.result?.tag ||
        this.result?.digest !== otherContainer.result?.digest ||
        this.result?.created !== otherContainer.result?.created ||
        this.updatePending !== otherContainer.updatePending ||
        this.updatePendingReason !== otherContainer.updatePendingReason ||
        this.updatePendingUntil !== otherContainer.updatePendingUntil ||
        this.resultSelection?.mode !== otherContainer.resultSelection?.mode ||
        this.resultSelection?.tag !== otherContainer.resultSelection?.tag ||
        this.resultSelection?.digest !==
            otherContainer.resultSelection?.digest ||
        this.resultSelection?.created !==
            otherContainer.resultSelection?.created ||
        this.resultSelection?.baselineTag !==
            otherContainer.resultSelection?.baselineTag ||
        this.resultSelection?.baselineDigest !==
            otherContainer.resultSelection?.baselineDigest ||
        this.resultSelection?.baselineCreated !==
            otherContainer.resultSelection?.baselineCreated
    );
}

/**
 * Add computed function to check whether the result is different.
 * @param container
 * @returns {*}
 */
function addResultChangedFunction(container: Container) {
    const containerWithResultChanged = container;
    containerWithResultChanged.resultChanged = resultChangedFunction;
    return containerWithResultChanged;
}

/**
 * Apply validation to the container object.
 * @param container
 * @returns {*}
 */
export function validate(container: any): Container {
    const validation = schema.validate(container);
    if (validation.error) {
        throw new Error(
            `Error when validating container properties ${validation.error}`,
        );
    }
    const containerValidated = validation.value as Container;

    // Add computed properties
    addUpdateAvailableProperty(containerValidated);
    addUpdateKindProperty(containerValidated);
    addResultsProperties(containerValidated);
    addLinkProperty(containerValidated);

    // Add computed functions
    addResultChangedFunction(containerValidated);
    return containerValidated;
}

/**
 * Flatten the container object (useful for k/v based integrations).
 * @param container
 * @returns {*}
 */
export function flatten(container: Container) {
    const containerFlatten: any = flat(container, {
        delimiter: '_',
        transformKey: (key: string) => snakeCase(key),
    });
    delete containerFlatten.result_changed;
    Object.keys(containerFlatten)
        .filter(
            (key) =>
                key === 'results' ||
                key.startsWith('results_') ||
                key === 'result_selection' ||
                key.startsWith('result_selection_'),
        )
        .forEach((key) => delete containerFlatten[key]);
    return containerFlatten;
}

/**
 * Build the business id of the container.
 * @param container
 * @returns {string}
 */
export function fullName(container: Pick<Container, 'watcher' | 'name'>) {
    return `${container.watcher}_${container.name}`;
}

// The following exports are meant for testing only
export {
    getLink as testable_getLink,
    addUpdateKindProperty as testable_addUpdateKindProperty,
};
