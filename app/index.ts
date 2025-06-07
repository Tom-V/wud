import { getVersion, stopWatcher } from './configuration';
import log from './log';
import { store } from './store';
import * as registry from './registry';
import * as api from './api';
import { prometheus } from './prometheus';

async function main() {
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
main();

function dispose() {
    prometheus.dispose();
    store.dispose();
    registry.dispose();
    api.dispose();
    stopWatcher();
}

process.on('SIGTERM', dispose);
process.on('SIGINT', dispose);