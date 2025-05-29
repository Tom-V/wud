import joi from "joi";
import log, { LogLevel, logLevels } from '../log';
import fs, { FSWatcher } from 'fs';
import setValue from 'set-value';

const VAR_FILE_SUFFIX = '__FILE';
const VAR_FILE_SUFFIX_LENGTH = VAR_FILE_SUFFIX.length;

const fileChangedFunctions: (() => void)[] = [];
export function onConfigFileChange(callback: () => void) {
    fileChangedFunctions.push(callback);
}

/**
 * Lookup external secrets defined in files.
 * @param wudEnvVars
 */
export function replaceSecrets(wudEnvVars: Record<string, string>) {
    const secretFileEnvVars = Object.keys(wudEnvVars).filter((wudEnvVar) =>
        wudEnvVar.toUpperCase().endsWith(VAR_FILE_SUFFIX),
    );
    secretFileEnvVars.forEach((secretFileEnvVar) => {
        const secretKey = secretFileEnvVar.slice(0, -VAR_FILE_SUFFIX_LENGTH);
        const secretFilePath = wudEnvVars[secretFileEnvVar];
        const secretFileValue = fs.readFileSync(secretFilePath, 'utf-8');
        delete wudEnvVars[secretFileEnvVar];
        wudEnvVars[secretKey] = secretFileValue;
    });
}

export function reloadConfig() {
    cachedConfig = undefined;
}

let cachedConfig: IBaseConfig | undefined = undefined;
let configFileWatcher: FSWatcher | undefined = undefined;
function getConfig(): IBaseConfig {
    if (cachedConfig) {
        return cachedConfig;
    }

    // We already try to set the log level from the environment variable
    // If the log level is also in the config file, it will be overridden at the end
    if (process.env.WUD_LOG_LEVEL) {
        log.setLogLevel(process.env.WUD_LOG_LEVEL as LogLevel);
    }

    const config = processConfigFileOrDefault();

    const wudEnvVars: Record<string, string> = {};
    // 1. Get a copy of all wud related env vars
    Object.keys(process.env)
        .filter((envVar) => envVar.toUpperCase().startsWith('WUD'))
        .forEach((wudEnvVar) => {
            wudEnvVars[wudEnvVar] = process.env[wudEnvVar]!;
        });

    // 2. Replace all secret files referenced by their secret values
    replaceSecrets(wudEnvVars);

    // 3. Now we use wudEnvVars to set values in the config object
    Object.keys(wudEnvVars).forEach((wudEnvVar) => {
        const key = wudEnvVar.slice(4).replace(/_/g, '.').toLowerCase();

        const value = wudEnvVars[wudEnvVar];
        if (key === "version") { config.version = value; return; }

        const keyParts = key.split('.');
        const type = keyParts[0];

        // check if it's a map
        const configItem = config[type as keyof IBaseConfig];
        if (configItem instanceof Map) {
            // the second part of the key is the name of the watcher, trigger, registry
            const name = keyParts[1];
            if (!configItem.has(name)) {
                configItem.set(name, {});
            }
            const configValue = configItem.get(name)!;
            // set the value in the map
            const configKey = keyParts.slice(2).join('.');
            setValue(configValue, configKey, value);

        } else if (configItem && typeof configItem === 'object') {
            setValue(configItem, keyParts.slice(1).join('.'), value);
        } else if (configItem === undefined) {
            if (key.indexOf('.') > -1) {
                const configKey = keyParts.slice(1).join('.');
                setValue(config, configKey, value);
            } else {
                config[key as keyof IBaseConfig] = value;
            }
        } else {
            log.warn(`Invalid configuration for key: ${key}, expected an object but got ${typeof configItem}`);
        }
    });

    cachedConfig = config;

    // The config file is loaded, now we can set the log level
    log.setLogLevel(getLogLevel(config));
    return cachedConfig;
}

function getBaseConfig(): IBaseConfig {
    const config: IBaseConfig = {
        watcher: {},
        trigger: {},
        registry: {},
        auth: {},
        store: {},
        log: {
            level: 'info',
        },
        version: 'unknown',
        server: {} as ServerConfiguration,
    }

    return config;
}

