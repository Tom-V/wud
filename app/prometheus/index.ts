import { collectDefaultMetrics, register } from 'prom-client';

import logger from '../log';
const log = logger.child({ component: 'prometheus' });
import * as configuration from '../configuration';
import * as container from './container';
import * as trigger from './trigger';
import * as watcher from './watcher';
import * as registry from './registry';

class Prometheus {
    /**
     * Start the Prometheus registry.
     */
    init() {
        const prometheusConfiguration =
            configuration.getPrometheusConfiguration();
        if (!prometheusConfiguration.enabled) {
            log.info('Prometheus monitoring disabled');
            return;
        }
        log.info('Init Prometheus module');
        collectDefaultMetrics();
        container.init();
        registry.init();
        trigger.init();
        watcher.init();
    }

    dispose() {
        log.info('Dispose Prometheus module');
        container.dispose();
    }

    /**
     * Return all metrics as string for Prometheus scrapping.
     * @returns {string}
     */
    async output() {
        return register.metrics();
    }
}
export const prometheus = new Prometheus();
