import fs from 'fs/promises';
import yaml from 'yaml';
import { Dockercompose, DockerComposeConfiguration } from './Dockercompose';
import { Logger } from '../../../log';
import { Container } from '../../../model/container';
import { Docker } from '../docker/Docker';

jest.mock('fs/promises');
jest.mock('yaml');

const mockLog = {
    error: jest.fn(),
    warn: jest.fn(),
    info: jest.fn(),
    debug: jest.fn(),
    child: jest.fn(() => mockLog),
} as any as Logger;

const mockGetState = jest.fn();
jest.mock('../../../registry/states', () => ({
    getState: () => mockGetState(),
}));
jest.spyOn(Docker.prototype, 'trigger').mockResolvedValue();

const mockRegistry = {
    getImageFullName: jest.fn((image, tag) => `${image.name}:${tag}`),
};

const validConfig: DockerComposeConfiguration = {
    file: '/tmp/docker-compose.yml',
    backup: true,
    prune: false,
    dryrun: false,
    auto: false,
    autoremovetimeout: 60,
    threshold: 'all',
    mode: 'simple',
    simpletitle: 'Docker Compose',
    simplebody: 'Update Docker Compose services',
    once: true,
    batchtitle: 'Docker Compose Batch',
};

const sampleCompose = {
    services: {
        svc1: { image: 'myimage:1.0.0' },
        svc2: { image: 'other:2.0.0' },
    },
};

type RecursivePartial<T> = {
    [P in keyof T]?: RecursivePartial<T[P]>;
};

const sampleContainer: RecursivePartial<Container> = {
    name: 'svc1',
    image: {
        name: 'myimage',
        tag: { value: '1.0.0' },
        registry: { name: 'docker', url: 'local' },
    },
    updateKind: {
        kind: 'tag',
        remoteValue: '2.0.0',
    },
    watcher: 'local',
};

beforeEach(() => {
    jest.clearAllMocks();
    mockGetState.mockReturnValue({
        registry: { docker: mockRegistry },
        watcher: { 'docker.local': { dockerApi: { modem: { socketPath: '/var/run/docker.sock' } } } },
    });
});

