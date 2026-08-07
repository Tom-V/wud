import fs from 'fs';
import Dockerode from 'dockerode';
import Joi from 'joi';
import JoiCronExpression from 'joi-cron-expression';
const joi = JoiCronExpression(Joi);
import cron, { ScheduledTask } from 'node-cron';
import debounce from 'just-debounce';
import {
    parse as parseSemver,
    isGreater as isGreaterSemver,
    transform as transformTag,
} from '../../../tag';
import * as event from '../../../event';
import {
    wudWatch,
    wudRegistry,
    wudTagInclude,
    wudTagExclude,
    wudTagIncludePrerelease,
    wudTagTransform,
    wudWatchDigest,
    wudWatchMinAge,
    wudLinkTemplate,
    wudDisplayName,
    wudDisplayIcon,
    wudTriggerInclude,
    wudTriggerExclude,
} from './label';
import { parseDockerImageName } from './image';
import * as storeContainer from '../../../store/container';
import {
    validate as validateContainer,
    fullName,
    Container,
    applyResultCandidate,
    candidateMatchesReference,
    getSelectionBaselineReference,
    getSelectionReference,
} from '../../../model/container';
import * as registry from '../../../registry';
import { RegistryManifest } from '../../../registries/Registry';
import { getWatchContainerGauge } from '../../../prometheus/watcher';
import Watcher from '../../Watcher';
import { ComponentConfiguration } from '../../../registry/Component';
import { Logger } from '../../../log';
import { isDuration, parseDurationMs } from '../../../duration';

export interface DockerWatcherConfiguration extends ComponentConfiguration {
    socket: string;
    host?: string;
    port: number;
    cafile?: string;
    certfile?: string;
    keyfile?: string;
    cron: string;
    jitter: number;
    watchbydefault: boolean;
    watchall: boolean;
    includeprerelease: boolean;
    watchdigest?: any;
    minage: string;
    watchevents: boolean;
    watchatstart: boolean;
}

// The delay before starting the watcher when the app is started
const START_WATCHER_DELAY_MS = 1000;

// Debounce delay used when performing a watch after a docker event has been received
const DEBOUNCED_WATCH_CRON_MS = 5000;

/**
 * Return all supported registries
 */
function getRegistries() {
    return registry.getState().registry;
}

function isPrereleaseTag(transformTags: string | undefined, tag: string) {
    const parsedTag = parseSemver(transformTag(transformTags, tag));
    return (
        parsedTag !== null &&
        parsedTag.prerelease !== undefined &&
        parsedTag.prerelease.length > 0
    );
}

function parseBooleanLabel(
    labelValue: string | undefined,
): boolean | undefined {
    return labelValue !== undefined && labelValue !== ''
        ? labelValue.toLowerCase() === 'true'
        : undefined;
}

function normalizeDuration(duration: string) {
    return duration.trim().toLowerCase();
}

function validateDuration(duration: string) {
    const normalizedDuration = normalizeDuration(duration);
    parseDurationMs(normalizedDuration);
    return normalizedDuration;
}

function getMinAge(
    minAgeLabelValue: string | undefined,
    watcherMinAge: string,
) {
    return validateDuration(
        minAgeLabelValue !== undefined && minAgeLabelValue !== ''
            ? minAgeLabelValue
            : watcherMinAge,
    );
}

function getWudLabels(labels: Record<string, string> | undefined = {}) {
    return Object.fromEntries(
        Object.entries(labels)
            .filter(([key]) => key.startsWith('wud.'))
            .sort(([key1], [key2]) => key1.localeCompare(key2)),
    );
}

function haveSameLabels(
    labels1: Record<string, string>,
    labels2: Record<string, string>,
) {
    const labelKeys1 = Object.keys(labels1);
    const labelKeys2 = Object.keys(labels2);

    if (labelKeys1.length !== labelKeys2.length) {
        return false;
    }

    return labelKeys1.every((key) => labels1[key] === labels2[key]);
}

function isCachedContainerValid(
    containerInStore: Container,
    currentLabels: Record<string, string> | undefined,
    watcherIncludePrerelease: boolean,
    watcherMinAge: string,
) {
    const currentWudLabels = getWudLabels(currentLabels);
    const cachedWudLabels = getWudLabels(containerInStore.labels);

    if (!haveSameLabels(currentWudLabels, cachedWudLabels)) {
        return false;
    }

    const currentIncludePrerelease =
        parseBooleanLabel(currentLabels?.[wudTagIncludePrerelease]) ??
        watcherIncludePrerelease;
    let currentMinAge: string;
    try {
        currentMinAge = getMinAge(
            currentLabels?.[wudWatchMinAge],
            watcherMinAge,
        );
    } catch {
        return false;
    }

    return (
        (containerInStore.includePrerelease ?? false) ===
            currentIncludePrerelease &&
        (containerInStore.minAge ?? '0s') === currentMinAge
    );
}

/**
 * Filter candidate tags (based on tag name).
 */
