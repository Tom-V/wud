/**
 * Registry handling all components (registries, triggers, watchers).
 */
import capitalize from 'capitalize';
import fs from 'fs';
import path from 'path';
import logger from '../log';
const log = logger.child({ component: 'registry' });
import {
    getWatcherConfigurations,
    getTriggerConfigurations,
    getRegistryConfigurations,
    getAuthenticationConfigurations,
} from '../configuration';
import Component, { ComponentConfiguration } from './Component';
import Trigger from '../triggers/providers/Trigger';
import Watcher from '../watchers/Watcher';
import Registry from '../registries/Registry';
import { onConfigFileChange } from '../configuration';
import Authentication from '../authentications/providers/Authentication';

export interface RegistryState {
    trigger: Record<string, Trigger>;
    watcher: Record<string, Watcher>;
    registry: Record<string, Registry>;
    authentication: Record<string, Authentication>;
}

type ComponentKind = keyof RegistryState;

/**
 * Registry state.
 */
const state: RegistryState = {
    trigger: {},
    watcher: {},
    registry: {},
    authentication: {},
};

const RELOAD_DEBOUNCE_MS = 1000;
let reloadDebounceTimeout: NodeJS.Timeout | undefined;
let reloadInProgress = false;
let reloadRequestedDuringRun = false;
const reloadCompleteCallbacks: (() => void)[] = [];
let reloadExecutor = async () => {
    await deregisterAll();
    await init();
};

export function onReloadComplete(callback: () => void) {
    reloadCompleteCallbacks.push(callback);
}

export function getState() {
    return state;
}

/**
 * Get available providers for a given component kind.
 * @param basePath relative path to the providers directory
 * @returns sorted list of available provider names
 */
function getAvailableProviders(basePath: string) {
    try {
        const resolvedPath = path.resolve(__dirname, basePath);
        const providers = fs
            .readdirSync(resolvedPath)
            .filter((file) => {
                const filePath = path.join(resolvedPath, file);
                return fs.statSync(filePath).isDirectory();
            })
            .sort();
        return providers;
    } catch (e) {
        return [];
    }
}

/**
 * Get documentation link for a component kind.
 * @param kind component kind (trigger, watcher, etc.)
 * @returns documentation path
 */
function getDocumentationLink(kind: ComponentKind) {
    const docLinks: Record<ComponentKind, string> = {
        trigger:
            'https://github.com/getwud/wud/tree/main/docs/configuration/triggers',
        watcher:
            'https://github.com/getwud/wud/tree/main/docs/configuration/watchers',
        registry:
            'https://github.com/getwud/wud/tree/main/docs/configuration/registries',
        authentication:
            'https://github.com/getwud/wud/tree/main/docs/configuration/authentications',
    };
    return (
        docLinks[kind] ||
        'https://github.com/getwud/wud/tree/main/docs/configuration'
    );
}

/**
 * Build error message when a component provider is not found.
 * @param kind component kind (trigger, watcher, etc.)
 * @param provider the provider name that was not found
 * @param error the original error message
 * @param availableProviders list of available providers
 * @returns formatted error message
 */
function getHelpfulErrorMessage(
    kind: ComponentKind,
    provider: string,
    error: string,
    availableProviders: string[],
) {
    let message = `Error when registering component ${provider} (${error})`;

    if (error.includes('Cannot find module')) {
        const kindDisplay = kind.charAt(0).toUpperCase() + kind.slice(1);
        const envVarPattern = `WUD_${kindDisplay.toUpperCase()}_${provider.toUpperCase()}_*`;

        message = `Unknown ${kind} provider: '${provider}'.`;
        message += `\n  (Check your environment variables - this comes from: ${envVarPattern})`;

        if (availableProviders.length > 0) {
            message += `\n  Available ${kind} providers: ${availableProviders.join(', ')}`;
            const docLink = getDocumentationLink(kind);
            message += `\n  For more information, visit: ${docLink}`;
        }
    }

    return message;
}

/**
 * Register a component.
 *
 */
