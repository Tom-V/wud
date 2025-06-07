import { collectDefaultMetrics, register } from 'prom-client';

import logger from '../log';
import * as container from './container';
import * as trigger from './trigger';
import * as watcher from './watcher';
import * as registry from './registry';

class Prometheus {
    private log = logger.child({ component: 'prometheus' });
    /**
     * Start the Prometheus registry.
     */
    init() {
        this.log.info('Init Prometheus module');
        collectDefaultMetrics();
        container.init();
        registry.init();
        trigger.init();
        watcher.init();
    }

    dispose() {
        this.log.info('Dispose Prometheus module');
        container.dispose();
    }

    /**
     * Return all metrics as string for Prometheus scrapping.
     */
    async output() {
        return register.metrics();
    }

}

export const prometheus = new Prometheus();