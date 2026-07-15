// @ts-nocheck
import fs from 'fs';
import path from 'path';
import express from 'express';
import { getServerConfiguration } from '../configuration';
import logger from '../log';

function serveIndex(res, basePath) {
    const indexHtmlPath = path.join(basePath, 'index.html');
    const appBasePath = getServerConfiguration().basepath;
    const html = fs.readFileSync(indexHtmlPath, 'utf-8');
    const baseHref = appBasePath.endsWith('/')
        ? appBasePath
        : `${appBasePath}/`;
    let injected = html.replace('<head>', `<head><base href="${baseHref}">`);
    injected = injected.replace(
        '<div id="app">',
        `<script>window.__WUD_BASE_PATH__='${appBasePath}'</script><div id="app">`,
    );
    res.setHeader('Content-Type', 'text/html');
    res.setHeader('Cache-Control', 'no-store');
    res.send(injected);
}

/**
 * Init the UI router.
 * @returns {*|Router}
 */
export function init() {
    const router = express.Router();

    const uiPath = path.join(__dirname, '..', '..', 'ui');
    const builtUiPath = path.join(uiPath, 'dist');
    let basePath = uiPath;

    // Prefer the local Vite build when it exists; release images copy built files directly into uiPath.
    if (fs.existsSync(path.join(builtUiPath, 'index.html'))) {
        basePath = builtUiPath;
        logger.debug(`Serving UI from ${basePath}`);
    } else if (fs.existsSync(path.join(uiPath, 'index.html'))) {
        logger.debug(`Serving UI from ${basePath}`);
    } else {
        logger.error(`Unable to find UI files in ${builtUiPath} or ${uiPath}`);
    }

    router.use(
        express.static(basePath, {
            index: false,
        }),
    );

    // Redirect all 404 to index.html (for vue history mode)
    router.get('*', (req, res) => {
        serveIndex(res, basePath);
    });
    return router;
}
