// @ts-nocheck
import fs from 'fs/promises';
import path from 'path';
import yaml from 'yaml';
import Docker from '../docker/Docker';
import { getState } from '../../../registry';
import { getContainers } from '../../../store/container';

/**
 * Update a Docker compose stack with an updated one.
 */
class Dockercompose extends Docker {
    private composeServiceLabel = 'com.docker.compose.service';

    /**
     * Match a watched container back to its compose service.
     * Prefer the compose service label, then container_name, and only
     * fall back to image matching for older or less explicit setups.
     */
    getComposeServiceKey(compose, container) {
        const composeService = (container.labels || {})[
            this.composeServiceLabel
        ];
        if (composeService && compose.services?.[composeService]) {
            return composeService;
        }

        const serviceKeyFromContainerName = Object.keys(
            compose.services || {},
        ).find(
            (serviceKey) =>
                compose.services?.[serviceKey]?.container_name ===
                container.name,
        );
        if (serviceKeyFromContainerName) {
            return serviceKeyFromContainerName;
        }

        const registry = getState().registry[container.image.registry.name];
        const currentImage = registry.getImageFullName(
            container.image,
            container.image.tag.value,
        );

        return Object.keys(compose.services || {}).find((serviceKey) => {
            const serviceImage = compose.services?.[serviceKey]?.image;
            const images = Array.isArray(serviceImage)
                ? serviceImage
                : [serviceImage];
            return images.includes(currentImage);
        });
    }

    /**
     * Get the Trigger configuration schema.
     * @returns {*}
     */
    getConfigurationSchema() {
        const schemaDocker = super.getConfigurationSchema();
        return schemaDocker.append({
            // Make file optional since we now support per-container compose files
            file: this.joi.string().optional(),
            backup: this.joi.boolean().default(false),
            // Add configuration for the label name to look for
            composeFileLabel: this.joi.string().default('wud.compose.file'),
        });
    }

    async initTrigger() {
        // Force mode=batch to avoid docker-compose concurrent operations
        this.configuration.mode = 'batch';

        // Check default docker-compose file exists if specified
        if (this.configuration.file) {
            try {
                await fs.access(this.configuration.file);
            } catch (e) {
                this.log.error(
                    `The default file ${this.configuration.file} does not exist`,
                );
                throw e;
            }
        }
    }

    /**
     * Get the compose file path for a specific container.
     * First checks for a label, then falls back to default configuration.
     * @param container
     * @returns {string|null}
     */
    getComposeFileForContainer(container) {
        // Check if container has a custom wud compose file label
        const composeFileLabel = this.configuration.composeFileLabel;
        if (container.labels && container.labels[composeFileLabel]) {
            const labelValue = container.labels[composeFileLabel];
            // Convert relative paths to absolute paths
            return path.isAbsolute(labelValue)
                ? labelValue
                : path.resolve(labelValue);
        }

        // Prefer an explicitly configured trigger-level compose file
        if (this.configuration.file) {
            return this.configuration.file;
        }

        // Fall back to Docker Compose's automatically generated label
        if (
            container.labels &&
            container.labels['com.docker.compose.project.config_files']
        ) {
            return container.labels['com.docker.compose.project.config_files'];
        }

        return null;
    }

    /**
     * Update the container.
     * @param container the container
     * @returns {Promise<void>}
     */
    async trigger(container) {
        return this.triggerBatch([container]);
    }

    /**
     * Update the docker-compose stack.
     * @param containers the containers
     * @returns {Promise<void>}
     */
    async triggerBatch(containers) {
        // Group containers by their compose file
        const containersByComposeFile = new Map();

        for (const container of containers) {
            // Filter on containers running on local host
            const watcher = this.getWatcher(container);
            if (watcher.dockerApi.modem.socketPath === '') {
                this.log.warn(
                    `Cannot update container ${container.name} because not running on local host`,
                );
                continue;
            }

            const composeFile = this.getComposeFileForContainer(container);
            if (!composeFile) {
                this.log.warn(
                    `No compose file found for container ${container.name} (no label '${this.configuration.composeFileLabel}' and no default file configured)`,
                );
                continue;
            }

            // Check if compose file exists
            try {
                await fs.access(composeFile);
            } catch (e) {
                this.log.warn(
                    `Compose file ${composeFile} for container ${container.name} does not exist`,
                );
                continue;
            }

            if (!containersByComposeFile.has(composeFile)) {
                containersByComposeFile.set(composeFile, []);
            }
            containersByComposeFile.get(composeFile).push(container);
        }

        // Process each compose file group
        for (const [composeFile, containersInFile] of containersByComposeFile) {
            await this.processComposeFile(composeFile, containersInFile);
        }
    }

