import fs, { readFileSync } from 'fs';
import * as configuration from './index';

// mock fs
jest.mock('fs');

const fsExistsSyncMock = fs.existsSync as jest.Mock;
const fsReadFileSyncMock = fs.readFileSync as jest.Mock;

beforeEach(() => {
    fsExistsSyncMock.mockReturnValue(false);
    process.env = {};
    configuration.reloadConfig();
});

test('getVersion should return wud version', () => {
    process.env.WUD_VERSION = 'x.y.z';
    expect(configuration.getVersion()).toStrictEqual('x.y.z');
});

test('getLogLevel should return info by default', () => {
    delete process.env.WUD_LOG_LEVEL;
    expect(configuration.getLogLevel()).toStrictEqual('info');
});

test('getLogLevel should return debug when overridden', () => {
    process.env.WUD_LOG_LEVEL = 'debug';
    expect(configuration.getLogLevel()).toStrictEqual('debug');
});

test('getWatcherConfiguration should return empty object by default', () => {
    delete process.env.WUD_WATCHER_WATCHER1_X;
    delete process.env.WUD_WATCHER_WATCHER1_Y;
    delete process.env.WUD_WATCHER_WATCHER2_X;
    delete process.env.WUD_WATCHER_WATCHER2_Y;
    expect(configuration.getWatcherConfigurations()).toStrictEqual({});
});

test('getWatcherConfiguration should return configured watchers when overridden', () => {
    process.env.WUD_WATCHER_WATCHER1_X = 'x';
    process.env.WUD_WATCHER_WATCHER1_Y = 'y';
    process.env.WUD_WATCHER_WATCHER2_X = 'x';
    process.env.WUD_WATCHER_WATCHER2_Y = 'y';
    expect(configuration.getWatcherConfigurations()).toStrictEqual({
        watcher1: { x: 'x', y: 'y' },
        watcher2: { x: 'x', y: 'y' },
    });
});

test('getTriggerConfigurations should return empty object by default', () => {
    delete process.env.WUD_TRIGGER_TRIGGER1_X;
    delete process.env.WUD_TRIGGER_TRIGGER1_Y;
    delete process.env.WUD_TRIGGER_TRIGGER2_X;
    delete process.env.WUD_TRIGGER_TRIGGER2_Y;
    expect(configuration.getTriggerConfigurations()).toStrictEqual({});
});

test('getTriggerConfigurations should return configured triggers when overridden', () => {
    process.env.WUD_TRIGGER_TRIGGER1_X = 'x';
    process.env.WUD_TRIGGER_TRIGGER1_Y = 'y';
    process.env.WUD_TRIGGER_TRIGGER2_X = 'x';
    process.env.WUD_TRIGGER_TRIGGER2_Y = 'y';
    expect(configuration.getTriggerConfigurations()).toStrictEqual({
        trigger1: { x: 'x', y: 'y' },
        trigger2: { x: 'x', y: 'y' },
    });
});

test('getRegistryConfigurations should return empty object by default', () => {
    delete process.env.WUD_REGISTRY_REGISTRY1_X;
    delete process.env.WUD_REGISTRY_REGISTRY1_Y;
    delete process.env.WUD_REGISTRY_REGISTRY2_X;
    delete process.env.WUD_REGISTRY_REGISTRY2_Y;
    expect(configuration.getRegistryConfigurations()).toStrictEqual({});
});

test('getRegistryConfigurations should return configured registries when overridden', () => {
    process.env.WUD_REGISTRY_REGISTRY1_X = 'x';
    process.env.WUD_REGISTRY_REGISTRY1_Y = 'y';
    process.env.WUD_REGISTRY_REGISTRY2_X = 'x';
    process.env.WUD_REGISTRY_REGISTRY2_Y = 'y';
    expect(configuration.getRegistryConfigurations()).toStrictEqual({
        registry1: { x: 'x', y: 'y' },
        registry2: { x: 'x', y: 'y' },
    });
});

test('getStoreConfiguration should return configured store', () => {
    process.env.WUD_STORE_X = 'x';
    process.env.WUD_STORE_Y = 'y';
    expect(configuration.getStoreConfiguration()).toStrictEqual({
        x: 'x',
        y: 'y',
    });
});

test('getServerConfiguration should return configured api (new vars)', () => {
    process.env.WUD_SERVER_PORT = '4000';
    expect(configuration.getServerConfiguration()).toStrictEqual({
        cors: {},
        enabled: true,
        feature: {
            delete: true,
        },
        port: 4000,
        tls: {},
    });
});

test('replaceSecrets must read secret in file', () => {
    fsReadFileSyncMock.mockReturnValue('super_secret');
    const vars = {
        WUD_SERVER_X__FILE: `${__dirname}/secret.txt`,
    };
    configuration.replaceSecrets(vars);
    expect(vars).toStrictEqual({
        WUD_SERVER_X: 'super_secret',
    });
});

test('config will read the config file', () => {
    fsExistsSyncMock.mockReturnValueOnce(true);
    fsReadFileSyncMock.mockReturnValueOnce('{"log": {"level": "debug"}}');

    expect(configuration.getLogLevel()).toStrictEqual('debug');
});

test('getVersion will read the version from the config file', () => {
    fsExistsSyncMock.mockReturnValueOnce(true);
    fsReadFileSyncMock.mockReturnValueOnce('{"version": "1.0.0"}');
    delete process.env.WUD_VERSION;
    expect(configuration.getVersion()).toStrictEqual('1.0.0');
});

test('getVersion will read the version from the env vars', () => {
    fsExistsSyncMock.mockReturnValueOnce(true);
    fsReadFileSyncMock.mockReturnValueOnce('{"version": "1.0.0"}');
    process.env.WUD_VERSION = '1.0.0';
    expect(configuration.getVersion()).toStrictEqual('1.0.0');
});

test('getWatcherConfigurations will read the watcher from the config file', () => {
    fsExistsSyncMock.mockReturnValueOnce(true);
    fsReadFileSyncMock.mockReturnValueOnce(
        `{
            "watcher": {
                "watcher1": {
                    "x": "x", 
                    "y": "y"
                }
            }
        }`,
    );

    expect(configuration.getWatcherConfigurations()).toStrictEqual({
        watcher1: { x: 'x', y: 'y' },
    });
});

test('getWatcherConfigurations will merge config and env vars', () => {
    fsExistsSyncMock.mockReturnValueOnce(true);
    fsReadFileSyncMock.mockReturnValueOnce(
        `{
            "watcher": {
                "watcher1": {
                    "x": "x", 
                    "y": "y"
                }
            }
        }`,
    );

    process.env.WUD_WATCHER_WATCHER1_Z = 'z';

    expect(configuration.getWatcherConfigurations()).toStrictEqual({
        watcher1: { x: 'x', y: 'y', z: 'z' },
    });
});

test('config will override config file with env vars', () => {
    fsExistsSyncMock.mockReturnValueOnce(true);
    fsReadFileSyncMock.mockReturnValueOnce(
        `{
            "log": {
                "level": "debug"
            }
        }`,
    );
    process.env.WUD_LOG_LEVEL = 'info';
    expect(configuration.getLogLevel()).toStrictEqual('info');
});