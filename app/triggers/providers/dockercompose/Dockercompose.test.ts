import fs from 'fs/promises';
import log from '../../../log';
import Dockercompose from './Dockercompose';
import { testTriggerProvider } from '../TriggerTestHelper';
import yaml from 'yaml';
import Docker from '../docker/Docker';
import { Container } from '../../../model/container';
import { getContainers } from '../../../store/container';

jest.mock('fs/promises');
jest.mock('../../../registry', () => ({
    getState() {
        return {
            registry: {
                hub: {
                    getImageFullName: (
                        image: { name: string },
                        tagOrDigest: string,
                    ) => `${image.name}:${tagOrDigest}`,
                },
            },
        };
    },
}));
jest.mock('../../../store/container', () => ({
    getContainers: jest.fn(),
}));

const mockedFs = jest.mocked(fs);

type RecursivePartial<T> = {
    [P in keyof T]?: RecursivePartial<T[P]>;
};

const dockercompose = new Dockercompose();
dockercompose.log = log;
dockercompose.configuration = {
    composeFileLabel: 'wud.compose.file',
};

afterEach(() => {
    jest.restoreAllMocks();
});

beforeEach(() => {
    dockercompose.configuration = {
        composeFileLabel: 'wud.compose.file',
    };
    dockercompose.processComposeFile =
        Dockercompose.prototype.processComposeFile;
});

const configurationValid = {
    file: '/path/to/docker-compose.yml',
    threshold: 'all',
    mode: 'simple',
    once: true,
    auto: true,
};

describe('Dockercompose Trigger', () => {
    testTriggerProvider(Dockercompose, configurationValid, {
        testTemplateRenders: false,
    });
});

const container = {
    name: 'test',
    image: {
        registry: { name: 'hub' },
        name: 'test/test',
        tag: { value: '1.2.3', semver: true },
    },
    updateKind: { kind: 'tag', remoteValue: '4.5.6' },
};

const composeMatching = {
    services: {
        test: {
            image: 'test/test:1.2.3',
        },
        builder: { build: '.' },
    },
};

const composeNoMatch = {
    services: {
        builder: { build: '.' },
        other: { image: 'something/else:1.0.0' },
    },
};

test('getComposeServiceKey should match a service whose image contains the container image', () => {
    expect(dockercompose.getComposeServiceKey(composeMatching, container)).toBe(
        'test',
    );
});

test('getComposeServiceKey should return undefined without throwing when a service has no image', () => {
    expect(() =>
        dockercompose.getComposeServiceKey(composeNoMatch, container),
    ).not.toThrow();
    expect(
        dockercompose.getComposeServiceKey(composeNoMatch, container),
    ).toBeUndefined();
});

test('mapCurrentVersionToUpdateVersion should map the matching service to its update', () => {
    const mapping = dockercompose.mapCurrentVersionToUpdateVersion(
        composeMatching,
        container,
        new Set(),
    );
    expect(mapping).toEqual({
        current: 'test/test:1.2.3',
        update: 'test/test:4.5.6',
    });
});

test('mapCurrentVersionToUpdateVersion should return undefined when no service matches', () => {
    const mapping = dockercompose.mapCurrentVersionToUpdateVersion(
        composeNoMatch,
        container,
        new Set(),
    );
    expect(mapping).toBeUndefined();
});

test('configured file takes precedence over automatic compose label', () => {
    dockercompose.configuration = {
        file: '/some/path/docker-compose.yml',
        composeFileLabel: 'wud.compose.file',
    };

    expect(
        dockercompose.getComposeFileForContainer({
            labels: {
                'com.docker.compose.project.config_files':
                    '/some/path/automatic-compose.yaml',
            },
        }),
    ).toBe('/some/path/docker-compose.yml');
});

test('per-container WUD label takes precedence over configured file', () => {
    dockercompose.configuration = {
        file: '/some/path/docker-compose.yml',
        composeFileLabel: 'wud.compose.file',
    };

    expect(
        dockercompose.getComposeFileForContainer({
            labels: {
                'wud.compose.file': '/some/path/label-compose.yml',
                'com.docker.compose.project.config_files':
                    '/some/path/automatic-compose.yaml',
            },
        }),
    ).toBe('/some/path/label-compose.yml');
});