async function registerComponent(
    kind: ComponentKind,
    provider: string,
    name: string,
    configuration: ComponentConfiguration,
    componentPath: string,
): Promise<Component> {
    const providerLowercase = provider.toLowerCase();
    const nameLowercase = name.toLowerCase();
    const componentFile = `${componentPath}/${providerLowercase.toLowerCase()}/${capitalize(provider)}`;
    try {
        const ComponentClass = (await import(componentFile)).default;
        const component: Component = new ComponentClass();
        const componentRegistered = await component.register(
            kind,
            providerLowercase,
            nameLowercase,
            configuration,
        );

        // Type assertion is safe here because we know the kind matches the expected type
        // if the file structure and inheritance are correct
        (state[kind] as any)[component.getId()] = component;
        return componentRegistered;
    } catch (e: any) {
        log.error(typeof e === 'string' ? e : JSON.stringify(e));
        const availableProviders = getAvailableProviders(componentPath);
        const helpfulMessage = getHelpfulErrorMessage(
            kind,
            providerLowercase,
            e.message,
            availableProviders,
        );
        throw new Error(helpfulMessage);
    }
}

/**
 * Register all found components.
 */
async function registerComponents(
    kind: ComponentKind,
    configurations: Record<string, any>,
    path: string,
) {
    if (configurations) {
        const providers = Object.keys(configurations);
        const providerPromises = providers
            .map((provider) => {
                log.info(
                    `Register all components of kind ${kind} for provider ${provider}`,
                );
                const providerConfigurations = configurations[provider];
                return Object.keys(providerConfigurations).map(
                    (configurationName) =>
                        registerComponent(
                            kind,
                            provider,
                            configurationName,
                            providerConfigurations[configurationName],
                            path,
                        ),
                );
            })
            .flat();
        return Promise.all(providerPromises);
    }
    return [];
}

/**
 * Register watchers.
 */
async function registerWatchers() {
    const configurations = getWatcherConfigurations();
    let watchersToRegister: Promise<any>[] = [];
    try {
        if (Object.keys(configurations).length === 0) {
            log.info(
                'No Watcher configured => Init a default one (Docker with default options)',
            );
            watchersToRegister.push(
                registerComponent(
                    'watcher',
                    'docker',
                    'local',
                    {},
                    '../watchers/providers',
                ),
            );
        } else {
            watchersToRegister = watchersToRegister.concat(
                Object.keys(configurations).map((watcherKey) => {
                    const watcherKeyNormalize = watcherKey.toLowerCase();
                    return registerComponent(
                        'watcher',
                        'docker',
                        watcherKeyNormalize,
                        configurations[watcherKeyNormalize],
                        '../watchers/providers',
                    );
                }),
            );
        }
        await Promise.all(watchersToRegister);
    } catch (e: any) {
        log.warn(`Some watchers failed to register (${e.message})`);
        log.debug(e);
    }
}

/**
 * Register triggers.
 */
async function registerTriggers() {
    const configurations = getTriggerConfigurations();
    try {
        await registerComponents(
            'trigger',
            configurations,
            '../triggers/providers',
        );
    } catch (e: any) {
        log.warn(`Some triggers failed to register (${e.message})`);
        log.debug(e);
    }
}

/**
 * Register registries.
 */
async function registerRegistries() {
    const defaultRegistries = {
        alibaba: { public: '' },
        codeberg: { public: '' },
        docr: { public: '' },
        ecr: { public: '' },
        forgejo: { public: '' },
        gcr: { public: '' },
        ghcr: { public: '' },
        harbor: { public: '' },
        hub: { public: '' },
        icr: { public: '' },
        jfrog: { public: '' },
        linode: { public: '' },
        nexus: { public: '' },
        ocir: { public: '' },
        proget: { public: '' },
        quay: { public: '' },
        scaleway: { public: '' },
    };
    const registriesToRegister = {
        ...defaultRegistries,
        ...getRegistryConfigurations(),
    };

    try {
        await registerComponents(
            'registry',
            registriesToRegister,
            '../registries/providers',
        );
    } catch (e: any) {
        log.warn(`Some registries failed to register (${e.message})`);
        log.debug(e);
    }
}

/**
 * Register authentications.
 */
async function registerAuthentications() {
    const configurations = getAuthenticationConfigurations();
    try {
        if (Object.keys(configurations).length === 0) {
            log.info('No authentication configured => Allow anonymous access');
            await registerComponent(
                'authentication',
                'anonymous',
                'anonymous',
                {},
                '../authentications/providers',
            );
        }
        await registerComponents(
            'authentication',
            configurations,
            '../authentications/providers',
        );
    } catch (e: any) {
        log.warn(`Some authentications failed to register (${e.message})`);
        log.debug(e);
    }
}

/**
 * Deregister a component.
 */