function getTagCandidates(
    container: Container,
    tags: string[],
    logContainer: any,
) {
    let filteredTags = tags;

    // Match include tag regex
    if (container.includeTags) {
        const includeTagsRegex = new RegExp(container.includeTags);
        filteredTags = filteredTags.filter((tag) => includeTagsRegex.test(tag));
    } else {
        // If no includeTags, filter out tags starting with "sha"
        filteredTags = filteredTags.filter((tag) => !tag.startsWith('sha'));
    }

    // Match exclude tag regex
    if (container.excludeTags) {
        const excludeTagsRegex = new RegExp(container.excludeTags);
        filteredTags = filteredTags.filter(
            (tag) => !excludeTagsRegex.test(tag),
        );
    }

    // Always filter out tags ending with ".sig"
    filteredTags = filteredTags.filter((tag) => !tag.endsWith('.sig'));

    // Semver image -> find higher semver tag
    if (container.image.tag.semver) {
        if (filteredTags.length === 0) {
            logContainer.warn(
                'No tags found after filtering; check you regex filters',
            );
        }

        // If user has not specified custom include regex, default to keep current prefix
        // Prefix is almost-always standardized around "must stay the same" for tags
        if (!container.includeTags) {
            const currentTag = container.image.tag.value;
            const match = currentTag.match(/^(.*?)(\d+.*)$/);
            const currentPrefix = match ? match[1] : '';

            if (currentPrefix) {
                // Retain only tags with the same non-empty prefix
                filteredTags = filteredTags.filter((tag) =>
                    tag.startsWith(currentPrefix),
                );
            } else {
                // Retain only tags that start with a number (no prefix)
                filteredTags = filteredTags.filter((tag) => /^\d/.test(tag));
            }

            // Ensure we throw good errors when we've prefix-related issues
            if (filteredTags.length === 0) {
                if (currentPrefix) {
                    logContainer.warn(
                        "No tags found with existing prefix: '" +
                            currentPrefix +
                            "'; check your regex filters",
                    );
                } else {
                    logContainer.warn(
                        'No tags found starting with a number (no prefix); check your regex filters',
                    );
                }
            }
        }

        // Keep semver only
        filteredTags = filteredTags.filter(
            (tag) =>
                parseSemver(transformTag(container.transformTags, tag)) !==
                null,
        );

        if (!container.includePrerelease) {
            filteredTags = filteredTags.filter(
                (tag) => !isPrereleaseTag(container.transformTags, tag),
            );
        }

        // Remove prefix and suffix (keep only digits and dots)
        const numericPart = container.image.tag.value.match(/(\d+(\.\d+)*)/);

        if (numericPart) {
            const referenceGroups = numericPart[0].split('.').length;

            filteredTags = filteredTags.filter((tag) => {
                const tagNumericPart = tag.match(/(\d+(\.\d+)*)/);
                if (!tagNumericPart) return false; // skip tags without numeric part
                const tagGroups = tagNumericPart[0].split('.').length;

                // Keep only tags with the same number of numeric segments
                return tagGroups === referenceGroups;
            });
        }

        // Keep only greater semver
        filteredTags = filteredTags.filter((tag) =>
            isGreaterSemver(
                transformTag(container.transformTags, tag),
                transformTag(
                    container.transformTags,
                    container.image.tag.value,
                ),
            ),
        );

        // Apply semver sort desc
        filteredTags.sort((t1, t2) => {
            const greater = isGreaterSemver(
                transformTag(container.transformTags, t2),
                transformTag(container.transformTags, t1),
            );
            return greater ? 1 : -1;
        });
    } else {
        // Non semver tag -> do not propose any other registry tag
        filteredTags = [];
    }
    return filteredTags;
}

function hasUpdateCandidate(container: Container, result: any) {
    if (
        container.image.digest.watch &&
        container.image.digest.value !== undefined &&
        result.digest !== undefined
    ) {
        return container.image.digest.value !== result.digest;
    }

    const localTag = transformTag(
        container.transformTags,
        container.image.tag.value,
    );
    const remoteTag = transformTag(container.transformTags, result.tag);
    if (localTag !== remoteTag) {
        return true;
    }

    if (container.image.created !== undefined && result.created !== undefined) {
        return (
            new Date(container.image.created).getTime() !==
            new Date(result.created).getTime()
        );
    }
    return false;
}

function getContainerPlatform(container: Container) {
    return `${container.image.os}/${container.image.architecture}${
        container.image.variant ? `/${container.image.variant}` : ''
    }`;
}

function getErrorMessage(error: any) {
    return error?.message ?? String(error);
}

/**
 * Get the Docker Registry by name.
 */
function getRegistry(registryName: string) {
    const registryToReturn = getRegistries()[registryName];
    if (!registryToReturn) {
        throw new Error(`Unsupported Registry ${registryName}`);
    }
    return registryToReturn;
}

/**
 * Get old containers to prune.
 */
function getOldContainers(
    newContainers: Container[],
    containersFromTheStore: Container[],
) {
    if (!containersFromTheStore || !newContainers) {
        return [];
    }
    return containersFromTheStore.filter((containerFromStore) => {
        const isContainerStillToWatch = newContainers.find(
            (newContainer) => newContainer.id === containerFromStore.id,
        );
        return isContainerStillToWatch === undefined;
    });
}