test('automatic compose label is used without explicit configuration', () => {
    dockercompose.configuration = {
        composeFileLabel: 'wud.compose.file',
    };

    expect(
        dockercompose.getComposeFileForContainer({
            labels: {
                'com.docker.compose.project.config_files':
                    '/some/path/automatic-compose.yaml',
            },
        }),
    ).toBe('/some/path/automatic-compose.yaml');
});

describe('Dockercompose Trigger - file operations', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        dockercompose.configuration = { ...configurationValid };
        dockercompose.processComposeFile =
            Dockercompose.prototype.processComposeFile;
    });

    test('initTrigger should verify file access if file configured', async () => {
        (fs.access as jest.Mock).mockResolvedValue(undefined);
        await dockercompose.initTrigger();
        expect(fs.access).toHaveBeenCalledWith(configurationValid.file);
        expect(dockercompose.configuration.mode).toBe('batch');
    });

    test('initTrigger should throw error if file access fails', async () => {
        (fs.access as jest.Mock).mockRejectedValue(new Error('File not found'));
        await expect(dockercompose.initTrigger()).rejects.toThrow(
            'File not found',
        );
    });

    test('backup should copy file', async () => {
        (fs.copyFile as jest.Mock).mockResolvedValue(undefined);
        await dockercompose.backup('test.yml', 'test.yml.back');
        expect(fs.copyFile).toHaveBeenCalledWith('test.yml', 'test.yml.back');
    });

    test('writeComposeFile should write data', async () => {
        (fs.writeFile as jest.Mock).mockResolvedValue(undefined);
        await dockercompose.writeComposeFile('test.yml', 'data');
        expect(fs.writeFile).toHaveBeenCalledWith('test.yml', 'data');
    });

    test('getComposeFile should read file', async () => {
        (fs.readFile as jest.Mock).mockResolvedValue(Buffer.from('services:'));
        const result = await dockercompose.getComposeFile('test.yml');
        expect(fs.readFile).toHaveBeenCalledWith('test.yml');
        expect(result.toString()).toBe('services:');
    });

    test('triggerBatch should process compose file', async () => {
        (fs.access as jest.Mock).mockResolvedValue(undefined);
        dockercompose.getWatcher = jest.fn().mockReturnValue({
            dockerApi: { modem: { socketPath: '/var/run/docker.sock' } },
        });
        dockercompose.processComposeFile = jest
            .fn()
            .mockResolvedValue(undefined);

        await dockercompose.triggerBatch([container as any]);

        expect(dockercompose.processComposeFile).toHaveBeenCalledWith(
            configurationValid.file,
            [container],
        );
    });
});

test('processComposeFile refuses pending updates before writing compose file', async () => {
    mockedFs.readFile.mockResolvedValue(
        Buffer.from('services:\n  svc1:\n    image: myimage:1.0.0\n'),
    );
    mockedFs.access.mockResolvedValue(undefined);
    (getContainers as jest.Mock).mockReturnValue([]);
    const sampleContainer: RecursivePartial<Container> = {
        name: 'svc1',
        image: {
            name: 'myimage',
            tag: { value: '1.0.0' },
            registry: { name: 'hub', url: 'local' },
        },
        updateKind: {
            kind: 'tag',
            remoteValue: '2.0.0',
        },
        watcher: 'local',
    };
    const pendingContainer = {
        ...sampleContainer,
        updatePending: true,
        updatePendingUntil: '2026-06-01T12:00:00.000Z',
    };

    await expect(
        dockercompose.processComposeFile('/tmp/docker-compose.yml', [
            pendingContainer,
        ]),
    ).rejects.toThrow('pending until 2026-06-01T12:00:00.000Z');
    expect(mockedFs.writeFile).not.toHaveBeenCalled();
});

