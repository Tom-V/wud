// @ts-nocheck
import { getVersion, stopWatcher } from './configuration';
import log from './log';
import { store } from './store';
import * as registry from './registry';
import * as api from './api';
import * as auth from './api/auth';
import { prometheus } from './prometheus';

export async function main() {
    log.info(`WUD is starting (version = ${getVersion()})`);

    // Init store
    await store.init();

    // Start Prometheus registry
    prometheus.init();

    // Init registry
    await registry.init();

    // Init api
    await api.init();
}

export async function dispose() {
    prometheus.dispose();
    await api.dispose();
    auth.dispose();
    store.dispose();
    await registry.dispose();
    stopWatcher();
}

export function registerSignalHandlers() {
    process.on('SIGTERM', () => void dispose());
    process.on('SIGINT', () => void dispose());
}

export async function bootstrap() {
    await main();
    registerSignalHandlers();
}

void bootstrap();