function processConfigFileOrDefault(): IBaseConfig {
    const config = getBaseConfig();

    const defaultConfigFile = './config.json';
    const configFilePath = process.env.WUD_CONFIG_FILE ?? defaultConfigFile;
    // Check if file exists
    if (!fs.existsSync(configFilePath)) {
        if (configFilePath !== defaultConfigFile) {
            log.warn(`Config file ${configFilePath} does not exist, using only environment variables`);
        } else {
            log.info(`Default config file ${configFilePath} does not exist, using only environment variables`);
        }
        return config;
    }
    if (!configFileWatcher) {
        // config file cannot be changed while the process is running so we don't need to recreate the watcher
        configFileWatcher = fs.watch(configFilePath, (eventType) => {
            reloadConfig();

            fileChangedFunctions.forEach((callback) => {
                callback();
            });
        });
    }

    const configFileValue = fs.readFileSync(configFilePath, 'utf-8');
    if (!configFileValue || configFileValue.length === 0) {
        log.error(`Config file ${configFilePath} is empty`);
        return getBaseConfig();
    }

    let configFileJson: any | undefined;
    try {
        configFileJson = JSON.parse(configFileValue);
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        log.error(`Failed to load configuration file ${configFilePath}: ${errorMessage}`);
        return getBaseConfig();
    }

    // Validate that configFileJson is an object, if not something is certainly wrong
    if (typeof configFileJson !== 'object' || configFileJson === null) {
        log.error(`Config file ${configFilePath} does not contain a valid JSON object`);
        return getBaseConfig();
    }
    // Set config values
    Object.keys(configFileJson).forEach((key) => {
        const value = configFileJson[key];

        // Ensure value is an object before converting to Map
        if (typeof value === 'string') {
            const existingValue = config[key as keyof IBaseConfig];
            // if existing value is a string, set it directly
            if (typeof existingValue === 'string' || existingValue === undefined) {
                ((config as any)[key]) = value;
            }
            else {
                log.error(`Invalid configuration for key: ${key}, expected a string but got ${typeof existingValue}`);
                return getBaseConfig();
            }
        }
        else if (typeof value === 'object' && value !== null) {
            const existingValue = config[key as keyof IBaseConfig];
            if (typeof existingValue === 'object') {
                Object.assign(existingValue, value);
            } else if (existingValue === undefined) {
                config[key as keyof IBaseConfig] = value;
            } else {
                log.error(`Invalid configuration for key: ${key}, expected an object but got ${typeof existingValue}`);
                return getBaseConfig();
            }
        } else {
            log.error(`Invalid configuration for key: ${key}, expected a string or an object but got ${typeof value}`);
            return getBaseConfig();
        }
    });

    return config;
}

export function stopWatcher() {
    if (configFileWatcher) {
        configFileWatcher.close();
        configFileWatcher = undefined;
    }
}

export function getVersion() {
    return getConfig().version;
}

export function getLogLevel(baseConfig?: IBaseConfig): LogLevel {
    const config = baseConfig || getConfig();
    const logLevel = config.log.level;
    if (logLevel) {
        return logLevels.includes(logLevel as LogLevel) ? logLevel as LogLevel : 'info';
    }
    return 'info';
}
/**
 * Get watcher configuration.
 */
export function getWatcherConfigurations() {
    return getConfig().watcher
}

/**
 * Get trigger configurations.
 */
export function getTriggerConfigurations() {
    return getConfig().trigger;
}

/**
 * Get registry configurations.
 * @returns {*}
 */
export function getRegistryConfigurations() {
    return getConfig().registry;
}

/**
 * Get authentication configurations.
 * @returns {*}
 */
export function getAuthenticationConfigurations() {
    return getConfig().auth;
}

/**
 * Get Input configurations.
 */
export function getStoreConfiguration() {
    return getConfig().store;
}

/**
 * Get Server configurations.
 */
export function getServerConfiguration() {
    const configurationFromEnv = getConfig().server;
    const configurationSchema = joi.object<ServerConfiguration>().keys({
        enabled: joi.boolean().default(true),
        port: joi.number().default(3000).integer().min(0).max(65535),
        tls: joi
            .object({
                enabled: joi.boolean().default(false),
                key: joi.string().when('enabled', {
                    is: true,
                    then: joi.required(),
                    otherwise: joi.optional(),
                }),
                cert: joi.string().when('enabled', {
                    is: true,
                    then: joi.required(),
                    otherwise: joi.optional(),
                }),
            })
            .default({}),
        cors: joi
            .object({
                enabled: joi.boolean().default(false),
                origin: joi.string().default('*'),
                methods: joi.string().default('GET,HEAD,PUT,PATCH,POST,DELETE'),
            })
            .default({}),
        feature: joi
            .object({
                delete: joi.boolean().default(true),
            })
            .default({
                delete: true,
            }),
    });

    // Validate Configuration
    const configurationToValidate = configurationSchema.validate(
        configurationFromEnv || {},
    );
    if (configurationToValidate.error) {
        throw configurationToValidate.error;
    }
    return configurationToValidate.value;
}

export function getPublicUrl(req: any) {
    const publicUrl = getConfig().public?.url;
    if (publicUrl) {
        return publicUrl;
    }
    // Try to guess from request
    return `${req.protocol}://${req.hostname}`;
}


export interface ServerConfiguration {
    enabled: boolean;
    port: number;
    tls: {
        enabled: boolean;
        key?: string;
        cert?: string;
    };
    cors: {
        enabled: boolean;
        origin: string;
        methods: string;
    };
    feature: {
        delete: boolean;
    };
}

export type BaseConfiguration = Record<string, Record<string, unknown>>;

type IBaseConfig = {
    version: string;
    log: {
        level: string;
    }
    watcher: BaseConfiguration;
    trigger: BaseConfiguration;
    registry: BaseConfiguration;
    auth: BaseConfiguration;
    store: object;
    server: ServerConfiguration;
    [key: string]: any;
}