test('processComposeFile updates sibling watched containers sharing the same compose image', async () => {
    const triggerSpy = jest
        .spyOn(Docker.prototype as any, 'trigger')
        .mockResolvedValue(undefined);
    const compose = {
        services: {
            server: {
                image: 'ghcr.io/goauthentik/server:2026.2.1',
                container_name: 'Authentik-Server',
            },
            worker: {
                image: 'ghcr.io/goauthentik/server:2026.2.1',
                container_name: 'Authentik-Worker',
            },
        },
    };
    const serverContainer = {
        id: 'server-id',
        name: 'Authentik-Server',
        watcher: 'local',
        labels: {
            'com.docker.compose.service': 'server',
            'wud.compose.file': '/tmp/docker-compose.yml',
        },
        image: {
            name: 'ghcr.io/goauthentik/server',
            tag: { value: '2026.2.1' },
            registry: { name: 'hub', url: 'local' },
        },
        updateKind: {
            kind: 'tag',
            remoteValue: '2026.2.2',
        },
    };
    const workerContainer = {
        id: 'worker-id',
        name: 'Authentik-Worker',
        watcher: 'local',
        labels: {
            'com.docker.compose.service': 'worker',
            'wud.compose.file': '/tmp/docker-compose.yml',
        },
        image: {
            name: 'ghcr.io/goauthentik/server',
            tag: { value: '2026.2.1' },
            registry: { name: 'hub', url: 'local' },
        },
        updateKind: {
            kind: 'tag',
            remoteValue: '2026.2.2',
        },
    };

    mockedFs.readFile.mockResolvedValue(Buffer.from(yaml.stringify(compose)));
    mockedFs.copyFile.mockResolvedValue(undefined);
    mockedFs.writeFile.mockResolvedValue(undefined);
    (getContainers as jest.Mock).mockReturnValue([
        serverContainer,
        workerContainer,
    ]);

    await dockercompose.processComposeFile('/tmp/docker-compose.yml', [
        serverContainer as unknown as Container,
    ]);

    expect(triggerSpy).toHaveBeenCalledTimes(2);
    expect(triggerSpy).toHaveBeenCalledWith(serverContainer);
    expect(triggerSpy).toHaveBeenCalledWith(workerContainer);
});

test('processComposeFile still matches services after the compose image has already been rewritten', async () => {
    const triggerSpy = jest
        .spyOn(Docker.prototype as any, 'trigger')
        .mockResolvedValue(undefined);
    const compose = {
        services: {
            server: {
                image: 'ghcr.io/goauthentik/server:2026.2.2',
                container_name: 'Authentik-Server',
            },
            worker: {
                image: 'ghcr.io/goauthentik/server:2026.2.2',
                container_name: 'Authentik-Worker',
            },
        },
    };
    const serverContainer = {
        id: 'server-id',
        name: 'Authentik-Server',
        watcher: 'local',
        labels: {
            'com.docker.compose.service': 'server',
            'wud.compose.file': '/tmp/docker-compose.yml',
        },
        image: {
            name: 'ghcr.io/goauthentik/server',
            tag: { value: '2026.2.1' },
            registry: { name: 'hub', url: 'local' },
        },
        updateKind: {
            kind: 'tag',
            remoteValue: '2026.2.2',
        },
    };
    const workerContainer = {
        id: 'worker-id',
        name: 'Authentik-Worker',
        watcher: 'local',
        labels: {
            'com.docker.compose.service': 'worker',
            'wud.compose.file': '/tmp/docker-compose.yml',
        },
        image: {
            name: 'ghcr.io/goauthentik/server',
            tag: { value: '2026.2.1' },
            registry: { name: 'hub', url: 'local' },
        },
        updateKind: {
            kind: 'tag',
            remoteValue: '2026.2.2',
        },
    };

    mockedFs.readFile.mockResolvedValue(Buffer.from(yaml.stringify(compose)));
    mockedFs.copyFile.mockResolvedValue(undefined);
    mockedFs.writeFile.mockResolvedValue(undefined);
    (getContainers as jest.Mock).mockReturnValue([
        serverContainer,
        workerContainer,
    ]);

    await dockercompose.processComposeFile('/tmp/docker-compose.yml', [
        workerContainer as unknown as Container,
    ]);

    expect(triggerSpy).toHaveBeenCalledTimes(2);
    expect(triggerSpy).toHaveBeenCalledWith(serverContainer);
    expect(triggerSpy).toHaveBeenCalledWith(workerContainer);
});
