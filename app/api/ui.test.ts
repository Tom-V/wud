// @ts-nocheck
const mockRouter = {
    use: jest.fn(),
    get: jest.fn(),
};

const mockStatic = jest.fn((basePath, options) => ({ basePath, options }));

jest.mock('express', () => ({
    __esModule: true,
    default: {
        Router: jest.fn(() => mockRouter),
        static: mockStatic,
    },
}));

jest.mock('fs', () => ({
    __esModule: true,
    default: {
        existsSync: jest.fn(),
    },
}));

jest.mock('../log', () => ({
    __esModule: true,
    default: {
        child: jest.fn(() => ({
            debug: jest.fn(),
            error: jest.fn(),
        })),
        debug: jest.fn(),
        error: jest.fn(),
    },
}));

jest.mock('../configuration', () => ({
    __esModule: true,
    getServerConfiguration: jest.fn(() => ({
        basepath: '/',
    })),
}));

import path from 'path';
import fs from 'fs';
import * as uiRouter from './ui';

describe('UI Router', () => {
    const uiPath = path.join(__dirname, '..', '..', 'ui');
    const builtUiPath = path.join(uiPath, 'dist');

    beforeEach(() => {
        jest.clearAllMocks();
    });

    test('should prefer the built UI dist when it exists', () => {
        fs.existsSync.mockImplementation(
            (filePath) => filePath === path.join(builtUiPath, 'index.html'),
        );

        uiRouter.init();

        expect(mockStatic).toHaveBeenCalledWith(builtUiPath, {
            index: false,
        });
    });

    test('should fall back to the UI directory for release layout', () => {
        fs.existsSync.mockImplementation(
            (filePath) => filePath === path.join(uiPath, 'index.html'),
        );

        uiRouter.init();

        expect(mockStatic).toHaveBeenCalledWith(uiPath, {
            index: false,
        });
    });
});