/**
 * Prune old containers from the store.
 */
function pruneOldContainers(
    newContainers: Container[],
    containersFromTheStore: Container[],
) {
    const containersToRemove = getOldContainers(
        newContainers,
        containersFromTheStore,
    );
    containersToRemove.forEach((containerToRemove) => {
        storeContainer.deleteContainer(containerToRemove.id);
    });
}

function getContainerName(container: any) {
    let containerName = '';
    const names = container.Names;
    if (names && names.length > 0) {
        [containerName] = names;
    }
    // Strip ugly forward slash
    containerName = containerName.replace(/\//, '');
    return containerName;
}

/**
 * Get image repo digest.
 */
function getRepoDigest(containerImage: any) {
    if (
        !containerImage.RepoDigests ||
        containerImage.RepoDigests.length === 0
    ) {
        return undefined;
    }
    const fullDigest = containerImage.RepoDigests[0];
    const digestSplit = fullDigest.split('@');
    return digestSplit[1];
}

/**
 * Return true if container must be watched.
 * @param wudWatchLabelValue the value of the wud.watch label
 * @param watchByDefault true if containers must be watched by default
 */
function isContainerToWatch(
    wudWatchLabelValue: string,
    watchByDefault: boolean,
) {
    return parseBooleanLabel(wudWatchLabelValue) ?? watchByDefault;
}

/**
 * Docker Watcher Component.
 */
export class Docker extends Watcher {
    public configuration: DockerWatcherConfiguration =
        {} as DockerWatcherConfiguration;
    public dockerApi: Dockerode;
    public watchCron: ScheduledTask;
    public watchCronTimeout: any;
    public watchCronDebounced: any;
    public listenDockerEventsTimeout: any;
    public dockerEventsStream: any;

    getConfigurationSchema() {
        return joi.object().keys({
            socket: this.joi.string().default('/var/run/docker.sock'),
            host: this.joi.string(),
            port: this.joi.number().port().default(2375),
            cafile: this.joi.string(),
            certfile: this.joi.string(),
            keyfile: this.joi.string(),
            cron: joi.string().cron().default('0 20 * * *'),
            jitter: this.joi.number().integer().min(0).default(60000),
            watchbydefault: this.joi.boolean().default(true),
            watchall: this.joi.boolean().default(false),
            includeprerelease: this.joi.boolean().default(false),
            watchdigest: this.joi.any(),
            minage: this.joi
                .string()
                .custom((value, helpers) => {
                    const normalizedValue = normalizeDuration(value);
                    if (!isDuration(normalizedValue)) {
                        return helpers.error('any.invalid');
                    }
                    return normalizedValue;
                })
                .default('0s'),
            watchevents: this.joi.boolean().default(true),
            watchatstart: this.joi.boolean().default(true),
        });
    }

    /**
     * Init the Watcher.
     */
    async init() {
        this.initWatcher();
        if (this.configuration.watchdigest !== undefined) {
            this.log.warn(
                "WUD_WATCHER_{watcher_name}_WATCHDIGEST environment variable is deprecated and won't be supported in upcoming versions",
            );
        }
        this.log.info(`Cron scheduled (${this.configuration.cron})`);
        this.watchCron = cron.schedule(
            this.configuration.cron,
            () => {
                if (this.watchCron) {
                    this.watchFromCron();
                }
            },
            { maxRandomDelay: this.configuration.jitter },
        );

        // Force watchatstart value based on the state store (empty or not)
        this.configuration.watchatstart =
            storeContainer.getContainers().length === 0;

        // watch at startup if enabled (after all components have been registered)
        if (this.configuration.watchatstart) {
            this.watchCronTimeout = setTimeout(() => {
                if (this.watchCronTimeout) {
                    this.watchFromCron();
                }
            }, START_WATCHER_DELAY_MS);
        }

        // listen to docker events
        if (this.configuration.watchevents) {
            this.watchCronDebounced = debounce(() => {
                if (this.watchCronDebounced) {
                    this.watchFromCron();
                }
            }, DEBOUNCED_WATCH_CRON_MS);
            this.listenDockerEventsTimeout = setTimeout(() => {
                if (this.listenDockerEventsTimeout) {
                    this.listenDockerEvents();
                }
            }, START_WATCHER_DELAY_MS);
        }
    }

    initWatcher() {
        const options: Dockerode.DockerOptions = {};
        if (this.configuration.host) {
            options.host = this.configuration.host;
            options.port = this.configuration.port;
            if (this.configuration.cafile) {
                options.ca = fs.readFileSync(this.configuration.cafile);
            }
            if (this.configuration.certfile) {
                options.cert = fs.readFileSync(this.configuration.certfile);
            }
            if (this.configuration.keyfile) {
                options.key = fs.readFileSync(this.configuration.keyfile);
            }
        } else {
            options.socketPath = this.configuration.socket;
        }
        this.dockerApi = new Dockerode(options);
    }

    /**
     * Deregister the component.
     */
    deregisterComponent() {
        // Delete properties first so callbacks can check if they should proceed
        const watchCron = this.watchCron;
        const watchCronTimeout = this.watchCronTimeout;
        const listenDockerEventsTimeout = this.listenDockerEventsTimeout;
        const dockerEventsStream = this.dockerEventsStream;

        delete this.watchCron;
        delete this.watchCronTimeout;
        delete this.listenDockerEventsTimeout;
        delete this.watchCronDebounced;
        delete this.dockerEventsStream;

        // Now actually stop/clear the operations
        if (watchCron) {
            watchCron.stop();
        }
        if (watchCronTimeout) {
            clearTimeout(watchCronTimeout);
        }
        if (listenDockerEventsTimeout) {
            clearTimeout(listenDockerEventsTimeout);
        }
        if (dockerEventsStream) {
            if (typeof dockerEventsStream.destroy === 'function') {
                dockerEventsStream.destroy();
            }
            if (typeof dockerEventsStream.removeAllListeners === 'function') {
                dockerEventsStream.removeAllListeners();
            }
        }
    }

    /**
     * Listen and react to docker events.
     */
    async listenDockerEvents() {
        if (!this.log || typeof this.log.info !== 'function') {
            return;
        }
        this.log.info('Listening to docker events');
        const options: Dockerode.GetEventsOptions = {
            filters: {
                type: ['container'],
                event: [
                    'create',
                    'destroy',
                    'start',
                    'stop',
                    'pause',
                    'unpause',
                    'die',
                    'update',
                ],
            },
        };
        this.dockerApi.getEvents(options, (err, stream) => {
            if (err) {
                if (this.log && typeof this.log.warn === 'function') {
                    this.log.warn(
                        `Unable to listen to Docker events [${err.message}]`,
                    );
                    this.log.debug(err);
                }
            } else {
                this.dockerEventsStream = stream;
                let chunks: Buffer[] = [];
                const collectChunks = (chunk: Buffer) => {
                    chunks.push(chunk);
                    if (chunk.toString().endsWith('\n')) {
                        const dockerEventChunk = Buffer.concat(chunks);
                        this.onDockerEvent(dockerEventChunk);
                        chunks = [];
                    }
                };
                stream.on('data', collectChunks);
            }
        });
    }

    /**
     * Process a docker event.
     */
    async onDockerEvent(dockerEventChunk: any) {
        let dockerEvent;
        try {
            dockerEvent = JSON.parse(dockerEventChunk.toString());
        } catch (e) {
            this.log.warn(
                `Unable to parse Docker event (${e.message}): ${dockerEventChunk.toString()}`,
            );
            return;
        }
        const action = dockerEvent.Action;
        const containerId = dockerEvent.id;

        // If the container was created or destroyed => perform a watch
        if (action === 'destroy' || action === 'create') {
            await this.watchCronDebounced();
        } else {
            // Update container state in db if so
            try {
                const container =
                    await this.dockerApi.getContainer(containerId);
                const containerInspect = await container.inspect();
                const newStatus = containerInspect.State.Status;
                const containerFound = storeContainer.getContainer(containerId);
                if (containerFound) {
                    // Child logger for the container to process
                    const logContainer = this.log.child({
                        component: fullName(containerFound),
                    });
                    const oldStatus = containerFound.status;
                    containerFound.status = newStatus;
                    if (oldStatus !== newStatus) {
                        storeContainer.updateContainer(containerFound);
                        logContainer.info(
                            `Status changed from ${oldStatus} to ${newStatus}`,
                        );
                    }
                }
            } catch (e: any) {
                this.log.debug(
                    `Unable to get container details for container id=[${containerId}] (${e.message})`,
                );
            }
        }
    }

    /**
     * Watch containers (called by cron scheduled tasks).
     */
    async watchFromCron() {
        if (!this.log || typeof this.log.info !== 'function') {
            return [];
        }
        this.log.info(`Cron started (${this.configuration.cron})`);

        // Get container reports
        const containerReports = await this.watch();

        // Count container reports
        const containerReportsCount = containerReports.length;

        // Count container available updates
        const containerUpdatesCount = containerReports.filter(
            (containerReport) => containerReport.container.updateAvailable,
        ).length;

        // Count container errors
        const containerErrorsCount = containerReports.filter(
            (containerReport) => containerReport.container.error !== undefined,
        ).length;

        const stats = `${containerReportsCount} containers watched, ${containerErrorsCount} errors, ${containerUpdatesCount} available updates`;
        if (this.log && typeof this.log.info === 'function') {
            this.log.info(`Cron finished (${stats})`);
        }
        return containerReports;
    }

    /**
     * Watch main method.
     */
    async watch() {
        let containers: Container[] = [];

        // Dispatch event to notify start watching
        event.emitWatcherStart(this);

        // List images to watch
        try {
            containers = await this.getContainers();
        } catch (e: any) {
            this.log.warn(
                `Error when trying to get the list of the containers to watch (${e.message})`,
            );
        }
        try {
            const containerReports = await Promise.all(
                containers.map((container) => this.watchContainer(container)),
            );
            event.emitContainerReports(containerReports);
            return containerReports;
        } catch (e: any) {
            this.log.warn(
                `Error when processing some containers (${e.message})`,
            );
            return [];
        } finally {
            // Dispatch event to notify stop watching
            event.emitWatcherStop(this);
        }
    }

    /**
     * Watch a Container.
     */
    async watchContainer(container: Container) {
        // Child logger for the container to process
        const logContainer = this.log.child({ component: fullName(container) });
        const containerWithResult = container;

        // Reset previous error if so
        delete containerWithResult.error;
        delete containerWithResult.updatePendingReason;
        delete containerWithResult.updatePendingUntil;
        containerWithResult.results = [];
        containerWithResult.updatePending = false;
        logContainer.debug('Start watching');

        try {
            containerWithResult.result = await this.findNewVersion(
                container,
                logContainer,
            );
        } catch (e: any) {
            logContainer.warn(
                `Error when finding new version processing (${e.message}) for container ${container.name}`,
            );
            logContainer.debug(e);
            containerWithResult.error = {
                message: e.message,
            };
        }

        const containerReport =
            this.mapContainerToContainerReport(containerWithResult);
        event.emitContainerReport(containerReport);
        return containerReport;
    }

    /**
     * Get all containers to watch.
     */
    async getContainers(): Promise<Container[]> {
        const listContainersOptions: Dockerode.ContainerListOptions = {};
        if (this.configuration.watchall) {
            listContainersOptions.all = true;
        }
        const containers = await this.dockerApi.listContainers(
            listContainersOptions,
        );

        // Filter on containers to watch
        const filteredContainers = containers.filter((container) =>
            isContainerToWatch(
                container.Labels[wudWatch],
                this.configuration.watchbydefault,
            ),
        );
        const containerPromises = filteredContainers.map((container) =>
            this.addImageDetailsToContainer(
                container,
                container.Labels[wudTagInclude],
                container.Labels[wudTagExclude],
                container.Labels[wudTagIncludePrerelease],
                container.Labels[wudTagTransform],
                container.Labels[wudWatchMinAge],
                container.Labels[wudLinkTemplate],
                container.Labels[wudDisplayName],
                container.Labels[wudDisplayIcon],
                container.Labels[wudTriggerInclude],
                container.Labels[wudTriggerExclude],
            ).catch((e) => {
                this.log.warn(
                    `Failed to fetch image detail for container ${container.Id}: ${e.message} - ${e.stack}`,
                );
                return e;
            }),
        );
        const containersWithImage = (
            await Promise.all(containerPromises)
        ).filter((result) => !(result instanceof Error));

        // Return containers to process
        const containersToReturn = containersWithImage.filter(
            (imagePromise) => imagePromise !== undefined,
        );

        // Prune old containers from the store
        try {
            const containersFromTheStore = storeContainer.getContainers({
                watcher: this.name,
            });
            pruneOldContainers(containersToReturn, containersFromTheStore);
        } catch (e: any) {
            this.log.warn(
                `Error when trying to prune the old containers (${e.message})`,
            );
        }
        this.updatePrometheusGauge(containersToReturn);

        return containersToReturn;
    }

    private updatePrometheusGauge(containersToReturn: any[]) {
        const containerGauge = getWatchContainerGauge();
        if (containerGauge) {
            getWatchContainerGauge().set(
                {
                    type: this.type,
                    name: this.name,
                },
                containersToReturn.length,
            );
        }
    }

    private async applyMinimumAge(
        container: Container,
        result: any,
        registryProvider: any,
        logContainer: Logger,
    ) {
        delete container.updatePendingReason;
        delete container.updatePendingUntil;
        container.updatePending = false;

        const minAgeMs = parseDurationMs(container.minAge ?? '0s');
        if (minAgeMs === 0 || !hasUpdateCandidate(container, result)) {
            return;
        }

        await this.addRemoteCreatedToResult(
            container,
            result,
            registryProvider,
            logContainer,
        );
        if (!result.created) {
            logContainer.warn(
                `Unable to parse remote image creation date for ${container.image.name}:${result.tag}; minimum age cannot be applied (${result.created})`,
            );
            return;
        }

        const pendingUntil = this.getPendingUntil(result, minAgeMs);
        if (!pendingUntil) {
            return;
        }

        container.updatePending = true;
        container.updatePendingReason = 'minimum-age';
        container.updatePendingUntil = pendingUntil.toISOString();
        logContainer.info(
            `Update candidate ${container.image.name}:${result.tag} is pending until ${container.updatePendingUntil} because of minimum age ${container.minAge}`,
        );
    }

    private async addRemoteCreatedToResult(
        container: Container,
        result: any,
        registryProvider: any,
        logContainer: Logger,
    ) {
        if (result.created) {
            return;
        }
        try {
            const imageToGetMetadataFrom = JSON.parse(
                JSON.stringify(container.image),
            );
            if (result.tag) {
                imageToGetMetadataFrom.tag.value = result.tag;
            }
            const remoteManifest =
                await registryProvider.getImageManifestDigest(
                    imageToGetMetadataFrom,
                    result.digest,
                );
            result.created = remoteManifest.created;
        } catch (e: any) {
            logContainer.warn(
                `Unable to determine remote image creation date for ${container.image.name}:${result.tag}; minimum age cannot be applied (${e.message})`,
            );
        }
    }

    private getPendingUntil(result: any, minAgeMs: number) {
        const createdTime = new Date(result.created).getTime();
        if (Number.isNaN(createdTime)) {
            return undefined;
        }

        const pendingUntil = new Date(createdTime + minAgeMs);
        return pendingUntil.getTime() > Date.now() ? pendingUntil : undefined;
    }

    private async getTagCandidateResult(
        container: Container,
        tagCandidate: string,
        registryProvider: any,
        logContainer: Logger,
        tagCandidateManifests: Map<string, RegistryManifest>,
    ) {
        const result: any = { tag: tagCandidate };
        try {
            const imageToGetMetadataFrom = JSON.parse(
                JSON.stringify(container.image),
            );
            imageToGetMetadataFrom.tag.value = tagCandidate;

            const remoteManifest =
                await registryProvider.getImageManifestDigest(
                    imageToGetMetadataFrom,
                );
            result.digest = remoteManifest.digest;
            result.created = remoteManifest.created;
            tagCandidateManifests.set(tagCandidate, remoteManifest);
        } catch (e: any) {
            logContainer.warn(
                `Skipping update candidate ${container.image.name}:${tagCandidate} for platform ${getContainerPlatform(container)} because its manifest could not be resolved (${getErrorMessage(e)})`,
            );
            return undefined;
        }

        return result;
    }

    private async getTagCandidateResults(
        container: Container,
        tagsCandidates: string[],
        registryProvider: any,
        logContainer: Logger,
    ) {
        const tagCandidateManifests = new Map<string, RegistryManifest>();
        if (!tagsCandidates || tagsCandidates.length === 0) {
            return { results: [], tagCandidateManifests };
        }

        const minAgeMs = parseDurationMs(container.minAge ?? '0s');
        const results: any[] = [];
        for (const tagCandidate of tagsCandidates) {
            const result = await this.getTagCandidateResult(
                container,
                tagCandidate,
                registryProvider,
                logContainer,
                tagCandidateManifests,
            );
            if (!result) {
                continue;
            }

            if (minAgeMs === 0) {
                result.updatePending = false;
                results.push(result);
                continue;
            }

            const createdTime = new Date(result.created).getTime();
            if (Number.isNaN(createdTime)) {
                logContainer.warn(
                    `Unable to parse remote image creation date for ${container.image.name}:${result.tag}; minimum age cannot be applied (${result.created})`,
                );
                result.updatePending = false;
                results.push(result);
                continue;
            }

            const pendingUntil = this.getPendingUntil(result, minAgeMs);
            result.updatePending = pendingUntil !== undefined;
            if (pendingUntil) {
                result.updatePendingReason = 'minimum-age';
                result.updatePendingUntil = pendingUntil.toISOString();
            }
            results.push(result);
        }
        return { results, tagCandidateManifests };
    }

    private getSelectedTagCandidateResult(
        container: Container,
        tagCandidateResults: any[],
        logContainer: Logger,
    ) {
        delete container.updatePendingReason;
        delete container.updatePendingUntil;
        container.updatePending = false;

        if (!tagCandidateResults || tagCandidateResults.length === 0) {
            return undefined;
        }

        const availableResult = tagCandidateResults.find(
            (result) => !result.updatePending,
        );
        if (availableResult) {
            return availableResult;
        }

        const newestPendingResult = tagCandidateResults[0];
        container.updatePending = true;
        container.updatePendingReason = newestPendingResult.updatePendingReason;
        container.updatePendingUntil = newestPendingResult.updatePendingUntil;
        logContainer.info(
            `Update candidate ${container.image.name}:${newestPendingResult.tag} is pending until ${container.updatePendingUntil} because of minimum age ${container.minAge}`,
        );
        return newestPendingResult;
    }

    private applyManualResultSelection(
        container: Container,
        result: any,
        logContainer: Logger,
    ) {
        const resultSelection = container.resultSelection;
        if (resultSelection?.mode !== 'manual') {
            return;
        }

        const newestCandidate = container.results[0];
        const baselineReference =
            getSelectionBaselineReference(resultSelection);
        if (
            newestCandidate &&
            !candidateMatchesReference(newestCandidate, baselineReference)
        ) {
            container.resultSelection = { mode: 'auto' };
            logContainer.info(
                `Manual result selection reset because a newer candidate was found for ${container.image.name}`,
            );
            return;
        }

        const selectionReference = getSelectionReference(resultSelection);
        const selectedCandidate = container.results.find((candidate) =>
            candidateMatchesReference(candidate, selectionReference),
        );
        if (!selectedCandidate) {
            container.resultSelection = { mode: 'auto' };
            logContainer.info(
                `Manual result selection reset because the selected candidate was not found for ${container.image.name}`,
            );
            return;
        }

        applyResultCandidate(container, selectedCandidate);
        result.tag = container.result?.tag;
        if (container.result?.digest !== undefined) {
            result.digest = container.result.digest;
        } else {
            delete result.digest;
        }
        if (container.result?.created !== undefined) {
            result.created = container.result.created;
        } else {
            delete result.created;
        }
    }

    /**
     * Find new version for a Container.
     */

    async findNewVersion(container: Container, logContainer: Logger) {
        const registryProvider = getRegistry(container.image.registry.name);
        const result: any = { tag: container.image.tag.value };
        if (!registryProvider) {
            logContainer.error(
                `Unsupported registry (${container.image.registry.name})`,
            );
            return result;
        } else {
            const watchDigest =
                !container.image.tag.semver &&
                registryProvider.shouldWatchDigest(
                    container.labels?.[wudWatchDigest],
                    container.image.name,
                );

            if (!container.image.tag.semver && !watchDigest) {
                this.log.warn(
                    `Image ${container.image.name} is not a semver and digest watching is disabled so wud won't report any update. Please review the configuration to enable digest watching for this container or exclude this container from being watched`,
                );
            }

            // Get all available tags for semver update checks
            const tags = container.image.tag.semver
                ? await registryProvider.getTags(container.image)
                : [];

            // Get candidate tags (based on tag name)
            const tagsCandidates = getTagCandidates(
                container,
                tags,
                logContainer,
            );

            const { results: tagCandidateResults, tagCandidateManifests } =
                await this.getTagCandidateResults(
                    container,
                    tagsCandidates,
                    registryProvider,
                    logContainer,
                );
            container.results = tagCandidateResults;

            const tagCandidateResult = this.getSelectedTagCandidateResult(
                container,
                tagCandidateResults,
                logContainer,
            );
            if (tagCandidateResult) {
                result.tag = tagCandidateResult.tag;
                result.digest = tagCandidateResult.digest;
                result.created = tagCandidateResult.created;
            }

            // Must watch digest? => Find local/remote digests on registry
            if (watchDigest && container.image.digest.repo) {
                // If we have a tag candidate BUT we also watch digest
                // (case where local=`mongo:8` and remote=`mongo:8.0.0`),
                // Then get the digest of the tag candidate
                // Else get the digest of the same tag as the local one
                const imageToGetDigestFrom = JSON.parse(
                    JSON.stringify(container.image),
                );
                imageToGetDigestFrom.tag.value = result.tag;

                const remoteDigest =
                    tagCandidateManifests.get(result.tag) ??
                    (await registryProvider.getImageManifestDigest(
                        imageToGetDigestFrom,
                    ));

                result.digest = remoteDigest.digest;
                result.created = result.created ?? remoteDigest.created;

                const selectedResult = container.results.find(
                    (candidate) => candidate.tag === result.tag,
                );
                if (selectedResult) {
                    selectedResult.digest = result.digest;
                    selectedResult.created =
                        selectedResult.created ?? result.created;
                }

                if (remoteDigest.version === 2) {
                    // Regular v2 manifest => Get manifest digest

                    const digestV2 =
                        await registryProvider.getImageManifestDigest(
                            imageToGetDigestFrom,
                            container.image.digest.repo,
                        );
                    container.image.digest.value = digestV2.digest;
                } else {
                    // Legacy v1 image => take Image digest as reference for comparison.
                    // Config.Image is empty on most modern images (deprecated since
                    // Docker moved to content-addressable image storage), so fall back
                    // to the local image Id, which is the config digest Docker itself
                    // uses to identify this image.
                    const image = await this.dockerApi
                        .getImage(container.image.id)
                        .inspect();
                    container.image.digest.value =
                        image.Config.Image || image.Id;
                }
            }

            if (!tagCandidateResult) {
                await this.applyMinimumAge(
                    container,
                    result,
                    registryProvider,
                    logContainer,
                );
                if (hasUpdateCandidate(container, result)) {
                    container.results = [
                        {
                            digest: result.digest,
                            created: result.created,
                            updatePending: container.updatePending,
                            updatePendingReason: container.updatePendingReason,
                            updatePendingUntil: container.updatePendingUntil,
                        },
                    ];
                }
            }

            this.applyManualResultSelection(container, result, logContainer);
        }
        return result;
    }

    /**
     * Add image detail to Container.
     */
    async addImageDetailsToContainer(
        container: any,
        includeTags: string,
        excludeTags: string,
        includePrereleaseLabel: string,
        transformTags: string,
        minAgeLabel: string,
        linkTemplate: string,
        displayName: string,
        displayIcon: string,
        triggerInclude: string,
        triggerExclude: string,
    ) {
        const containerId = container.Id;

        // Is container already in store? just return it :)
        const containerInStore = storeContainer.getContainer(containerId);
        if (
            containerInStore !== undefined &&
            containerInStore.error === undefined &&
            isCachedContainerValid(
                containerInStore,
                container.Labels,
                this.configuration.includeprerelease,
                this.configuration.minage,
            )
        ) {
            this.log.debug(`Container ${containerInStore.id} already in store`);
            return containerInStore;
        }

        // Get container image details
        const image = await this.dockerApi.getImage(container.Image).inspect();

        // Get useful properties
        const containerName = getContainerName(container);
        if (
            displayIcon &&
            (displayIcon.startsWith('hl:') || displayIcon.startsWith('hl-'))
        ) {
            this.log.warn(
                `Container ${containerName} uses deprecated icon prefix '${displayIcon}'. Please migrate to 'selfhst:' (e.g. 'selfhst:${displayIcon.replace(/^hl[:-]/, '')}') or any standard Iconify format.`,
            );
        }
        const status = container.State;
        const architecture = image.Architecture;
        const os = image.Os;
        const variant = image.Variant;
        const created = image.Created;
        const repoDigest = getRepoDigest(image);
        const imageId = image.Id;

        // Parse image to get registry, organization...
        let imageNameToParse = container.Image;
        if (imageNameToParse.includes('sha256:')) {
            if (!image.RepoTags || image.RepoTags.length === 0) {
                this.log.warn(
                    `Cannot get a reliable tag for this image [${imageNameToParse}} for container ${containerName}`,
                );
                return Promise.resolve();
            }
            // Get the first repo tag (better than nothing ;)
            [imageNameToParse] = image.RepoTags;
        }
        const parsedImage = parseDockerImageName(imageNameToParse);
        const tagName = parsedImage.tag ? parsedImage.tag : 'latest';

        const registryProvider = this.getRegistryProvider(
            parsedImage.domain,
            parsedImage.path,
            container.Labels?.[wudRegistry],
        );

        if (!registryProvider) {
            this.log.warn(
                `${container.Image} - ${parsedImage.domain} - No Registry Provider found`,
            );
            return;
        }
        const parsedTag = parseSemver(transformTag(transformTags, tagName));
        const isSemver = parsedTag !== null && parsedTag !== undefined;
        const watchDigest =
            !isSemver &&
            registryProvider.shouldWatchDigest(
                container.Labels[wudWatchDigest],
                parsedImage.path,
            );

        const includePrerelease =
            parseBooleanLabel(includePrereleaseLabel) ??
            this.configuration.includeprerelease;
        const minAge = getMinAge(minAgeLabel, this.configuration.minage);
        return this.normalizeContainer({
            id: containerId,
            name: containerName,
            status,
            watcher: this.name,
            includeTags,
            excludeTags,
            includePrerelease,
            transformTags,
            minAge,
            linkTemplate,
            displayName,
            displayIcon,
            triggerInclude,
            triggerExclude,
            image: {
                id: imageId,
                registry: {
                    name: 'unknown', // Will be overwritten by normalizeContainer
                    url: parsedImage.domain,
                },
                name: parsedImage.path,
                tag: {
                    value: tagName,
                    semver: isSemver,
                },
                digest: {
                    watch: watchDigest,
                    repo: repoDigest,
                },
                architecture,
                os,
                variant,
                created,
            },
            labels: container.Labels,
            result: containerInStore?.result ?? {
                tag: tagName,
            },
            results: [],
            updateAvailable: false,
            updatePending: false,
            updateKind: { kind: 'unknown' },
        } as Container);
    }

    /**
     * Process a Container with result and map to a containerReport.
     */
    mapContainerToContainerReport(containerWithResult: Container) {
        const logContainer = this.log.child({
            component: fullName(containerWithResult),
        });
        const containerReport = {
            container: containerWithResult,
            changed: false,
        };

        // Find container in db & compare
        const containerInDb = storeContainer.getContainer(
            containerWithResult.id,
        );

        // Not found in DB? => Save it
        if (!containerInDb) {
            logContainer.debug('Container watched for the first time');
            containerReport.container =
                storeContainer.insertContainer(containerWithResult);
            containerReport.changed = true;

            // Found in DB? => update it
        } else {
            containerReport.container =
                storeContainer.updateContainer(containerWithResult);
            containerReport.changed =
                containerInDb.resultChanged(containerReport.container) &&
                containerWithResult.updateAvailable;
        }
        return containerReport;
    }

    private normalizeContainer(container: Container) {
        const containerWithNormalizedImage = container;
        const registryProvider = this.getRegistryProvider(
            container.image.registry.url,
            container.image.name,
            container.labels?.[wudRegistry],
        );
        if (!registryProvider) {
            this.log.warn(
                `${fullName(container)} - No Registry Provider found`,
            );
            containerWithNormalizedImage.image.registry.name = 'unknown';
        } else {
            containerWithNormalizedImage.image =
                registryProvider.normalizeImage(container.image);
            containerWithNormalizedImage.image.registry.name =
                registryProvider.getId();
        }
        return validateContainer(containerWithNormalizedImage);
    }

    private getRegistryProvider(
        imageUrl: string | undefined,
        imageName: string | undefined,
        registryName?: string,
    ) {
        const registries = getRegistries();
        if (registryName) {
            const registryProvider = registries[registryName.toLowerCase()];
            if (!registryProvider) {
                this.log.warn(
                    `Registry ${registryName} configured for image ${imageUrl} was not found`,
                );
                return undefined;
            }
            if (!registryProvider.match(imageUrl, imageName)) {
                this.log.warn(
                    `Registry ${registryName} configured for image ${imageUrl} does not match the image registry`,
                );
                return undefined;
            }
            return registryProvider;
        }

        return Object.values(registries).find((registry) =>
            registry.match(imageUrl, imageName),
        );
    }
}

export default Docker;
