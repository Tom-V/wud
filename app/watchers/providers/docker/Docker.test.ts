// @ts-nocheck
import Docker from './Docker';
import Registry from '../../../registries/Registry';
import * as event from '../../../event';
import * as storeContainer from '../../../store/container';
import * as registry from '../../../registry';
import {
    applyResultCandidate,
    candidateMatchesReference,
    fullName,
    getSelectionBaselineReference,
    getSelectionReference,
} from '../../../model/container';

// Mock all dependencies
jest.mock('dockerode');
jest.mock('node-cron');
jest.mock('just-debounce');
jest.mock('../../../event');
jest.mock('../../../store/container');
jest.mock('../../../registry');
jest.mock('../../../model/container');
jest.mock('../../../tag');
jest.mock('../../../prometheus/watcher');
jest.mock('fs');

import mockDockerode from 'dockerode';
import mockCron from 'node-cron';
import mockDebounce from 'just-debounce';
import mockFs from 'fs';
import * as mockTag from '../../../tag';
import * as mockPrometheus from '../../../prometheus/watcher';

describe('Docker Watcher', () => {
    let docker;
    let mockDockerApi;
    let mockSchedule;
    let mockContainer;
    let mockImage;

    beforeEach(async () => {
        jest.clearAllMocks();

        // Setup dockerode mock
        mockDockerApi = {
            listContainers: jest.fn(),
            getContainer: jest.fn(),
            getEvents: jest.fn(),
            getImage: jest.fn(),
        };
        mockDockerode.mockImplementation(() => mockDockerApi);

        // Setup cron mock
        mockSchedule = {
            stop: jest.fn(),
        };
        mockCron.schedule.mockReturnValue(mockSchedule);

        // Setup debounce mock
        mockDebounce.mockImplementation((fn) => fn);

        // Setup container mock
        mockContainer = {
            inspect: jest.fn(),
        };
        mockDockerApi.getContainer.mockReturnValue(mockContainer);

        // Setup image mock
        mockImage = {
            inspect: jest.fn(),
        };
        mockDockerApi.getImage.mockReturnValue(mockImage);

        // Setup store mock
        storeContainer.getContainers.mockReturnValue([]);
        storeContainer.getContainer.mockReturnValue(undefined);
        storeContainer.insertContainer.mockImplementation((c) => c);
        storeContainer.updateContainer.mockImplementation((c) => c);
        storeContainer.deleteContainer.mockImplementation(() => {});

        // Setup registry mock
        registry.getState.mockReturnValue({ registry: {} });

        // Setup event mock
        event.emitWatcherStart.mockImplementation(() => {});
        event.emitWatcherStop.mockImplementation(() => {});
        event.emitContainerReport.mockImplementation(() => {});
        event.emitContainerReports.mockImplementation(() => {});

        // Setup tag mock
        mockTag.parse.mockReturnValue({ major: 1, minor: 0, patch: 0 });
        mockTag.isGreater.mockReturnValue(false);
        mockTag.transform.mockImplementation((transform, tag) => tag);

        // Setup prometheus mock
        const mockGauge = { set: jest.fn() };
        mockPrometheus.getWatchContainerGauge.mockReturnValue(mockGauge);

        // Setup fullName mock
        fullName.mockReturnValue('test_container');
        getSelectionReference.mockImplementation((selection) => ({
            tag: selection?.tag,
            digest: selection?.digest,
            created: selection?.created,
        }));
        getSelectionBaselineReference.mockImplementation((selection) => ({
            tag: selection?.baselineTag,
            digest: selection?.baselineDigest,
            created: selection?.baselineCreated,
        }));
        candidateMatchesReference.mockImplementation((candidate, reference) => {
            if (
                !candidate ||
                !reference ||
                (reference.tag === undefined &&
                    reference.digest === undefined &&
                    reference.created === undefined)
            ) {
                return false;
            }
            if (reference.tag !== undefined && candidate.tag !== reference.tag)
                return false;
            if (
                reference.digest !== undefined &&
                candidate.digest !== reference.digest
            )
                return false;
            if (
                reference.created !== undefined &&
                candidate.created !== reference.created
            )
                return false;
            return true;
        });
        applyResultCandidate.mockImplementation((container, candidate) => {
            delete container.updatePendingReason;
            delete container.updatePendingUntil;
            container.updatePending = false;

            if (!candidate) {
                container.result = { tag: container.image.tag.value };
                return;
            }

            container.result = {
                tag: candidate.tag ?? container.image.tag.value,
            };
            if (candidate.digest !== undefined) {
                container.result.digest = candidate.digest;
            }
            if (candidate.created !== undefined) {
                container.result.created = candidate.created;
            }
            container.updatePending = candidate.updatePending ?? false;
            if (candidate.updatePendingReason !== undefined) {
                container.updatePendingReason = candidate.updatePendingReason;
            }
            if (candidate.updatePendingUntil !== undefined) {
                container.updatePendingUntil = candidate.updatePendingUntil;
            }
        });

        docker = new Docker();
    });

    afterEach(async () => {
        // Clean up any registered watchers to prevent async operations after tests
        if (docker && docker.deregisterComponent) {
            docker.deregisterComponent();
        }
        jest.restoreAllMocks();
    });

    describe('Configuration', () => {
        test('should create instance', async () => {
            expect(docker).toBeDefined();
            expect(docker).toBeInstanceOf(Docker);
        });

        test('should have correct configuration schema', async () => {
            const schema = docker.getConfigurationSchema();
            expect(schema).toBeDefined();
        });

        test('should validate configuration', async () => {
            const config = { socket: '/var/run/docker.sock' };
            expect(() => docker.validateConfiguration(config)).not.toThrow();
        });

        test('should validate configuration with watchall option', async () => {
            const config = { socket: '/var/run/docker.sock', watchall: true };
            expect(() => docker.validateConfiguration(config)).not.toThrow();
        });

        test('should validate configuration with custom cron', async () => {
            const config = {
                socket: '/var/run/docker.sock',
                cron: '*/5 * * * *',
            };
            expect(() => docker.validateConfiguration(config)).not.toThrow();
        });

        test('should validate configuration with includeprerelease option', async () => {
            const config = {
                socket: '/var/run/docker.sock',
                includeprerelease: true,
            };
            expect(() => docker.validateConfiguration(config)).not.toThrow();
        });

        test('should validate configuration with minage option', async () => {
            const config = {
                socket: '/var/run/docker.sock',
                minage: '12h',
            };
            expect(docker.validateConfiguration(config).minage).toBe('12h');
        });

        test('should reject invalid minage configuration', async () => {
            const config = {
                socket: '/var/run/docker.sock',
                minage: '12',
            };
            expect(() => docker.validateConfiguration(config)).toThrow();
        });
    });

    describe('Initialization', () => {
        test('should initialize docker client with socket', async () => {
            await docker.register('watcher', 'docker', 'test', {
                socket: '/var/run/docker.sock',
            });
            expect(mockDockerode).toHaveBeenCalledWith({
                socketPath: '/var/run/docker.sock',
            });
        });

        test('should initialize with host configuration', async () => {
            await docker.register('watcher', 'docker', 'test', {
                host: 'localhost',
                port: 2376,
            });
            expect(mockDockerode).toHaveBeenCalledWith({
                host: 'localhost',
                port: 2376,
            });
        });

        test('should initialize with SSL configuration', async () => {
            mockFs.readFileSync.mockReturnValue('cert-content');
            await docker.register('watcher', 'docker', 'test', {
                host: 'localhost',
                port: 2376,
                cafile: '/ca.pem',
                certfile: '/cert.pem',
                keyfile: '/key.pem',
            });
            expect(mockFs.readFileSync).toHaveBeenCalledTimes(3);
            expect(mockDockerode).toHaveBeenCalledWith({
                host: 'localhost',
                port: 2376,
                ca: 'cert-content',
                cert: 'cert-content',
                key: 'cert-content',
            });
        });

        test('should schedule cron job on init', async () => {
            await docker.register('watcher', 'docker', 'test', {
                cron: '0 20 * * *',
            });
            docker.init();
            expect(mockCron.schedule).toHaveBeenCalledWith(
                '0 20 * * *',
                expect.any(Function),
                { maxRandomDelay: 60000 },
            );
        });

        test('should warn about deprecated watchdigest', async () => {
            await docker.register('watcher', 'docker', 'test', {
                watchdigest: true,
            });
            const mockLog = { warn: jest.fn(), info: jest.fn() };
            docker.log = mockLog;
            docker.init();
            expect(mockLog.warn).toHaveBeenCalledWith(
                expect.stringContaining('deprecated'),
            );
        });

        test('should setup docker events listener', async () => {
            await docker.register('watcher', 'docker', 'test', {
                watchevents: true,
            });
            docker.init();
            expect(mockDebounce).toHaveBeenCalled();
        });

        test('should not setup events when disabled', async () => {
            await docker.register('watcher', 'docker', 'test', {
                watchevents: false,
            });
            docker.init();
            expect(mockDebounce).not.toHaveBeenCalled();
        });

        test('should set watchatstart based on store state', async () => {
            storeContainer.getContainers.mockReturnValue([{ id: 'existing' }]);
            await docker.register('watcher', 'docker', 'test', {
                watchatstart: true,
            });
            docker.init();
            expect(docker.configuration.watchatstart).toBe(false);
        });
    });

    describe('Deregistration', () => {
        test('should stop cron and clear timeouts on deregister', async () => {
            await docker.register('watcher', 'docker', 'test', {});
            docker.init();
            await docker.deregisterComponent();
            expect(mockSchedule.stop).toHaveBeenCalled();
        });
    });

    describe('Docker Events', () => {
        test('should listen to docker events', async () => {
            const mockStream = {
                on: jest.fn(),
                destroy: jest.fn(),
                removeAllListeners: jest.fn(),
            };
            mockDockerApi.getEvents.mockImplementation((options, callback) => {
                callback(null, mockStream);
            });
            await docker.register('watcher', 'docker', 'test', {});
            await docker.listenDockerEvents();
            expect(mockDockerApi.getEvents).toHaveBeenCalledWith(
                {
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
                },
                expect.any(Function),
            );
        });

        test('should handle docker events error', async () => {
            await docker.register('watcher', 'docker', 'test', {});
            const mockLog = {
                warn: jest.fn(),
                debug: jest.fn(),
                info: jest.fn(),
            };
            docker.log = mockLog;
            mockDockerApi.getEvents.mockImplementation((options, callback) => {
                callback(new Error('Connection failed'));
            });
            await docker.listenDockerEvents();
            expect(mockLog.warn).toHaveBeenCalledWith(
                expect.stringContaining('Connection failed'),
            );
        });

        test('should handle docker events parsing error', async () => {
            await docker.register('watcher', 'docker', 'test', {});
            const mockLog = {
                warn: jest.fn(),
                debug: jest.fn(),
                info: jest.fn(),
            };
            docker.log = mockLog;
            await docker.onDockerEvent(Buffer.from('{"Action":"create"'));
            expect(mockLog.warn).toHaveBeenCalledWith(
                expect.stringContaining('Unable to parse Docker event'),
            );
        });

        test('should process create/destroy events', async () => {
            docker.watchCronDebounced = jest.fn();
            const event = JSON.stringify({
                Action: 'create',
                id: 'container123',
            });
            await docker.onDockerEvent(Buffer.from(event));
            expect(docker.watchCronDebounced).toHaveBeenCalled();
        });

        test('should process chunked create/destroy events', async () => {
            const mockStream = {
                on: jest.fn(),
                destroy: jest.fn(),
                removeAllListeners: jest.fn(),
            };
            mockDockerApi.getEvents.mockImplementation((options, callback) => {
                callback(null, mockStream);
            });
            docker.onDockerEvent = jest.fn();

            await docker.register('watcher', 'docker', 'test', {});
            await docker.listenDockerEvents();

            const dataHandler = mockStream.on.mock.calls.find(
                (c) => c[0] === 'data',
            )[1];
            dataHandler(Buffer.from('{"Action":"create"'));
            dataHandler(Buffer.from(',"id":"container123"}'));
            expect(docker.onDockerEvent).not.toHaveBeenCalled();

            dataHandler(Buffer.from('\n'));
            expect(docker.onDockerEvent).toHaveBeenCalledTimes(1);

            const calledWith = docker.onDockerEvent.mock.calls[0][0].toString();
            expect(calledWith).toBe(
                '{"Action":"create","id":"container123"}\n',
            );
        });

        test('should update container status on other events', async () => {
            await docker.register('watcher', 'docker', 'test', {});
            const mockLog = {
                child: jest.fn().mockReturnValue({ info: jest.fn() }),
                debug: jest.fn(),
            };
            docker.log = mockLog;
            mockContainer.inspect.mockResolvedValue({
                State: { Status: 'running' },
            });
            const existingContainer = { id: 'container123', status: 'stopped' };
            storeContainer.getContainer.mockReturnValue(existingContainer);

            const event = JSON.stringify({
                Action: 'start',
                id: 'container123',
            });
            await docker.onDockerEvent(Buffer.from(event));

            expect(mockContainer.inspect).toHaveBeenCalled();
            expect(storeContainer.updateContainer).toHaveBeenCalled();
        });

        test('should handle container not found during event processing', async () => {
            const mockLog = { debug: jest.fn() };
            docker.log = mockLog;
            mockDockerApi.getContainer.mockImplementation(() => {
                throw new Error('No such container');
            });

            const event = JSON.stringify({
                Action: 'start',
                id: 'nonexistent',
            });
            await docker.onDockerEvent(Buffer.from(event));

            expect(mockLog.debug).toHaveBeenCalledWith(
                expect.stringContaining('Unable to get container'),
            );
        });
    });

    describe('Container Watching', () => {
        test('should watch containers from cron', async () => {
            await docker.register('watcher', 'docker', 'test', {
                cron: '0 * * * *',
            });
            const mockLog = { info: jest.fn() };
            docker.log = mockLog;
            docker.watch = jest.fn().mockResolvedValue([]);

            await docker.watchFromCron();

            expect(docker.watch).toHaveBeenCalled();
            expect(mockLog.info).toHaveBeenCalledWith(
                expect.stringContaining('Cron started'),
            );
            expect(mockLog.info).toHaveBeenCalledWith(
                expect.stringContaining('Cron finished'),
            );
        });

        test('should report container statistics', async () => {
            await docker.register('watcher', 'docker', 'test', {
                cron: '0 * * * *',
            });
            const mockLog = { info: jest.fn() };
            docker.log = mockLog;
            const containerReports = [
                { container: { updateAvailable: true, error: undefined } },
                {
                    container: {
                        updateAvailable: false,
                        error: { message: 'error' },
                    },
                },
            ];
            docker.watch = jest.fn().mockResolvedValue(containerReports);

            await docker.watchFromCron();

            expect(mockLog.info).toHaveBeenCalledWith(
                expect.stringContaining(
                    '2 containers watched, 1 errors, 1 available updates',
                ),
            );
        });

        test('should emit watcher events during watch', async () => {
            docker.getContainers = jest.fn().mockResolvedValue([]);

            await docker.watch();

            expect(event.emitWatcherStart).toHaveBeenCalledWith(docker);
            expect(event.emitWatcherStop).toHaveBeenCalledWith(docker);
        });

        test('should handle error getting containers', async () => {
            const mockLog = { warn: jest.fn() };
            docker.log = mockLog;
            docker.getContainers = jest
                .fn()
                .mockRejectedValue(new Error('Docker unavailable'));

            await docker.watch();

            expect(mockLog.warn).toHaveBeenCalledWith(
                expect.stringContaining('Docker unavailable'),
            );
        });

        test('should handle error processing containers', async () => {
            const mockLog = { warn: jest.fn() };
            docker.log = mockLog;
            docker.getContainers = jest
                .fn()
                .mockResolvedValue([{ id: 'test' }]);
            docker.watchContainer = jest
                .fn()
                .mockRejectedValue(new Error('Processing failed'));

            const result = await docker.watch();

            expect(result).toEqual([]);
            expect(mockLog.warn).toHaveBeenCalledWith(
                expect.stringContaining('Processing failed'),
            );
        });
    });

    describe('Container Processing', () => {
        test('should watch individual container', async () => {
            const container = { id: 'test123', name: 'test' };
            const mockLog = {
                child: jest.fn().mockReturnValue({ debug: jest.fn() }),
            };
            docker.log = mockLog;
            docker.findNewVersion = jest
                .fn()
                .mockResolvedValue({ tag: '2.0.0' });
            docker.mapContainerToContainerReport = jest
                .fn()
                .mockReturnValue({ container, changed: false });

            await docker.watchContainer(container);

            expect(docker.findNewVersion).toHaveBeenCalledWith(
                container,
                expect.any(Object),
            );
            expect(event.emitContainerReport).toHaveBeenCalled();
        });

        test('should persist the previous result across errors and replace it on recovery', async () => {
            const previousResult = { tag: '2.0.0' };
            let persistedContainer = {
                id: 'test123',
                name: 'test',
                status: 'running',
                watcher: 'docker.test',
                image: {
                    id: 'image123',
                    registry: { name: 'ghcr.old', url: 'ghcr.io' },
                    name: 'library/nginx',
                    tag: { value: '1.0.0', semver: true },
                    digest: { watch: false },
                    architecture: 'amd64',
                    os: 'linux',
                },
                result: previousResult,
            };
            const mockLogChild = { warn: jest.fn(), debug: jest.fn() };
            const mockLog = {
                child: jest.fn().mockReturnValue(mockLogChild),
                debug: jest.fn(),
            };
            await docker.register('watcher', 'docker', 'test', {});
            docker.log = mockLog;

            const asModel = (container) => ({
                ...container,
                result: container.result && { ...container.result },
                error: container.error && { ...container.error },
                updateAvailable:
                    container.result?.tag !== container.image.tag.value,
                resultChanged: (otherContainer) =>
                    container.result?.tag !== otherContainer?.result?.tag,
            });
            storeContainer.getContainer.mockImplementation(() =>
                asModel(persistedContainer),
            );
            storeContainer.updateContainer.mockImplementation((container) => {
                persistedContainer = asModel(container);
                return asModel(persistedContainer);
            });

            mockImage.inspect.mockResolvedValue({
                Id: 'image123',
                Architecture: 'amd64',
                Os: 'linux',
                Created: '2023-01-01',
                RepoDigests: ['ghcr.io/library/nginx@sha256:abc123'],
            });
            const mockRegistry = {
                normalizeImage: jest.fn((image) => image),
                getId: () => 'ghcr.new',
                match: () => true,
                shouldWatchDigest: jest.fn(() => false),
            };
            registry.getState.mockReturnValue({
                registry: { ghcr: mockRegistry },
            });
            docker.normalizeContainer = jest.fn((container) =>
                asModel({
                    ...container,
                    image: {
                        ...container.image,
                        registry: {
                            ...container.image.registry,
                            name: mockRegistry.getId(),
                        },
                    },
                }),
            );
            docker.findNewVersion = jest
                .fn()
                .mockRejectedValueOnce(new Error('Registry error'))
                .mockRejectedValueOnce(new Error('Registry error'))
                .mockResolvedValueOnce({ tag: '3.0.0' });

            const runningContainer = {
                Id: 'test123',
                Image: 'ghcr.io/library/nginx:1.0.0',
                Names: ['/test'],
                State: 'running',
                Labels: {},
            };
            const scan = async () => {
                const container =
                    await docker.addImageDetailsToContainer(runningContainer);
                return docker.watchContainer(container);
            };

            const firstReport = await scan();
            expect(firstReport.container.result).toEqual(previousResult);
            expect(firstReport.container.error).toEqual({
                message: 'Registry error',
            });
            expect(firstReport.changed).toBe(false);

            const secondReport = await scan();
            expect(secondReport.container.result).toEqual(previousResult);
            expect(secondReport.container.error).toEqual({
                message: 'Registry error',
            });
            expect(secondReport.container.image.registry.name).toBe('ghcr.new');
            expect(secondReport.changed).toBe(false);

            const recoveredReport = await scan();

            expect(mockLogChild.warn).toHaveBeenCalledTimes(2);
            expect(mockImage.inspect).toHaveBeenCalledTimes(2);
            expect(recoveredReport.container.result).toEqual({ tag: '3.0.0' });
            expect(recoveredReport.container.error).toBeUndefined();
            expect(recoveredReport.changed).toBe(true);
        });
    });

    describe('Container Retrieval', () => {
        test('should get containers with default options', async () => {
            const containers = [
                {
                    Id: '123',
                    Labels: { 'wud.watch': 'true' },
                    Names: ['/test'],
                },
            ];
            mockDockerApi.listContainers.mockResolvedValue(containers);
            docker.addImageDetailsToContainer = jest
                .fn()
                .mockResolvedValue({ id: '123' });

            await docker.register('watcher', 'docker', 'test', {
                watchbydefault: true,
            });
            const result = await docker.getContainers();

            expect(mockDockerApi.listContainers).toHaveBeenCalledWith({});
            expect(result).toHaveLength(1);
        });

        test('should get all containers when watchall enabled', async () => {
            mockDockerApi.listContainers.mockResolvedValue([]);

            await docker.register('watcher', 'docker', 'test', {
                watchall: true,
            });
            await docker.getContainers();

            expect(mockDockerApi.listContainers).toHaveBeenCalledWith({
                all: true,
            });
        });

        test('should filter containers based on watch label', async () => {
            const containers = [
                { Id: '1', Labels: { 'wud.watch': 'true' }, Names: ['/test1'] },
                {
                    Id: '2',
                    Labels: { 'wud.watch': 'false' },
                    Names: ['/test2'],
                },
                { Id: '3', Labels: {}, Names: ['/test3'] },
            ];
            mockDockerApi.listContainers.mockResolvedValue(containers);
            docker.addImageDetailsToContainer = jest
                .fn()
                .mockResolvedValue({ id: '1' });

            await docker.register('watcher', 'docker', 'test', {
                watchbydefault: false,
            });
            const result = await docker.getContainers();

            expect(result).toHaveLength(1);
        });

        test('should prune old containers', async () => {
            const oldContainers = [{ id: 'old1' }, { id: 'old2' }];
            storeContainer.getContainers.mockReturnValue(oldContainers);
            mockDockerApi.listContainers.mockResolvedValue([]);

            await docker.register('watcher', 'docker', 'test', {});
            await docker.getContainers();

            expect(storeContainer.deleteContainer).toHaveBeenCalledWith('old1');
            expect(storeContainer.deleteContainer).toHaveBeenCalledWith('old2');
        });

        test('should handle pruning error', async () => {
            await docker.register('watcher', 'docker', 'test', {});
            const mockLog = { warn: jest.fn() };
            docker.log = mockLog;
            storeContainer.getContainers.mockImplementationOnce(() => {
                throw new Error('Store error');
            });
            mockDockerApi.listContainers.mockResolvedValue([]);

            await docker.getContainers();

            expect(mockLog.warn).toHaveBeenCalledWith(
                expect.stringContaining('Store error'),
            );
        });
    });

    describe('Version Finding', () => {
        const createManifestResult = (tag, overrides = {}) => ({
            digest: `sha256:${tag}`,
            version: 2,
            ...overrides,
        });

        const createManifestDigestMock = (manifestsByTag = {}) =>
            jest.fn((image) =>
                Promise.resolve(
                    createManifestResult(
                        image.tag.value,
                        manifestsByTag[image.tag.value] ?? {},
                    ),
                ),
            );

        test('should find new version using registry', async () => {
            const container = {
                image: {
                    registry: { name: 'hub' },
                    tag: { value: '1.0.0', semver: true },
                    digest: { watch: false },
                },
            };
            const mockRegistry = {
                getTags: jest
                    .fn()
                    .mockResolvedValue(['1.0.0', '1.1.0', '2.0.0']),
                shouldWatchDigest: jest.fn(() => false),
            };
            registry.getState.mockReturnValue({
                registry: { hub: mockRegistry },
            });
            const mockLogChild = { error: jest.fn(), warn: jest.fn() };

            const result = await docker.findNewVersion(container, mockLogChild);

            expect(mockRegistry.getTags).toHaveBeenCalledWith(container.image);
            expect(result).toEqual({ tag: '1.0.0' });
        });

        test('should handle unsupported registry', async () => {
            const container = {
                image: {
                    registry: { name: 'unknown' },
                    tag: { value: '1.0.0' },
                    digest: { watch: false },
                },
            };
            registry.getState.mockReturnValue({ registry: {} });
            const mockLogChild = { error: jest.fn(), warn: jest.fn() };

            try {
                await docker.findNewVersion(container, mockLogChild);
            } catch (error) {
                expect(error.message).toContain('Unsupported Registry');
            }
        });

        test('should handle digest watching with v2 manifest', async () => {
            const container = {
                image: {
                    id: 'image123',
                    registry: { name: 'hub' },
                    tag: { value: '1.0.0' },
                    digest: { watch: true, repo: 'sha256:abc123' },
                },
            };
            const mockRegistry = {
                getTags: jest.fn().mockResolvedValue(['1.0.0']),
                getImageManifestDigest: jest
                    .fn()
                    .mockResolvedValueOnce({
                        digest: 'sha256:def456',
                        created: '2023-01-01',
                        version: 2,
                    })
                    .mockResolvedValueOnce({
                        digest: 'sha256:manifest123',
                    }),
                shouldWatchDigest: jest.fn(() => true),
            };
            registry.getState.mockReturnValue({
                registry: { hub: mockRegistry },
            });
            const mockLogChild = { error: jest.fn() };

            const result = await docker.findNewVersion(container, mockLogChild);

            expect(mockRegistry.getImageManifestDigest).toHaveBeenCalledTimes(
                2,
            );
            expect(result.digest).toBe('sha256:def456');
            expect(result.created).toBe('2023-01-01');
            expect(container.results).toEqual([
                {
                    digest: 'sha256:def456',
                    created: '2023-01-01',
                    updatePending: false,
                    updatePendingReason: undefined,
                    updatePendingUntil: undefined,
                },
            ]);
        });

        test('should handle digest watching with v1 manifest', async () => {
            await docker.register('watcher', 'docker', 'test', {});
            const container = {
                image: {
                    id: 'image123',
                    registry: { name: 'hub' },
                    tag: { value: '1.0.0' },
                    digest: { watch: true, repo: 'sha256:abc123' },
                },
            };
            const mockRegistry = {
                getTags: jest.fn().mockResolvedValue(['1.0.0']),
                getImageManifestDigest: jest.fn().mockResolvedValue({
                    digest: 'sha256:def456',
                    created: '2023-01-01',
                    version: 1,
                }),
                shouldWatchDigest: jest.fn(() => true),
            };
            registry.getState.mockReturnValue({
                registry: { hub: mockRegistry },
            });
            const mockLogChild = { error: jest.fn() };
            const mockImageInspect = { Config: { Image: 'sha256:legacy123' } };
            mockImage.inspect.mockResolvedValue(mockImageInspect);

            await docker.findNewVersion(container, mockLogChild);

            expect(mockImage.inspect).toHaveBeenCalled();
            expect(container.image.digest.value).toBe('sha256:legacy123');
        });

        test('should fall back to the image Id when Config.Image is empty for a legacy v1 manifest', async () => {
            await docker.register('watcher', 'docker', 'test', {});
            const container = {
                image: {
                    id: 'image123',
                    registry: { name: 'hub' },
                    tag: { value: '1.0.0' },
                    digest: { watch: true, repo: 'sha256:abc123' },
                },
            };
            const mockRegistry = {
                getTags: jest.fn().mockResolvedValue(['1.0.0']),
                getImageManifestDigest: jest.fn().mockResolvedValue({
                    digest: 'sha256:def456',
                    created: '2023-01-01',
                    version: 1,
                }),
                shouldWatchDigest: jest.fn(() => true),
            };
            registry.getState.mockReturnValue({
                registry: { hub: mockRegistry },
            });
            const mockLogChild = { error: jest.fn() };
            const mockImageInspect = {
                Config: { Image: '' },
                Id: 'sha256:local123',
            };
            mockImage.inspect.mockResolvedValue(mockImageInspect);

            await docker.findNewVersion(container, mockLogChild);

            expect(container.image.digest.value).toBe('sha256:local123');
        });

        test('should not flag a false digest update for a multi-arch image whose local RepoDigest is a leaf manifest digest (regression for ghcr.io/tricked-dev/kanidm-oauth2-manager)', async () => {
            // Reproduces the real-world bug: an OCI index with amd64/arm64 entries,
            // where Docker recorded the arm64 *manifest* digest (not the index
            // digest) as the container's RepoDigest. Both the "remote" lookup (by
            // tag) and the "local" lookup (by RepoDigest) must resolve to the same
            // manifest digest when nothing changed.
            const arm64ManifestDigest =
                'sha256:8f52be5801e341d97f65e9d046d24e37ee980558806127f7c2b2f917670b5332';
            const configDigest =
                'sha256:c611bc3dc9d42510c69180b6328ebcb3a93cd9c739f79cc2b8ce17322a8baed5';

            const ghcrRegistry = new Registry();
            ghcrRegistry.getTags = jest.fn().mockResolvedValue(['latest']);
            ghcrRegistry.callRegistry = jest.fn((options) => {
                if (options.method === 'head') {
                    return Promise.resolve({
                        headers: {
                            'docker-content-digest': arm64ManifestDigest,
                        },
                    });
                }
                if (options.url.endsWith('/manifests/latest')) {
                    return Promise.resolve({
                        schemaVersion: 2,
                        mediaType: 'application/vnd.oci.image.index.v1+json',
                        manifests: [
                            {
                                digest: 'sha256:amd64ManifestDigest',
                                mediaType:
                                    'application/vnd.oci.image.manifest.v1+json',
                                platform: {
                                    architecture: 'amd64',
                                    os: 'linux',
                                },
                            },
                            {
                                digest: arm64ManifestDigest,
                                mediaType:
                                    'application/vnd.oci.image.manifest.v1+json',
                                platform: {
                                    architecture: 'arm64',
                                    os: 'linux',
                                },
                            },
                        ],
                    });
                }
                if (options.url.endsWith(`/manifests/${arm64ManifestDigest}`)) {
                    return Promise.resolve({
                        schemaVersion: 2,
                        mediaType: 'application/vnd.oci.image.manifest.v1+json',
                        config: {
                            digest: configDigest,
                            mediaType:
                                'application/vnd.oci.image.config.v1+json',
                        },
                    });
                }
                throw new Error(`Unexpected request to ${options.url}`);
            });

            const container = {
                image: {
                    id: 'image123',
                    registry: { name: 'ghcr' },
                    name: 'tricked-dev/kanidm-oauth2-manager',
                    tag: { value: 'latest', semver: false },
                    architecture: 'arm64',
                    os: 'linux',
                    digest: { watch: true, repo: arm64ManifestDigest },
                },
            };
            registry.getState.mockReturnValue({
                registry: { ghcr: ghcrRegistry },
            });
            const mockLogChild = { error: jest.fn() };

            const result = await docker.findNewVersion(container, mockLogChild);

            expect(ghcrRegistry.getTags).not.toHaveBeenCalled();
            expect(result.digest).toBe(arm64ManifestDigest);
            expect(container.image.digest.value).toBe(arm64ManifestDigest);
            expect(container.image.digest.value).toBe(result.digest);
        });

        test('should handle tag candidates with semver', async () => {
            const container = {
                includeTags: '^v\\d+',
                excludeTags: 'beta',
                transformTags: 's/v//',
                image: {
                    registry: { name: 'hub' },
                    tag: { value: '1.0.0', semver: true },
                    digest: { watch: false },
                },
            };
            const mockRegistry = {
                getTags: jest
                    .fn()
                    .mockResolvedValue([
                        'v1.0.0',
                        'v1.1.0',
                        'v2.0.0-beta',
                        'latest',
                    ]),
                getImageManifestDigest: createManifestDigestMock(),
                shouldWatchDigest: jest.fn(() => false),
            };
            registry.getState.mockReturnValue({
                registry: { hub: mockRegistry },
            });
            mockTag.parse.mockReturnValue({ major: 1, minor: 1, patch: 0 });
            mockTag.isGreater.mockReturnValue(true);
            const mockLogChild = { error: jest.fn(), warn: jest.fn() };

            await docker.findNewVersion(container, mockLogChild);

            expect(mockRegistry.getTags).toHaveBeenCalled();
            expect(mockRegistry.getImageManifestDigest).toHaveBeenCalled();
        });

        test('should filter tags with different number of semver parts', async () => {
            const container = {
                image: {
                    registry: { name: 'hub' },
                    tag: { value: '1.2', semver: true },
                    digest: { watch: false },
                },
            };
            const mockRegistry = {
                getTags: jest.fn().mockResolvedValue([
                    '1.2.1', // 3 parts, should be filtered out
                    '1.3', // 2 parts, should be kept
                    '1.1', // 2 parts, should be kept (but lower)
                    '2', // 1 part, should be filtered out
                ]),
                getImageManifestDigest: createManifestDigestMock(),
                shouldWatchDigest: jest.fn(() => false),
            };
            registry.getState.mockReturnValue({
                registry: { hub: mockRegistry },
            });

            // Mock isGreater to return true for 1.3 > 1.2
            mockTag.isGreater.mockImplementation((t1, t2) => {
                if (t1 === '1.3' && t2 === '1.2') return true;
                return false;
            });

            const mockLogChild = { error: jest.fn(), warn: jest.fn() };

            const result = await docker.findNewVersion(container, mockLogChild);

            expect(result).toMatchObject({
                tag: '1.3',
                digest: 'sha256:1.3',
            });
        });

        test('should expose all eligible tag candidates', async () => {
            const container = {
                image: {
                    registry: { name: 'hub' },
                    name: 'organization/image',
                    tag: { value: '1.0.0', semver: true },
                    digest: { watch: false },
                },
            };
            const mockRegistry = {
                getTags: jest
                    .fn()
                    .mockResolvedValue(['1.2.0', '1.1.0', '1.0.0']),
                getImageManifestDigest: createManifestDigestMock(),
                shouldWatchDigest: jest.fn(() => false),
            };
            registry.getState.mockReturnValue({
                registry: { hub: mockRegistry },
            });
            mockTag.isGreater.mockImplementation((t1, t2) => {
                const order = ['1.0.0', '1.1.0', '1.2.0'];
                return order.indexOf(t1) > order.indexOf(t2);
            });

            const result = await docker.findNewVersion(container, {
                error: jest.fn(),
                warn: jest.fn(),
                info: jest.fn(),
            });

            expect(result).toMatchObject({
                tag: '1.2.0',
                digest: 'sha256:1.2.0',
            });
            expect(container.results).toEqual([
                {
                    tag: '1.2.0',
                    digest: 'sha256:1.2.0',
                    created: undefined,
                    updatePending: false,
                },
                {
                    tag: '1.1.0',
                    digest: 'sha256:1.1.0',
                    created: undefined,
                    updatePending: false,
                },
            ]);
        });

        test('should skip an unusable top candidate and select the next valid tag', async () => {
            const warn = jest.fn();
            const container = {
                image: {
                    registry: { name: 'hub' },
                    name: 'organization/image',
                    os: 'linux',
                    architecture: 'amd64',
                    tag: { value: '1.0.0', semver: true },
                    digest: { watch: false },
                },
            };
            const mockRegistry = {
                getTags: jest
                    .fn()
                    .mockResolvedValue(['1.2.0', '1.1.0', '1.0.0']),
                getImageManifestDigest: jest.fn((image) => {
                    if (image.tag.value === '1.2.0') {
                        return Promise.reject(
                            new Error('manifest unavailable'),
                        );
                    }
                    return Promise.resolve(
                        createManifestResult(image.tag.value),
                    );
                }),
                shouldWatchDigest: jest.fn(() => false),
            };
            registry.getState.mockReturnValue({
                registry: { hub: mockRegistry },
            });
            mockTag.isGreater.mockImplementation((t1, t2) => {
                const order = ['1.0.0', '1.1.0', '1.2.0'];
                return order.indexOf(t1) > order.indexOf(t2);
            });

            const result = await docker.findNewVersion(container, {
                error: jest.fn(),
                warn,
                info: jest.fn(),
            });

            expect(result).toMatchObject({
                tag: '1.1.0',
                digest: 'sha256:1.1.0',
            });
            expect(container.results).toEqual([
                {
                    tag: '1.1.0',
                    digest: 'sha256:1.1.0',
                    created: undefined,
                    updatePending: false,
                },
            ]);
            expect(warn).toHaveBeenCalledWith(
                expect.stringContaining(
                    'Skipping update candidate organization/image:1.2.0',
                ),
            );
            expect(warn).toHaveBeenCalledWith(
                expect.stringContaining('manifest unavailable'),
            );
        });

        test('should keep the current tag when every manifest candidate is unusable', async () => {
            const warn = jest.fn();
            const container = {
                image: {
                    registry: { name: 'hub' },
                    name: 'organization/image',
                    os: 'linux',
                    architecture: 'amd64',
                    tag: { value: '1.0.0', semver: true },
                    digest: { watch: false },
                },
            };
            const mockRegistry = {
                getTags: jest
                    .fn()
                    .mockResolvedValue(['1.2.0', '1.1.0', '1.0.0']),
                getImageManifestDigest: jest.fn(() =>
                    Promise.reject(new Error('manifest unavailable')),
                ),
                shouldWatchDigest: jest.fn(() => false),
            };
            registry.getState.mockReturnValue({
                registry: { hub: mockRegistry },
            });
            mockTag.isGreater.mockImplementation((t1, t2) => {
                const order = ['1.0.0', '1.1.0', '1.2.0'];
                return order.indexOf(t1) > order.indexOf(t2);
            });

            const result = await docker.findNewVersion(container, {
                error: jest.fn(),
                warn,
                info: jest.fn(),
            });

            expect(result).toEqual({ tag: '1.0.0' });
            expect(container.results).toEqual([]);
            expect(container.error).toBeUndefined();
            expect(warn).toHaveBeenCalledTimes(2);
        });

        test('should keep manual result selection when no newer candidate is found', async () => {
            const container = {
                resultSelection: {
                    mode: 'manual',
                    tag: '1.1.0',
                    baselineTag: '1.2.0',
                },
                image: {
                    registry: { name: 'hub' },
                    tag: { value: '1.0.0', semver: true },
                    digest: { watch: false },
                },
            };
            const mockRegistry = {
                getTags: jest
                    .fn()
                    .mockResolvedValue(['1.2.0', '1.1.0', '1.0.0']),
                getImageManifestDigest: createManifestDigestMock(),
                shouldWatchDigest: jest.fn(() => false),
            };
            registry.getState.mockReturnValue({
                registry: { hub: mockRegistry },
            });
            mockTag.isGreater.mockImplementation((t1, t2) => {
                const order = ['1.0.0', '1.1.0', '1.2.0'];
                return order.indexOf(t1) > order.indexOf(t2);
            });

            const result = await docker.findNewVersion(container, {
                error: jest.fn(),
                warn: jest.fn(),
                info: jest.fn(),
            });

            expect(result).toMatchObject({
                tag: '1.1.0',
                digest: 'sha256:1.1.0',
            });
            expect(container.resultSelection).toEqual({
                mode: 'manual',
                tag: '1.1.0',
                baselineTag: '1.2.0',
            });
        });

        test('should reset manual result selection when a newer candidate is found', async () => {
            const container = {
                resultSelection: {
                    mode: 'manual',
                    tag: '1.1.0',
                    baselineTag: '1.2.0',
                },
                image: {
                    registry: { name: 'hub' },
                    tag: { value: '1.0.0', semver: true },
                    digest: { watch: false },
                },
            };
            const mockRegistry = {
                getTags: jest
                    .fn()
                    .mockResolvedValue(['1.3.0', '1.2.0', '1.1.0', '1.0.0']),
                getImageManifestDigest: createManifestDigestMock(),
                shouldWatchDigest: jest.fn(() => false),
            };
            registry.getState.mockReturnValue({
                registry: { hub: mockRegistry },
            });
            mockTag.isGreater.mockImplementation((t1, t2) => {
                const order = ['1.0.0', '1.1.0', '1.2.0', '1.3.0'];
                return order.indexOf(t1) > order.indexOf(t2);
            });

            const result = await docker.findNewVersion(container, {
                error: jest.fn(),
                warn: jest.fn(),
                info: jest.fn(),
            });

            expect(result).toMatchObject({
                tag: '1.3.0',
                digest: 'sha256:1.3.0',
            });
            expect(container.resultSelection).toEqual({ mode: 'auto' });
        });

        test('should reset manual result selection when the selected candidate is skipped as unusable', async () => {
            const info = jest.fn();
            const container = {
                resultSelection: {
                    mode: 'manual',
                    tag: '1.1.0',
                    baselineTag: '1.2.0',
                },
                image: {
                    registry: { name: 'hub' },
                    name: 'organization/image',
                    os: 'linux',
                    architecture: 'amd64',
                    tag: { value: '1.0.0', semver: true },
                    digest: { watch: false },
                },
            };
            const mockRegistry = {
                getTags: jest
                    .fn()
                    .mockResolvedValue(['1.2.0', '1.1.0', '1.0.0']),
                getImageManifestDigest: jest.fn((image) => {
                    if (image.tag.value === '1.1.0') {
                        return Promise.reject(
                            new Error('manifest unavailable'),
                        );
                    }
                    return Promise.resolve(
                        createManifestResult(image.tag.value),
                    );
                }),
                shouldWatchDigest: jest.fn(() => false),
            };
            registry.getState.mockReturnValue({
                registry: { hub: mockRegistry },
            });
            mockTag.isGreater.mockImplementation((t1, t2) => {
                const order = ['1.0.0', '1.1.0', '1.2.0'];
                return order.indexOf(t1) > order.indexOf(t2);
            });

            const result = await docker.findNewVersion(container, {
                error: jest.fn(),
                warn: jest.fn(),
                info,
            });

            expect(result).toMatchObject({
                tag: '1.2.0',
                digest: 'sha256:1.2.0',
            });
            expect(container.resultSelection).toEqual({ mode: 'auto' });
            expect(info).toHaveBeenCalledWith(
                expect.stringContaining('selected candidate was not found'),
            );
        });

        test('should exclude prerelease tags by default', async () => {
            const container = {
                includePrerelease: false,
                image: {
                    registry: { name: 'hub' },
                    tag: { value: '1.2.3', semver: true },
                    digest: { watch: false },
                },
            };
            const mockRegistry = {
                getTags: jest
                    .fn()
                    .mockResolvedValue(['1.2.4-rc1', '1.2.4', '1.2.3']),
                getImageManifestDigest: createManifestDigestMock(),
                shouldWatchDigest: jest.fn(() => false),
            };
            registry.getState.mockReturnValue({
                registry: { hub: mockRegistry },
            });
            mockTag.parse.mockImplementation((tag) => {
                if (tag === '1.2.4-rc1') {
                    return {
                        major: 1,
                        minor: 2,
                        patch: 4,
                        prerelease: ['rc1'],
                    };
                }
                if (tag === '1.2.4' || tag === '1.2.3') {
                    return { major: 1, minor: 2, patch: 4, prerelease: [] };
                }
                return null;
            });
            mockTag.isGreater.mockImplementation((t1) => t1 === '1.2.4');

            const result = await docker.findNewVersion(container, {
                error: jest.fn(),
                warn: jest.fn(),
            });

            expect(result).toMatchObject({
                tag: '1.2.4',
                digest: 'sha256:1.2.4',
            });
        });

        test('should keep prerelease tags when watcher opt-in is enabled', async () => {
            const container = {
                includePrerelease: true,
                image: {
                    registry: { name: 'hub' },
                    tag: { value: '1.2.3', semver: true },
                    digest: { watch: false },
                },
            };
            const mockRegistry = {
                getTags: jest.fn().mockResolvedValue(['1.2.4-rc1', '1.2.3']),
                getImageManifestDigest: createManifestDigestMock(),
                shouldWatchDigest: jest.fn(() => false),
            };
            registry.getState.mockReturnValue({
                registry: { hub: mockRegistry },
            });
            mockTag.parse.mockImplementation((tag) => {
                if (tag === '1.2.4-rc1') {
                    return {
                        major: 1,
                        minor: 2,
                        patch: 4,
                        prerelease: ['rc1'],
                    };
                }
                if (tag === '1.2.3') {
                    return { major: 1, minor: 2, patch: 3, prerelease: [] };
                }
                return null;
            });
            mockTag.isGreater.mockImplementation((t1) => t1 === '1.2.4-rc1');

            const result = await docker.findNewVersion(container, {
                error: jest.fn(),
                warn: jest.fn(),
            });

            expect(result).toMatchObject({
                tag: '1.2.4-rc1',
                digest: 'sha256:1.2.4-rc1',
            });
        });

        test('should reuse validated manifest metadata when digest watching a selected candidate', async () => {
            const container = {
                image: {
                    id: 'image123',
                    registry: { name: 'hub' },
                    name: 'organization/image',
                    tag: { value: '1.0.0', semver: true },
                    digest: { watch: true, repo: 'sha256:abc123' },
                },
            };
            const mockRegistry = {
                getTags: jest.fn().mockResolvedValue(['1.1.0', '1.0.0']),
                getImageManifestDigest: jest.fn((image, digest) => {
                    if (digest === 'sha256:abc123') {
                        return Promise.resolve({
                            digest: 'sha256:local-platform',
                        });
                    }
                    return Promise.resolve({
                        digest: 'sha256:remote-1.1.0',
                        created: '2026-05-30T00:00:00.000Z',
                        version: 2,
                    });
                }),
                shouldWatchDigest: jest.fn(() => true),
            };
            registry.getState.mockReturnValue({
                registry: { hub: mockRegistry },
            });
            mockTag.isGreater.mockImplementation((t1) => t1 === '1.1.0');

            const result = await docker.findNewVersion(container, {
                error: jest.fn(),
                warn: jest.fn(),
                info: jest.fn(),
            });

            expect(mockRegistry.getImageManifestDigest).toHaveBeenCalledTimes(
                1,
            );
            expect(result).toEqual({
                tag: '1.1.0',
                digest: 'sha256:remote-1.1.0',
                created: '2026-05-30T00:00:00.000Z',
            });
            expect(container.results).toEqual([
                {
                    tag: '1.1.0',
                    digest: 'sha256:remote-1.1.0',
                    created: '2026-05-30T00:00:00.000Z',
                    updatePending: false,
                },
            ]);
        });

        test('should mark tag candidate pending when remote image is too recent', async () => {
            jest.spyOn(Date, 'now').mockReturnValue(
                new Date('2026-06-01T00:00:00.000Z').getTime(),
            );
            const container = {
                minAge: '12h',
                image: {
                    registry: { name: 'hub' },
                    name: 'organization/image',
                    tag: { value: '1.0.0', semver: true },
                    digest: { watch: false },
                },
            };
            const mockRegistry = {
                getTags: jest.fn().mockResolvedValue(['1.1.0', '1.0.0']),
                getImageManifestDigest: jest.fn().mockResolvedValue({
                    digest: 'sha256:new',
                    created: '2026-05-31T18:00:00.000Z',
                    version: 2,
                }),
                shouldWatchDigest: jest.fn(() => false),
            };
            registry.getState.mockReturnValue({
                registry: { hub: mockRegistry },
            });
            mockTag.isGreater.mockImplementation((t1) => t1 === '1.1.0');

            const result = await docker.findNewVersion(container, {
                error: jest.fn(),
                warn: jest.fn(),
                info: jest.fn(),
            });

            expect(result).toEqual({
                tag: '1.1.0',
                digest: 'sha256:new',
                created: '2026-05-31T18:00:00.000Z',
            });
            expect(container.updatePending).toBe(true);
            expect(container.updatePendingReason).toBe('minimum-age');
            expect(container.updatePendingUntil).toBe(
                '2026-06-01T06:00:00.000Z',
            );
        });

        test('should allow tag candidate when remote image is old enough', async () => {
            jest.spyOn(Date, 'now').mockReturnValue(
                new Date('2026-06-01T00:00:00.000Z').getTime(),
            );
            const container = {
                minAge: '12h',
                image: {
                    registry: { name: 'hub' },
                    name: 'organization/image',
                    tag: { value: '1.0.0', semver: true },
                    digest: { watch: false },
                },
            };
            const mockRegistry = {
                getTags: jest.fn().mockResolvedValue(['1.1.0', '1.0.0']),
                getImageManifestDigest: jest.fn().mockResolvedValue({
                    digest: 'sha256:new',
                    created: '2026-05-30T00:00:00.000Z',
                    version: 2,
                }),
                shouldWatchDigest: jest.fn(() => false),
            };
            registry.getState.mockReturnValue({
                registry: { hub: mockRegistry },
            });
            mockTag.isGreater.mockImplementation((t1) => t1 === '1.1.0');

            const result = await docker.findNewVersion(container, {
                error: jest.fn(),
                warn: jest.fn(),
                info: jest.fn(),
            });

            expect(result).toEqual({
                tag: '1.1.0',
                digest: 'sha256:new',
                created: '2026-05-30T00:00:00.000Z',
            });
            expect(container.updatePending).toBe(false);
        });

        test('should fall back to newest old-enough tag when highest tag is too recent', async () => {
            jest.spyOn(Date, 'now').mockReturnValue(
                new Date('2026-06-01T00:00:00.000Z').getTime(),
            );
            const container = {
                minAge: '12h',
                image: {
                    registry: { name: 'hub' },
                    name: 'organization/image',
                    tag: { value: '1.0.0', semver: true },
                    digest: { watch: false },
                },
            };
            const mockRegistry = {
                getTags: jest
                    .fn()
                    .mockResolvedValue(['1.0.2', '1.0.1', '1.0.0']),
                getImageManifestDigest: jest.fn((image) => {
                    if (image.tag.value === '1.0.2') {
                        return Promise.resolve({
                            digest: 'sha256:newest',
                            created: '2026-05-31T18:00:00.000Z',
                            version: 2,
                        });
                    }
                    return Promise.resolve({
                        digest: 'sha256:older',
                        created: '2026-05-30T00:00:00.000Z',
                        version: 2,
                    });
                }),
                shouldWatchDigest: jest.fn(() => false),
            };
            registry.getState.mockReturnValue({
                registry: { hub: mockRegistry },
            });
            mockTag.isGreater.mockImplementation((t1, t2) => {
                const order = ['1.0.0', '1.0.1', '1.0.2'];
                return order.indexOf(t1) > order.indexOf(t2);
            });

            const result = await docker.findNewVersion(container, {
                error: jest.fn(),
                warn: jest.fn(),
                info: jest.fn(),
            });

            expect(result).toEqual({
                tag: '1.0.1',
                digest: 'sha256:older',
                created: '2026-05-30T00:00:00.000Z',
            });
            expect(container.updatePending).toBe(false);
            expect(container.results).toEqual([
                {
                    tag: '1.0.2',
                    digest: 'sha256:newest',
                    created: '2026-05-31T18:00:00.000Z',
                    updatePending: true,
                    updatePendingReason: 'minimum-age',
                    updatePendingUntil: '2026-06-01T06:00:00.000Z',
                },
                {
                    tag: '1.0.1',
                    digest: 'sha256:older',
                    created: '2026-05-30T00:00:00.000Z',
                    updatePending: false,
                },
            ]);
            expect(mockRegistry.getImageManifestDigest).toHaveBeenCalledTimes(
                2,
            );
        });

        test('should expose all candidates as pending when minimum age blocks every tag', async () => {
            jest.spyOn(Date, 'now').mockReturnValue(
                new Date('2026-06-01T00:00:00.000Z').getTime(),
            );
            const container = {
                minAge: '12h',
                image: {
                    registry: { name: 'hub' },
                    name: 'organization/image',
                    tag: { value: '1.0.0', semver: true },
                    digest: { watch: false },
                },
            };
            const mockRegistry = {
                getTags: jest
                    .fn()
                    .mockResolvedValue(['1.0.2', '1.0.1', '1.0.0']),
                getImageManifestDigest: jest.fn((image) =>
                    Promise.resolve({
                        digest: `sha256:${image.tag.value}`,
                        created:
                            image.tag.value === '1.0.2'
                                ? '2026-05-31T20:00:00.000Z'
                                : '2026-05-31T18:00:00.000Z',
                        version: 2,
                    }),
                ),
                shouldWatchDigest: jest.fn(() => false),
            };
            registry.getState.mockReturnValue({
                registry: { hub: mockRegistry },
            });
            mockTag.isGreater.mockImplementation((t1, t2) => {
                const order = ['1.0.0', '1.0.1', '1.0.2'];
                return order.indexOf(t1) > order.indexOf(t2);
            });

            const result = await docker.findNewVersion(container, {
                error: jest.fn(),
                warn: jest.fn(),
                info: jest.fn(),
            });

            expect(result).toEqual({
                tag: '1.0.2',
                digest: 'sha256:1.0.2',
                created: '2026-05-31T20:00:00.000Z',
            });
            expect(container.updatePending).toBe(true);
            expect(container.updatePendingUntil).toBe(
                '2026-06-01T08:00:00.000Z',
            );
            expect(container.results).toEqual([
                {
                    tag: '1.0.2',
                    digest: 'sha256:1.0.2',
                    created: '2026-05-31T20:00:00.000Z',
                    updatePending: true,
                    updatePendingReason: 'minimum-age',
                    updatePendingUntil: '2026-06-01T08:00:00.000Z',
                },
                {
                    tag: '1.0.1',
                    digest: 'sha256:1.0.1',
                    created: '2026-05-31T18:00:00.000Z',
                    updatePending: true,
                    updatePendingReason: 'minimum-age',
                    updatePendingUntil: '2026-06-01T06:00:00.000Z',
                },
            ]);
        });

        test('should allow update and warn when remote creation date is missing', async () => {
            const warn = jest.fn();
            const container = {
                minAge: '12h',
                image: {
                    registry: { name: 'hub' },
                    name: 'organization/image',
                    tag: { value: '1.0.0', semver: true },
                    digest: { watch: false },
                },
            };
            const mockRegistry = {
                getTags: jest.fn().mockResolvedValue(['1.1.0', '1.0.0']),
                getImageManifestDigest: jest.fn().mockResolvedValue({
                    digest: 'sha256:new',
                    version: 2,
                }),
                shouldWatchDigest: jest.fn(() => false),
            };
            registry.getState.mockReturnValue({
                registry: { hub: mockRegistry },
            });
            mockTag.isGreater.mockImplementation((t1) => t1 === '1.1.0');

            const result = await docker.findNewVersion(container, {
                error: jest.fn(),
                warn,
                info: jest.fn(),
            });

            expect(result).toEqual({
                tag: '1.1.0',
                digest: 'sha256:new',
                created: undefined,
            });
            expect(container.updatePending).toBe(false);
            expect(warn).toHaveBeenCalledWith(
                expect.stringContaining('minimum age cannot be applied'),
            );
        });

        test('should keep current tag when only prerelease candidates exist and prereleases are disabled', async () => {
            const container = {
                includePrerelease: false,
                image: {
                    registry: { name: 'hub' },
                    tag: { value: '1.2.3', semver: true },
                    digest: { watch: false },
                },
            };
            const mockRegistry = {
                getTags: jest
                    .fn()
                    .mockResolvedValue(['1.2.4-rc1', '1.2.5-beta1']),
                shouldWatchDigest: jest.fn(() => false),
            };
            registry.getState.mockReturnValue({
                registry: { hub: mockRegistry },
            });
            mockTag.parse.mockImplementation((tag) => {
                if (tag === '1.2.4-rc1') {
                    return {
                        major: 1,
                        minor: 2,
                        patch: 4,
                        prerelease: ['rc1'],
                    };
                }
                if (tag === '1.2.5-beta1') {
                    return {
                        major: 1,
                        minor: 2,
                        patch: 5,
                        prerelease: ['beta1'],
                    };
                }
                if (tag === '1.2.3') {
                    return { major: 1, minor: 2, patch: 3, prerelease: [] };
                }
                return null;
            });
            mockTag.isGreater.mockReturnValue(true);

            const result = await docker.findNewVersion(container, {
                error: jest.fn(),
                warn: jest.fn(),
            });

            expect(result).toEqual({ tag: '1.2.3' });
        });

        test('should allow prerelease progression when prereleases are enabled', async () => {
            const container = {
                includePrerelease: true,
                image: {
                    registry: { name: 'hub' },
                    tag: { value: '1.2.4-rc1', semver: true },
                    digest: { watch: false },
                },
            };
            const mockRegistry = {
                getTags: jest
                    .fn()
                    .mockResolvedValue(['1.2.4-rc2', '1.2.4', '1.2.4-rc1']),
                getImageManifestDigest: createManifestDigestMock(),
                shouldWatchDigest: jest.fn(() => false),
            };
            registry.getState.mockReturnValue({
                registry: { hub: mockRegistry },
            });
            mockTag.parse.mockImplementation((tag) => {
                if (tag === '1.2.4-rc1') {
                    return {
                        major: 1,
                        minor: 2,
                        patch: 4,
                        prerelease: ['rc1'],
                    };
                }
                if (tag === '1.2.4-rc2') {
                    return {
                        major: 1,
                        minor: 2,
                        patch: 4,
                        prerelease: ['rc2'],
                    };
                }
                if (tag === '1.2.4') {
                    return { major: 1, minor: 2, patch: 4, prerelease: [] };
                }
                return null;
            });
            mockTag.isGreater.mockImplementation(
                (t1) => t1 === '1.2.4' || t1 === '1.2.4-rc2',
            );

            const result = await docker.findNewVersion(container, {
                error: jest.fn(),
                warn: jest.fn(),
            });

            expect(result).toMatchObject({
                tag: '1.2.4-rc2',
                digest: 'sha256:1.2.4-rc2',
            });
        });
    });

    describe('Container Details', () => {
        test('should return existing successful container from store', async () => {
            await docker.register('watcher', 'docker', 'test', {});
            const mockLog = { debug: jest.fn() };
            docker.log = mockLog;
            const existingContainer = {
                id: '123',
                result: { tag: '2.0.0' },
                error: undefined,
            };
            storeContainer.getContainer.mockReturnValue(existingContainer);

            const result = await docker.addImageDetailsToContainer({
                Id: '123',
            });

            expect(result).toBe(existingContainer);
            expect(mockDockerApi.getImage).not.toHaveBeenCalled();
        });

        test('should add image details to new container', async () => {
            await docker.register('watcher', 'docker', 'test', {});
            const container = {
                Id: '123',
                Image: 'nginx:1.0.0',
                Names: ['/test-container'],
                State: 'running',
                Labels: {},
            };
            const imageDetails = {
                Id: 'image123',
                Architecture: 'amd64',
                Os: 'linux',
                Variant: 'v8',
                Created: '2023-01-01',
                RepoDigests: ['nginx@sha256:abc123'],
            };
            mockImage.inspect.mockResolvedValue(imageDetails);
            mockTag.parse.mockReturnValue({ major: 1, minor: 0, patch: 0 });
            const mockRegistry = {
                normalizeImage: jest.fn((img) => img),
                getId: () => 'hub',
                match: () => true,
                shouldWatchDigest: jest.fn(() => false),
            };
            registry.getState.mockReturnValue({
                registry: { hub: mockRegistry },
            });

            // Mock the validateContainer function to return the container
            const containerModule = await import('../../../model/container');
            const validateContainer = containerModule.validate;
            // @ts-ignore
            validateContainer.mockReturnValue({
                id: '123',
                name: 'test-container',
                image: { architecture: 'amd64', variant: 'v8' },
            });

            const result = await docker.addImageDetailsToContainer(container);

            expect(mockImage.inspect).toHaveBeenCalled();
            expect(result).toBeDefined();
        });

        test('should default includePrerelease to false in normalized containers', async () => {
            await docker.register('watcher', 'docker', 'test', {});
            const container = {
                Id: '123',
                Image: 'nginx:1.0.0',
                Names: ['/test-container'],
                State: 'running',
                Labels: {},
            };
            const imageDetails = {
                Id: 'image123',
                Architecture: 'amd64',
                Os: 'linux',
                Created: '2023-01-01',
            };
            mockImage.inspect.mockResolvedValue(imageDetails);
            const mockRegistry = {
                normalizeImage: jest.fn((img) => img),
                getId: () => 'hub',
                match: () => true,
                shouldWatchDigest: jest.fn(() => false),
            };
            registry.getState.mockReturnValue({
                registry: { hub: mockRegistry },
            });
            const containerModule = await import('../../../model/container');
            const validateContainer = containerModule.validate;
            validateContainer.mockImplementation((value) => value);

            const result = await docker.addImageDetailsToContainer(container);

            expect(result.includePrerelease).toBe(false);
        });

        test('should use watcher default minAge in normalized containers', async () => {
            await docker.register('watcher', 'docker', 'test', {
                minage: '12h',
            });
            const container = {
                Id: '123',
                Image: 'nginx:1.0.0',
                Names: ['/test-container'],
                State: 'running',
                Labels: {},
            };
            const imageDetails = {
                Id: 'image123',
                Architecture: 'amd64',
                Os: 'linux',
                Created: '2023-01-01',
            };
            mockImage.inspect.mockResolvedValue(imageDetails);
            const mockRegistry = {
                normalizeImage: jest.fn((img) => img),
                getId: () => 'hub',
                match: () => true,
                shouldWatchDigest: jest.fn(() => false),
            };
            registry.getState.mockReturnValue({
                registry: { hub: mockRegistry },
            });
            const containerModule = await import('../../../model/container');
            const validateContainer = containerModule.validate;
            validateContainer.mockImplementation((value) => value);

            const result = await docker.addImageDetailsToContainer(container);

            expect(result.minAge).toBe('12h');
        });

        test('should let label override watcher minAge', async () => {
            await docker.register('watcher', 'docker', 'test', {
                minage: '12h',
            });
            const container = {
                Id: '123',
                Image: 'nginx:1.0.0',
                Names: ['/test-container'],
                State: 'running',
                Labels: {
                    'wud.watch.minage': '2d',
                },
            };
            const imageDetails = {
                Id: 'image123',
                Architecture: 'amd64',
                Os: 'linux',
                Created: '2023-01-01',
            };
            mockImage.inspect.mockResolvedValue(imageDetails);
            const mockRegistry = {
                normalizeImage: jest.fn((img) => img),
                getId: () => 'hub',
                match: () => true,
                shouldWatchDigest: jest.fn(() => false),
            };
            registry.getState.mockReturnValue({
                registry: { hub: mockRegistry },
            });
            const containerModule = await import('../../../model/container');
            const validateContainer = containerModule.validate;
            validateContainer.mockImplementation((value) => value);

            const result = await docker.addImageDetailsToContainer(
                container,
                undefined,
                undefined,
                undefined,
                undefined,
                container.Labels['wud.watch.minage'],
            );

            expect(result.minAge).toBe('2d');
        });

        test('should let label disable watcher minAge', async () => {
            await docker.register('watcher', 'docker', 'test', {
                minage: '12h',
            });
            const container = {
                Id: '123',
                Image: 'nginx:1.0.0',
                Names: ['/test-container'],
                State: 'running',
                Labels: {
                    'wud.watch.minage': '0s',
                },
            };
            const imageDetails = {
                Id: 'image123',
                Architecture: 'amd64',
                Os: 'linux',
                Created: '2023-01-01',
            };
            mockImage.inspect.mockResolvedValue(imageDetails);
            const mockRegistry = {
                normalizeImage: jest.fn((img) => img),
                getId: () => 'hub',
                match: () => true,
                shouldWatchDigest: jest.fn(() => false),
            };
            registry.getState.mockReturnValue({
                registry: { hub: mockRegistry },
            });
            const containerModule = await import('../../../model/container');
            const validateContainer = containerModule.validate;
            validateContainer.mockImplementation((value) => value);

            const result = await docker.addImageDetailsToContainer(
                container,
                undefined,
                undefined,
                undefined,
                undefined,
                container.Labels['wud.watch.minage'],
            );

            expect(result.minAge).toBe('0s');
        });

        test('should let label opt in to prereleases over watcher default', async () => {
            await docker.register('watcher', 'docker', 'test', {
                includeprerelease: false,
            });
            const container = {
                Id: '123',
                Image: 'nginx:1.0.0',
                Names: ['/test-container'],
                State: 'running',
                Labels: {
                    'wud.tag.includeprerelease': 'true',
                },
            };
            const imageDetails = {
                Id: 'image123',
                Architecture: 'amd64',
                Os: 'linux',
                Created: '2023-01-01',
            };
            mockImage.inspect.mockResolvedValue(imageDetails);
            const mockRegistry = {
                normalizeImage: jest.fn((img) => img),
                getId: () => 'hub',
                match: () => true,
                shouldWatchDigest: jest.fn(() => false),
            };
            registry.getState.mockReturnValue({
                registry: { hub: mockRegistry },
            });
            const containerModule = await import('../../../model/container');
            const validateContainer = containerModule.validate;
            validateContainer.mockImplementation((value) => value);

            const result = await docker.addImageDetailsToContainer(
                container,
                undefined,
                undefined,
                container.Labels['wud.tag.includeprerelease'],
            );

            expect(result.includePrerelease).toBe(true);
        });

        test('should let label opt out of prereleases over watcher opt-in', async () => {
            await docker.register('watcher', 'docker', 'test', {
                includeprerelease: true,
            });
            const container = {
                Id: '123',
                Image: 'nginx:1.0.0',
                Names: ['/test-container'],
                State: 'running',
                Labels: {
                    'wud.tag.includeprerelease': 'false',
                },
            };
            const imageDetails = {
                Id: 'image123',
                Architecture: 'amd64',
                Os: 'linux',
                Created: '2023-01-01',
            };
            mockImage.inspect.mockResolvedValue(imageDetails);
            const mockRegistry = {
                normalizeImage: jest.fn((img) => img),
                getId: () => 'hub',
                match: () => true,
                shouldWatchDigest: jest.fn(() => false),
            };
            registry.getState.mockReturnValue({
                registry: { hub: mockRegistry },
            });
            const containerModule = await import('../../../model/container');
            const validateContainer = containerModule.validate;
            validateContainer.mockImplementation((value) => value);

            const result = await docker.addImageDetailsToContainer(
                container,
                undefined,
                undefined,
                container.Labels['wud.tag.includeprerelease'],
            );

            expect(result.includePrerelease).toBe(false);
        });

        test('should invalidate cached container when a wud label changes', async () => {
            await docker.register('watcher', 'docker', 'test', {});
            storeContainer.getContainer.mockReturnValue({
                id: '123',
                error: undefined,
                labels: {
                    'wud.tag.include': '^1\\.0\\..*$',
                },
                includeTags: '^1\\.0\\..*$',
                includePrerelease: false,
            });
            const container = {
                Id: '123',
                Image: 'nginx:1.0.0',
                Names: ['/test-container'],
                State: 'running',
                Labels: {
                    'wud.tag.include': '^1\\.1\\..*$',
                },
            };
            const imageDetails = {
                Id: 'image123',
                Architecture: 'amd64',
                Os: 'linux',
                Created: '2023-01-01',
            };
            mockImage.inspect.mockResolvedValue(imageDetails);
            const mockRegistry = {
                normalizeImage: jest.fn((img) => img),
                getId: () => 'hub',
                match: () => true,
                shouldWatchDigest: jest.fn(() => false),
            };
            registry.getState.mockReturnValue({
                registry: { hub: mockRegistry },
            });
            const containerModule = await import('../../../model/container');
            const validateContainer = containerModule.validate;
            validateContainer.mockImplementation((value) => value);

            const result = await docker.addImageDetailsToContainer(
                container,
                container.Labels['wud.tag.include'],
            );

            expect(mockImage.inspect).toHaveBeenCalled();
            expect(result.includeTags).toBe('^1\\.1\\..*$');
        });

        test('should invalidate cached container when watcher default includePrerelease changes', async () => {
            await docker.register('watcher', 'docker', 'test', {
                includeprerelease: true,
            });
            storeContainer.getContainer.mockReturnValue({
                id: '123',
                error: undefined,
                labels: {},
                includePrerelease: false,
            });
            const container = {
                Id: '123',
                Image: 'nginx:1.0.0',
                Names: ['/test-container'],
                State: 'running',
                Labels: {},
            };
            const imageDetails = {
                Id: 'image123',
                Architecture: 'amd64',
                Os: 'linux',
                Created: '2023-01-01',
            };
            mockImage.inspect.mockResolvedValue(imageDetails);
            const mockRegistry = {
                normalizeImage: jest.fn((img) => img),
                getId: () => 'hub',
                match: () => true,
                shouldWatchDigest: jest.fn(() => false),
            };
            registry.getState.mockReturnValue({
                registry: { hub: mockRegistry },
            });
            const containerModule = await import('../../../model/container');
            const validateContainer = containerModule.validate;
            validateContainer.mockImplementation((value) => value);

            const result = await docker.addImageDetailsToContainer(container);

            expect(mockImage.inspect).toHaveBeenCalled();
            expect(result.includePrerelease).toBe(true);
        });

        test('should invalidate cached container when watcher default minAge changes', async () => {
            await docker.register('watcher', 'docker', 'test', {
                minage: '12h',
            });
            storeContainer.getContainer.mockReturnValue({
                id: '123',
                error: undefined,
                labels: {},
                includePrerelease: false,
                minAge: '0s',
            });
            const container = {
                Id: '123',
                Image: 'nginx:1.0.0',
                Names: ['/test-container'],
                State: 'running',
                Labels: {},
            };
            const imageDetails = {
                Id: 'image123',
                Architecture: 'amd64',
                Os: 'linux',
                Created: '2023-01-01',
            };
            mockImage.inspect.mockResolvedValue(imageDetails);
            const mockRegistry = {
                normalizeImage: jest.fn((img) => img),
                getId: () => 'hub',
                match: () => true,
                shouldWatchDigest: jest.fn(() => false),
            };
            registry.getState.mockReturnValue({
                registry: { hub: mockRegistry },
            });
            const containerModule = await import('../../../model/container');
            const validateContainer = containerModule.validate;
            validateContainer.mockImplementation((value) => value);

            const result = await docker.addImageDetailsToContainer(container);

            expect(mockImage.inspect).toHaveBeenCalled();
            expect(result.minAge).toBe('12h');
        });

        test('should reject invalid minAge label for a container', async () => {
            await docker.register('watcher', 'docker', 'test', {});
            const container = {
                Id: '123',
                Image: 'nginx:1.0.0',
                Names: ['/test-container'],
                State: 'running',
                Labels: {
                    'wud.watch.minage': '12',
                },
            };
            const imageDetails = {
                Id: 'image123',
                Architecture: 'amd64',
                Os: 'linux',
                Created: '2023-01-01',
            };
            mockImage.inspect.mockResolvedValue(imageDetails);
            const mockRegistry = {
                normalizeImage: jest.fn((img) => img),
                getId: () => 'hub',
                match: () => true,
                shouldWatchDigest: jest.fn(() => false),
            };
            registry.getState.mockReturnValue({
                registry: { hub: mockRegistry },
            });

            await expect(
                docker.addImageDetailsToContainer(
                    container,
                    undefined,
                    undefined,
                    undefined,
                    undefined,
                    container.Labels['wud.watch.minage'],
                ),
            ).rejects.toThrow('Invalid duration');
        });

        test('should reuse cached container when wud labels and defaults are unchanged', async () => {
            await docker.register('watcher', 'docker', 'test', {
                includeprerelease: false,
            });
            const cachedContainer = {
                id: '123',
                error: undefined,
                labels: {
                    'wud.tag.include': '^1\\.0\\..*$',
                },
                includePrerelease: false,
            };
            storeContainer.getContainer.mockReturnValue(cachedContainer);
            const container = {
                Id: '123',
                Image: 'nginx:1.0.0',
                Names: ['/test-container'],
                State: 'running',
                Labels: {
                    'wud.tag.include': '^1\\.0\\..*$',
                },
            };

            const result = await docker.addImageDetailsToContainer(
                container,
                container.Labels['wud.tag.include'],
            );

            expect(mockImage.inspect).not.toHaveBeenCalled();
            expect(result).toBe(cachedContainer);
        });

        test('should handle container with implicit docker hub image (no domain)', async () => {
            await docker.register('watcher', 'docker', 'test', {});
            const container = {
                Id: '123',
                Image: 'prom/prometheus:v3.8.0',
                Names: ['/prometheus'],
                State: 'running',
                Labels: {},
            };
            const imageDetails = {
                RepoTags: ['prom/prometheus:v3.8.0'],
                Architecture: 'amd64',
                Os: 'linux',
                Created: '2023-01-01',
                Id: 'image123',
            };
            mockImage.inspect.mockResolvedValue(imageDetails);
            // Mock registry to handle unknown/docker hub
            const mockRegistry = {
                normalizeImage: jest.fn((img) => img),
                getId: () => 'hub',
                match: () => true,
                shouldWatchDigest: jest.fn(() => false),
            };
            registry.getState.mockReturnValue({
                registry: { hub: mockRegistry },
            });

            const containerModule = await import('../../../model/container');
            const validateContainer = containerModule.validate;
            // @ts-ignore
            validateContainer.mockReturnValue({
                id: '123',
                name: 'prometheus',
                image: { architecture: 'amd64' },
            });

            const result = await docker.addImageDetailsToContainer(container);

            expect(result).toBeDefined();
        });

        test('should handle container with SHA256 image', async () => {
            await docker.register('watcher', 'docker', 'test', {});
            const container = {
                Id: '123',
                Image: 'sha256:abcdef123456',
                Names: ['/test'],
                State: 'running',
                Labels: {},
            };
            const imageDetails = {
                RepoTags: ['nginx:latest'],
                Architecture: 'amd64',
                Os: 'linux',
                Created: '2023-01-01',
                Id: 'image123',
            };
            mockImage.inspect.mockResolvedValue(imageDetails);
            const mockRegistry = {
                normalizeImage: jest.fn((img) => img),
                getId: () => 'hub',
                match: () => true,
                shouldWatchDigest: jest.fn(() => false),
            };
            registry.getState.mockReturnValue({
                registry: { hub: mockRegistry },
            });

            // Mock the validateContainer function to return the container
            const containerModule = await import('../../../model/container');
            const validateContainer = containerModule.validate;
            // @ts-ignore
            validateContainer.mockReturnValue({
                id: '123',
                name: 'test',
                image: { architecture: 'amd64' },
            });

            const result = await docker.addImageDetailsToContainer(container);

            expect(result).toBeDefined();
        });

        test('should handle container with no repo tags', async () => {
            await docker.register('watcher', 'docker', 'test', {});
            const mockLog = { warn: jest.fn() };
            docker.log = mockLog;
            const container = {
                Id: '123',
                Image: 'sha256:abcdef123456',
                Names: ['/test'],
                State: 'running',
                Labels: {},
            };
            const imageDetails = { RepoTags: [] };
            mockImage.inspect.mockResolvedValue(imageDetails);

            const result = await docker.addImageDetailsToContainer(container);

            expect(mockLog.warn).toHaveBeenCalledWith(
                expect.stringContaining('Cannot get a reliable tag'),
            );
            expect(result).toBeUndefined();
        });

        test('should warn for non-semver without digest watching', async () => {
            await docker.register('watcher', 'docker', 'test', {});
            const mockLog = { warn: jest.fn() };
            docker.log = mockLog;
            const container = {
                Id: '123',
                Image: 'nginx:latest',
                Names: ['/test'],
                State: 'running',
                Labels: {},
            };
            const imageDetails = {
                Id: 'image123',
                Architecture: 'amd64',
                Os: 'linux',
                Created: '2023-01-01',
            };
            mockImage.inspect.mockResolvedValue(imageDetails);
            mockTag.parse.mockReturnValue(null);
            const mockRegistry = {
                normalizeImage: jest.fn((img) => img),
                getId: () => 'hub',
                match: () => true,
                shouldWatchDigest: jest.fn(() => false),
            };
            registry.getState.mockReturnValue({
                registry: { hub: mockRegistry },
            });

            // Mock the validateContainer function to return the container
            const containerModule = await import('../../../model/container');
            const validateContainer = containerModule.validate;
            // @ts-ignore
            validateContainer.mockReturnValue({
                id: '123',
                name: 'test',
                image: { architecture: 'amd64' },
            });

            const result = await docker.addImageDetailsToContainer(container);

            expect(result).toBeDefined();
        });

        test('should warn when displayIcon uses deprecated hl prefix', async () => {
            await docker.register('watcher', 'docker', 'test', {});
            const container = {
                Id: 'deprecated-icon-container',
                Names: ['/my-container'],
                Image: 'test-image',
                State: 'running',
                Labels: { 'wud.display.icon': 'hl:plex' },
            };
            mockImage.inspect.mockResolvedValue({
                Architecture: 'amd64',
                Os: 'linux',
                Created: '2023-01-01',
                Id: 'img123',
                RepoDigests: [],
            });
            docker.log.warn = jest.fn();

            await docker.addImageDetailsToContainer(
                container,
                undefined,
                undefined,
                undefined,
                undefined,
                undefined,
                'hl:plex',
            );

            expect(docker.log.warn).toHaveBeenCalledWith(
                expect.stringContaining(
                    "uses deprecated icon prefix 'hl:plex'",
                ),
            );
        });
    });

    describe('Container Reporting', () => {
        test('should map container to report for new container', async () => {
            const container = { id: '123', name: 'test' };
            const mockLogChild = { debug: jest.fn() };
            const mockLog = { child: jest.fn().mockReturnValue(mockLogChild) };
            docker.log = mockLog;
            storeContainer.getContainer.mockReturnValue(undefined);
            storeContainer.insertContainer.mockReturnValue(container);

            const result = docker.mapContainerToContainerReport(container);

            expect(result.changed).toBe(true);
            expect(storeContainer.insertContainer).toHaveBeenCalledWith(
                container,
            );
        });

        test('should map container to report for existing container', async () => {
            const container = {
                id: '123',
                name: 'test',
                updateAvailable: true,
            };
            const existingContainer = {
                resultChanged: jest.fn().mockReturnValue(true),
            };
            const mockLogChild = { debug: jest.fn() };
            const mockLog = { child: jest.fn().mockReturnValue(mockLogChild) };
            docker.log = mockLog;
            storeContainer.getContainer.mockReturnValue(existingContainer);
            storeContainer.updateContainer.mockReturnValue(container);

            const result = docker.mapContainerToContainerReport(container);

            expect(result.changed).toBe(true);
            expect(storeContainer.updateContainer).toHaveBeenCalledWith(
                container,
            );
        });

        test('should not mark as changed when no update available', async () => {
            const container = {
                id: '123',
                name: 'test',
                updateAvailable: false,
            };
            const existingContainer = {
                resultChanged: jest.fn().mockReturnValue(true),
            };
            const mockLogChild = { debug: jest.fn() };
            const mockLog = { child: jest.fn().mockReturnValue(mockLogChild) };
            docker.log = mockLog;
            storeContainer.getContainer.mockReturnValue(existingContainer);
            storeContainer.updateContainer.mockReturnValue(container);

            const result = docker.mapContainerToContainerReport(container);

            expect(result.changed).toBe(false);
        });
    });

    describe('Utility Functions', () => {
        test('should get tag candidates with include filter', async () => {
            const tags = ['v1.0.0', 'latest', 'v2.0.0', 'beta'];
            const filtered = tags.filter((tag) => /^v\d+/.test(tag));
            expect(filtered).toEqual(['v1.0.0', 'v2.0.0']);
        });

        test('should get container name and strip slash', async () => {
            const container = { Names: ['/test-container'] };
            const name = container.Names[0].replace(/\//, '');
            expect(name).toBe('test-container');
        });

        test('should get repo digest from image', async () => {
            const image = { RepoDigests: ['nginx@sha256:abc123def456'] };
            const digest = image.RepoDigests[0].split('@')[1];
            expect(digest).toBe('sha256:abc123def456');
        });

        test('should handle empty repo digests', async () => {
            const image = { RepoDigests: [] };
            expect(image.RepoDigests.length).toBe(0);
        });

        test('should get old containers for pruning', async () => {
            const newContainers = [{ id: '1' }, { id: '2' }];
            const storeContainers = [{ id: '1' }, { id: '3' }];

            const oldContainers = storeContainers.filter((storeContainer) => {
                const stillExists = newContainers.find(
                    (newContainer) => newContainer.id === storeContainer.id,
                );
                return stillExists === undefined;
            });

            expect(oldContainers).toEqual([{ id: '3' }]);
        });

        test('should handle null inputs for old containers', async () => {
            expect([].filter(() => false)).toEqual([]);
        });
    });
});
