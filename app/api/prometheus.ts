// @ts-nocheck
import express from 'express';
import nocache from 'nocache';
import { prometheus } from '../prometheus';
import { requireAuthentication } from './auth';

/**
 * Prometheus Metrics router.
 * @type {Router}
 */
const router = express.Router();

/**
 * Return Prometheus Metrics as String.
 * @param req
 * @param res
 */
async function outputMetrics(req, res) {
    res.status(200)
        .type('text')
        .send(await prometheus.output());
}

/**
 * Init Router.
 * @returns {*}
 */
export function init() {
    router.use(nocache());

    // Routes to protect after this line
    router.use(requireAuthentication);

    router.get('/', outputMetrics);
    return router;
}
