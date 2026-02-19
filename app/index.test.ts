// Mock all dependencies
const mockStoreInit = jest.fn();
const mockPrometheusInit = jest.fn();
const mockRegistryInit = jest.fn();
const mockApiInit = jest.fn();
const mockApiDispose = jest.fn(() => Promise.resolve());
const mockAuthDispose = jest.fn();
const mockGetVersion = jest.fn().mockReturnValue('1.0.0');
const mockLogInfo = jest.fn();
const mockStopWatcher = jest.fn();
const mockStoreDispose = jest.fn();
const mockRegistryDispose = jest.fn();
const mockPrometheusDispose = jest.fn();

jest.mock('./configuration', () => ({
    getVersion: mockGetVersion,
    stopWatcher: mockStopWatcher,
}));

jest.mock('./log', () => ({
    info: mockLogInfo,
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    trace: jest.fn(),
}));

jest.mock('./store', () => ({
    store: {
        init: mockStoreInit,
        dispose: mockStoreDispose,
    },
}));

jest.mock('./registry', () => ({
    init: mockRegistryInit,
    dispose: mockRegistryDispose,
}));

jest.mock('./api', () => ({
    init: mockApiInit,
    dispose: mockApiDispose,
}));

jest.mock('./api/auth', () => ({
    dispose: mockAuthDispose,
}));

jest.mock('./prometheus', () => ({
    prometheus: {
        init: mockPrometheusInit,
        dispose: mockPrometheusDispose,
    },
}));

describe('Main Application', () => {
    beforeEach(async () => {
        jest.clearAllMocks();
        // Clear the module cache to ensure fresh imports
        jest.resetModules();
    });

    test('should initialize all components are initiated', async () => {
        mockStoreInit.mockResolvedValue(undefined);
        mockPrometheusInit.mockReturnValue(undefined);
        mockRegistryInit.mockResolvedValue(undefined);
        mockApiInit.mockResolvedValue(undefined);

        // Import and run the main module
        const indexModule = await import('./index');

        // Wait for async operations to complete
        await new Promise((resolve) => setImmediate(resolve));

        // Verify initialization calls
        expect(mockGetVersion).toHaveBeenCalled();
        expect(mockLogInfo).toHaveBeenCalledWith(
            'WUD is starting (version = 1.0.0)',
        );
        expect(mockStoreInit).toHaveBeenCalled();
        expect(mockPrometheusInit).toHaveBeenCalled();
        expect(mockRegistryInit).toHaveBeenCalled();
        expect(mockApiInit).toHaveBeenCalled();

        await indexModule.dispose();
    });

    test('should dispose the shared store only after api shutdown finishes', async () => {
        mockStoreInit.mockResolvedValue(undefined);
        mockPrometheusInit.mockReturnValue(undefined);
        mockRegistryInit.mockResolvedValue(undefined);
        mockApiInit.mockResolvedValue(undefined);

        const disposeOrder: string[] = [];
        mockPrometheusDispose.mockImplementation(() =>
            disposeOrder.push('prometheus'),
        );
        mockApiDispose.mockImplementation(async () => {
            disposeOrder.push('api');
        });
        mockAuthDispose.mockImplementation(() => disposeOrder.push('auth'));
        mockStoreDispose.mockImplementation(() => disposeOrder.push('store'));
        mockRegistryDispose.mockImplementation(() =>
            disposeOrder.push('registry'),
        );
        mockStopWatcher.mockImplementation(() => disposeOrder.push('watcher'));

        const indexModule = await import('./index');

        await new Promise((resolve) => setImmediate(resolve));

        await indexModule.dispose();

        expect(disposeOrder).toEqual([
            'prometheus',
            'api',
            'auth',
            'store',
            'registry',
            'watcher',
        ]);
    });
});
