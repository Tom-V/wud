import fs from 'fs/promises';
import log from '../../../log';
import Dockercompose, { doesContainerBelongToCompose } from './Dockercompose';
import { testTriggerProvider } from '../TriggerTestHelper';

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

test('doesContainerBelongToCompose should match a service whose image contains the container image', () => {
    expect(doesContainerBelongToCompose(composeMatching, container)).toBe(true);
});

test('doesContainerBelongToCompose should return false without throwing when a service has no image', () => {
    expect(() =>
        doesContainerBelongToCompose(composeNoMatch, container),
    ).not.toThrow();
    expect(doesContainerBelongToCompose(composeNoMatch, container)).toBe(false);
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

test('processComposeFile refuses pending updates before writing compose file', async () => {
    (fs.readFile as jest.Mock).mockResolvedValue(
        Buffer.from('services:\n  svc1:\n    image: myimage:1.0.0\n'),
    );
    (fs.access as jest.Mock).mockResolvedValue(undefined);
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
    expect(fs.writeFile).not.toHaveBeenCalled();
});
