import express from 'express';
import request from 'supertest';
import * as prometheusApi from './prometheus';
import { prometheus } from '../prometheus';
import { requireAuthentication } from './auth';

jest.mock('../prometheus', () => ({
    prometheus: {
        output: jest.fn(() => Promise.resolve('mock-metrics')),
    },
}));

jest.mock('./auth', () => ({
    requireAuthentication: jest.fn((req, res, next) => next()),
}));

describe('API Prometheus', () => {
    let app: express.Express;

    beforeEach(() => {
        jest.clearAllMocks();
        app = express();
        app.use(express.json());
        app.use(prometheusApi.init());
    });

    test('should return prometheus metrics', async () => {
        const res = await request(app).get('/');
        expect(res.status).toBe(200);
        expect(res.type).toBe('text/plain');
        expect(res.text).toEqual('mock-metrics');
        expect(prometheus.output).toHaveBeenCalled();
        expect(requireAuthentication).toHaveBeenCalled();
    });
});
