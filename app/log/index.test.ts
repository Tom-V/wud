import log from './index';

// Mock the configuration module
jest.mock('../configuration', () => ({
    getLogLevel: jest.fn(() => 'info'),
}));

describe('Logger', () => {
    afterEach(() => {
        jest.restoreAllMocks();
        log.setLogLevel('info');
    });

    test('should export a logger instance', async () => {
        expect(log).toBeDefined();
        expect(typeof log.info).toBe('function');
        expect(typeof log.warn).toBe('function');
        expect(typeof log.error).toBe('function');
        expect(typeof log.debug).toBe('function');
    });

    test('should have a child method', async () => {
        expect(typeof log.child).toBe('function');
        const child = log.child({ component: 'test' });
        expect(child).toBeDefined();
        expect(typeof child.info).toBe('function');
    });

    test('should have a setLogLevel method', async () => {
        expect(typeof log.setLogLevel).toBe('function');
    });

    test('should apply parent log level to child logger', async () => {
        const child = log.child({ component: 'child-component' });
        const consoleLogSpy = jest.spyOn(console, 'log').mockImplementation();

        log.setLogLevel('warn');
        child.info('message should be filtered');

        expect(consoleLogSpy).not.toHaveBeenCalled();
    });

    test('should still emit warn from child when level is warn', async () => {
        const child = log.child({ component: 'child-component' });
        const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation();

        log.setLogLevel('warn');
        child.warn('warn should be logged');

        expect(consoleWarnSpy).toHaveBeenCalledTimes(1);
    });
});
