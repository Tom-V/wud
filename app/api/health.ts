import express from 'express';
import nocache from 'nocache';

/**
 * Healthcheck router.
 */
const router = express.Router();

/**
 * Init Router.
 */
export function init() {
    router.use(nocache());
    router.get('/', (_req, res) =>
        res.status(200).json({ uptime: process.uptime() }),
    );
    return router;
}