describe('Dockercompose', () => {
    let dockercompose: Dockercompose;

    beforeEach(() => {
        dockercompose = new Dockercompose();
        dockercompose.configuration = { ...validConfig };
        dockercompose.log = mockLog;
        dockercompose.getWatcher = jest.fn(() => ({ dockerApi: { modem: { socketPath: '/var/run/docker.sock' } } })) as any;
        (yaml.parse as jest.Mock).mockReturnValue(sampleCompose);
    });

    test('validateConfiguration should return validated configuration when valid', () => {
        const validatedConfig = dockercompose.validateConfiguration(validConfig);
        expect(validatedConfig).toStrictEqual(validConfig);
    });

    test('validateConfiguration should throw error when invalid', () => {
        const invalidConfig = { file: 123 } as any;
        expect(() => {
            dockercompose.validateConfiguration(invalidConfig);
        }).toThrow();
    });

    test('getConfigurationSchema returns schema with file and backup', () => {
        const schema = dockercompose.getConfigurationSchema();
        const validated = schema.validate({ file: 'a.yml' });
        expect(validated.value.file).toBe('a.yml');
        expect(validated.value.backup).toBe(false);
    });

    test('initTrigger throws if file does not exist', async () => {
        (fs.access as jest.Mock).mockRejectedValue(new Error('not found'));
        await expect(dockercompose.initTrigger()).rejects.toThrow('not found');
        expect(mockLog.error).toHaveBeenCalledWith(expect.stringContaining('does not exist'));
    });

    test('initTrigger succeeds if file exists', async () => {
        (fs.access as jest.Mock).mockResolvedValue(undefined);
        await expect(dockercompose.initTrigger()).resolves.toBeUndefined();
    });

    test('trigger calls triggerBatch', async () => {
        const spy = jest.spyOn(dockercompose, 'triggerBatch').mockResolvedValue(undefined);
        await dockercompose.trigger(sampleContainer as Container);
        expect(spy).toHaveBeenCalledWith([sampleContainer]);
    });

    test('triggerBatch filters containers not on localhost', async () => {
        dockercompose.getWatcher = jest.fn(() => ({ dockerApi: { modem: { socketPath: '' } } })) as any;
        (fs.readFile as jest.Mock).mockResolvedValue(Buffer.from('services: {}'));
        await dockercompose.triggerBatch([sampleContainer as Container]);
        expect(mockLog.warn).toHaveBeenCalledWith(expect.stringContaining('not running on local host'));
    });

    test('triggerBatch does not write file in dryrun mode', async () => {
        dockercompose.configuration.dryrun = true;
        (fs.readFile as jest.Mock).mockResolvedValue(Buffer.from('services: {}'));
        await dockercompose.triggerBatch([sampleContainer as Container]);
        expect(mockLog.info).toHaveBeenCalledWith(expect.stringContaining('dry-run'));
        expect(fs.writeFile).not.toHaveBeenCalled();
    });

    test('triggerBatch backs up and writes file', async () => {
        (fs.readFile as jest.Mock).mockResolvedValue(Buffer.from('services: {}'));
        (fs.copyFile as jest.Mock).mockResolvedValue(undefined);
        (fs.writeFile as jest.Mock).mockResolvedValue(undefined);
        dockercompose.mapCurrentVersionToUpdateVersion = jest.fn(() => ({ current: 'myimage:1.0.0', update: 'myimage:2.0.0' }));
        await dockercompose.triggerBatch([sampleContainer as Container]);
        expect(fs.copyFile).toHaveBeenCalledWith(validConfig.file, `${validConfig.file}.back`);
        expect(fs.writeFile).toHaveBeenCalled();
    });

    test('triggerBatch replaces the version in the compose file', async () => {
        // Compose file with a service using the old version
        const composeFileStr = 'services:\n  svc1:\n    image: myimage:1.0.0\n  svc2:\n    image: other:2.0.0\n';
        (fs.readFile as jest.Mock).mockResolvedValue(Buffer.from(composeFileStr));
        (fs.copyFile as jest.Mock).mockResolvedValue(undefined);
        const writeFileMock = (fs.writeFile as jest.Mock).mockResolvedValue(undefined);
        // Simulate version mapping
        dockercompose.mapCurrentVersionToUpdateVersion = jest.fn(() => ({ current: 'myimage:1.0.0', update: 'myimage:2.0.0' }));
        await dockercompose.triggerBatch([sampleContainer as Container]);
        // Get the actual file content written
        const writtenContent = writeFileMock.mock.calls[0][1];
        // Build the expected file content
        const expectedContent = 'services:\n  svc1:\n    image: myimage:2.0.0\n  svc2:\n    image: other:2.0.0\n';
        expect(writtenContent).toEqual(expectedContent);
    });

    test('triggerBatch replaces the version in the compose file', async () => {
        // Compose file with a service using the old version
        const composeFileStr = 'services:\n  svc1:\n    image: myimage:1.0.0\n  svc2:\n    image: other:1.0.0\n';
        (fs.readFile as jest.Mock).mockResolvedValue(Buffer.from(composeFileStr));
        (fs.copyFile as jest.Mock).mockResolvedValue(undefined);
        const writeFileMock = (fs.writeFile as jest.Mock).mockResolvedValue(undefined);
        // Simulate version mapping
        await dockercompose.triggerBatch([sampleContainer as Container]);
        // Get the actual file content written
        const writtenContent = writeFileMock.mock.calls[0][1];
        // Build the expected file content
        const expectedContent = 'services:\n  svc1:\n    image: myimage:2.0.0\n  svc2:\n    image: other:1.0.0\n';
        expect(writtenContent).toEqual(expectedContent);
    });

    test('backup logs warning on error', async () => {
        (fs.copyFile as jest.Mock).mockRejectedValue(new Error('fail'));
        await dockercompose.backup('a', 'b');
        expect(mockLog.warn).toHaveBeenCalledWith(expect.stringContaining('Error when trying to backup file'));
    });

    test('writeComposeFile logs error on failure', async () => {
        (fs.writeFile as jest.Mock).mockRejectedValue(new Error('fail'));
        await dockercompose.writeComposeFile('a', 'data');
        expect(mockLog.error).toHaveBeenCalledWith(expect.stringContaining('Error when writing a'));
    });

    test('getComposeFile reads file', async () => {
        (fs.readFile as jest.Mock).mockResolvedValue(Buffer.from('abc'));
        dockercompose.configuration.file = 'abc.yml';
        const buf = await dockercompose.getComposeFile();
        expect(fs.readFile).toHaveBeenCalledWith('abc.yml');
        expect(buf).toBeInstanceOf(Buffer);
    });

    test('getComposeFileAsObject parses yaml', async () => {
        (fs.readFile as jest.Mock).mockResolvedValue(Buffer.from('services: {}'));
        (yaml.parse as jest.Mock).mockReturnValue({ services: {} });
        const obj = await dockercompose.getComposeFileAsObject();
        expect(obj).toHaveProperty('services');
    });
});