    /**
     * Process a specific compose file with its associated containers.
     * @param composeFile
     * @param containers
     * @returns {Promise<void>}
     */
    async processComposeFile(composeFile, containers) {
        this.log.info(`Processing compose file: ${composeFile}`);

        const compose = await this.getComposeFileAsObject(composeFile);

        // Filter containers that belong to this compose file
        const containersFiltered = containers.filter(
            (container) =>
                this.getComposeServiceKey(compose, container) !== undefined,
        );

        if (containersFiltered.length === 0) {
            this.log.warn(`No containers found in compose file ${composeFile}`);
            return;
        }

        // Expand the manual trigger to sibling watched services in the same
        // compose file when they share the same declared image.
        const containersToUpdate = new Map(
            containersFiltered.map((container) => [
                container.id || `${container.watcher}:${container.name}`,
                container,
            ]),
        );
        const siblingServiceKeys = new Set();

        containersFiltered.forEach((container) => {
            const serviceKey = this.getComposeServiceKey(compose, container);
            if (!serviceKey) {
                return;
            }

            const serviceImage = compose.services?.[serviceKey]?.image;
            Object.keys(compose.services || {}).forEach(
                (candidateServiceKey) => {
                    if (
                        compose.services?.[candidateServiceKey]?.image ===
                        serviceImage
                    ) {
                        siblingServiceKeys.add(candidateServiceKey);
                    }
                },
            );
        });

        getContainers({})
            .filter(
                (candidateContainer) =>
                    this.getComposeFileForContainer(candidateContainer) ===
                    composeFile,
            )
            .forEach((candidateContainer) => {
                const serviceKey = this.getComposeServiceKey(
                    compose,
                    candidateContainer,
                );
                if (serviceKey && siblingServiceKeys.has(serviceKey)) {
                    containersToUpdate.set(
                        candidateContainer.id ||
                            `${candidateContainer.watcher}:${candidateContainer.name}`,
                        candidateContainer,
                    );
                }
            });

        const containersToUpdateList = Array.from(containersToUpdate.values());
        containersToUpdateList.forEach((container) =>
            this.assertContainerNotPending(container, this.log),
        );

        // Track which services have already been mapped to avoid duplicates
        // (multiple containers can share the same image/service)
        const processedServices = new Set();

        // [{ current: '1.0.0', update: '2.0.0' }, {...}]
        const currentVersionToUpdateVersionArray = Array.from(
            new Map(
                containersToUpdateList
                    .map((container) =>
                        this.mapCurrentVersionToUpdateVersion(
                            compose,
                            container,
                            processedServices,
                        ),
                    )
                    .filter((map) => map !== undefined)
                    .map((map) => [`${map.current}|${map.update}`, map]),
            ).values(),
        );

        // Dry-run?
        if (this.configuration.dryrun) {
            this.log.info(
                `Do not replace existing docker-compose file ${composeFile} (dry-run mode enabled)`,
            );
        } else {
            // Backup docker-compose file
            if (this.configuration.backup) {
                const backupFile = `${composeFile}.back`;
                await this.backup(composeFile, backupFile);
            }

            // Read the compose file as a string
            let composeFileStr = (
                await this.getComposeFile(composeFile)
            ).toString();

            // Replace all versions
            currentVersionToUpdateVersionArray.forEach(
                ({ current, update }) => {
                    composeFileStr = composeFileStr.replaceAll(current, update);
                },
            );

            // Write docker-compose.yml file back
            await this.writeComposeFile(composeFile, composeFileStr);
        }

        // Update all containers
        // (super.notify will take care of the dry-run mode for each container as well)
        await Promise.all(
            containersToUpdateList.map((container) => super.trigger(container)),
        );
    }

    /**
     * Backup a file.
     * @param file
     * @param backupFile
     * @returns {Promise<void>}
     */
    async backup(file, backupFile) {
        try {
            this.log.debug(`Backup ${file} as ${backupFile}`);
            await fs.copyFile(file, backupFile);
        } catch (e) {
            this.log.warn(
                `Error when trying to backup file ${file} to ${backupFile} (${e.message})`,
            );
        }
    }

    /**
     * Return a map containing the image declaration
     * with the current version
     * and the image declaration with the update version.
     * @param compose
     * @param container
     * @param processedServices - Set to track which services have already been processed
     * @returns {{current, update}|undefined}
     */
    mapCurrentVersionToUpdateVersion(compose, container, processedServices) {
        // Get registry configuration
        this.log.debug(`Get ${container.image.registry.name} registry manager`);
        const registry = getState().registry[container.image.registry.name];
        const serviceKeyToUpdate = this.getComposeServiceKey(
            compose,
            container,
        );

        if (!serviceKeyToUpdate) {
            this.log.warn(
                `Could not find service for container ${container.name} in compose file`,
            );
            return undefined;
        }

        // Skip if this service has already been processed (duplicate container with same image)
        if (processedServices && processedServices.has(serviceKeyToUpdate)) {
            this.log.debug(
                `Service ${serviceKeyToUpdate} already processed for container ${container.name} (duplicate image)`,
            );
            return undefined;
        }

        // Mark this service as processed
        if (processedServices) {
            processedServices.add(serviceKeyToUpdate);
        }

        return {
            current: compose.services[serviceKeyToUpdate].image,
            update: this.getNewImageFullName(registry, container),
        };
    }

    /**
     * Write docker-compose file.
     * @param file
     * @param data
     * @returns {Promise<void>}
     */
    async writeComposeFile(file, data) {
        try {
            await fs.writeFile(file, data);
        } catch (e) {
            this.log.error(`Error when writing ${file} (${e.message})`);
            this.log.debug(e);
        }
    }

    /**
     * Read docker-compose file as a buffer.
     * @param file - Optional file path, defaults to configuration file
     * @returns {Promise<any>}
     */
    getComposeFile(file = null) {
        const filePath = file || this.configuration.file;
        try {
            return fs.readFile(filePath);
        } catch (e) {
            this.log.error(
                `Error when reading the docker-compose yaml file ${filePath} (${e.message})`,
            );
            throw e;
        }
    }

    /**
     * Read docker-compose file as an object.
     * @param file - Optional file path, defaults to configuration file
     * @returns {Promise<any>}
     */
    async getComposeFileAsObject(file = null) {
        try {
            return yaml.parse((await this.getComposeFile(file)).toString(), {
                maxAliasCount: 10000,
            });
        } catch (e) {
            const filePath = file || this.configuration.file;
            this.log.error(
                `Error when parsing the docker-compose yaml file ${filePath} (${e.message})`,
            );
            throw e;
        }
    }
}

export default Dockercompose;