export async function deregisterComponent(
    component: Component,
    kind: ComponentKind,
) {
    try {
        await component.deregister();
    } catch (e: any) {
        throw new Error(
            `Error when deregistering component ${component.getId()} (${e.message})`,
        );
    } finally {
        const components = getState()[kind];
        if (components) {
            delete components[component.getId()];
        }
    }
}

/**
 * Deregister all components of kind.
 */
export async function deregisterComponents(
    components: Component[],
    kind: ComponentKind,
) {
    for (const component of components) {
        await deregisterComponent(component, kind);
    }
}

/**
 * Deregister all watchers.
 */
export function deregisterWatchers() {
    return deregisterComponents(Object.values(getState().watcher), 'watcher');
}

/**
 * Deregister all triggers.
 */
export function deregisterTriggers() {
    return deregisterComponents(Object.values(getState().trigger), 'trigger');
}

/**
 * Deregister all registries.
 */
export async function deregisterRegistries() {
    return deregisterComponents(Object.values(getState().registry), 'registry');
}

/**
 * Deregister all authentications.
 */
export function deregisterAuthentications() {
    return deregisterComponents(
        Object.values(getState().authentication),
        'authentication',
    );
}

/**
 * Deregister all components.
 */
export async function deregisterAll() {
    try {
        await deregisterWatchers();
        await deregisterTriggers();
        await deregisterRegistries();
        await deregisterAuthentications();
    } catch (e: any) {
        throw new Error(`Error when deregistering components (${e.message})`);
    }
    log.info('All components deregistered successfully.');
}

async function runReloadIfNeeded() {
    if (reloadInProgress) {
        reloadRequestedDuringRun = true;
        log.info('Config reload already running; coalescing new request');
        return;
    }

    reloadInProgress = true;
    do {
        reloadRequestedDuringRun = false;
        log.info('Config reload started');
        try {
            await reloadExecutor();
            log.info('Config reload completed');
        } catch (e: any) {
            log.warn(`Config reload failed (${e.message})`);
            log.debug(e);
        }
    } while (reloadRequestedDuringRun);
    reloadInProgress = false;
    reloadCompleteCallbacks.forEach((callback) => {
        try {
            callback();
        } catch (e: any) {
            log.warn(
                `Config reload completion callback failed (${e?.message || e})`,
            );
            log.debug(e);
        }
    });
}

function scheduleReload() {
    if (reloadDebounceTimeout) {
        clearTimeout(reloadDebounceTimeout);
    }
    log.info(`Config reload scheduled (${RELOAD_DEBOUNCE_MS}ms debounce)`);
    reloadDebounceTimeout = setTimeout(() => {
        reloadDebounceTimeout = undefined;
        void runReloadIfNeeded();
    }, RELOAD_DEBOUNCE_MS);
}

let initialized = false;
export async function init() {
    // Register triggers
    await registerTriggers();

    // Register registries
    await registerRegistries();

    // Register watchers
    await registerWatchers();

    // Register authentications
    await registerAuthentications();

    if (!initialized) {
        initialized = true;
        onConfigFileChange(() => {
            scheduleReload();
        });
    }
}

export async function dispose() {
    if (reloadDebounceTimeout) {
        clearTimeout(reloadDebounceTimeout);
        reloadDebounceTimeout = undefined;
    }
    await deregisterAll();
}
// The following exports are meant for testing only
export {
    registerComponent as testable_registerComponent,
    registerComponents as testable_registerComponents,
    registerRegistries as testable_registerRegistries,
    registerTriggers as testable_registerTriggers,
    registerWatchers as testable_registerWatchers,
    registerAuthentications as testable_registerAuthentications,
    deregisterComponent as testable_deregisterComponent,
    deregisterRegistries as testable_deregisterRegistries,
    deregisterTriggers as testable_deregisterTriggers,
    deregisterWatchers as testable_deregisterWatchers,
    deregisterAuthentications as testable_deregisterAuthentications,
    deregisterAll as testable_deregisterAll,
    log as testable_log,
    runReloadIfNeeded as testable_runReloadIfNeeded,
    scheduleReload as testable_scheduleReload,
    RELOAD_DEBOUNCE_MS as testable_reloadDebounceMs,
    reloadExecutor as testable_reloadExecutor,
};

export function testable_setReloadExecutor(executor: () => Promise<void>) {
    reloadExecutor = executor;
}
