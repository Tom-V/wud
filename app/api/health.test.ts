// @ts-nocheck
// Mock express modules
jest.mock('express', () => ({
    Router: jest.fn(() => ({
        use: jest.fn(),
        get: jest.fn(),
    })),
}));

jest.mock('nocache', () => jest.fn());

import * as healthRouter from './health';

describe('Health Router', () => {
    beforeEach(async () => {
        jest.clearAllMocks();
    });

    test('should initialize router with nocache and healthcheck handler', async () => {
        const router = healthRouter.init();

        expect(router).toBeDefined();
        expect(router.use).toHaveBeenCalled();
        expect(router.get).toHaveBeenCalledWith('/', expect.any(Function));
    });

    test('should return uptime', async () => {
        const router = healthRouter.init();
        const handler = router.get.mock.calls[0][1];
        const res = {
            status: jest.fn().mockReturnThis(),
            json: jest.fn(),
        };
        const uptime = jest.spyOn(process, 'uptime').mockReturnValue(123);

        handler({}, res);

        expect(res.status).toHaveBeenCalledWith(200);
        expect(res.json).toHaveBeenCalledWith({ uptime: 123 });
        uptime.mockRestore();
    });
});
