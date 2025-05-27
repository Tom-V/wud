import { Trigger, TriggerConfiguration } from '../Trigger';
import { Container } from '../../../model/container';
import { UriOptions } from 'request';
import axios, { AxiosRequestConfig } from 'axios';
import { URL } from 'url';

export interface HttpConfiguration extends TriggerConfiguration {
    url: string;
    method: 'GET' | 'POST';
    auth?: {
        type: 'BASIC' | 'BEARER';
        user?: string;
        password?: string;
        bearer?: string;
    };
    proxy?: string;
}

/**
 * HTTP Trigger implementation
 */
export class Http extends Trigger<HttpConfiguration> {
    /**
     * Get the Trigger configuration schema.
     */
    getConfigurationSchema() {
        return this.joi.object().keys({
            url: this.joi.string().uri({
                scheme: ['http', 'https'],
            }),
            method: this.joi
                .string()
                .allow('GET')
                .allow('POST')
                .default('POST'),
            auth: this.joi.object({
                type: this.joi
                    .string()
                    .allow('BASIC')
                    .allow('BEARER')
                    .default('BASIC'),
                user: this.joi.string(),
                password: this.joi.string(),
                bearer: this.joi.string(),
            }),
            proxy: this.joi.string(),
        });
    }

    /**
     * Send an HTTP Request with new image version details.
     */
    async trigger(container: Container) {
        return this.sendHttpRequest(container);
    }

    /**
     * Send an HTTP Request with new image versions details.
     */
    async triggerBatch(containers: Container[]) {
        return this.sendHttpRequest(containers);
    }

    async sendHttpRequest(body: Container | Container[]) {
        const url = this.configuration.url;
        const options: AxiosRequestConfig = {
            method: this.configuration.method,
            url: url,
        };
        if (this.configuration.method === 'POST') {
            options.data = body;
        } else if (this.configuration.method === 'GET') {
            options.params = body;
        }
        if (this.configuration.auth) {
            if (this.configuration.auth.type === 'BASIC') {
                options.auth = {
                    username: this.configuration.auth.user!,
                    password: this.configuration.auth.password!,
                };
            } else if (this.configuration.auth.type === 'BEARER') {
                options.headers = options.headers || {};
                options.headers!.Authorization = `Bearer ${this.configuration.auth.bearer}`;
            }
        }
        if (this.configuration.proxy) {
            const proxyUrl = new URL(this.configuration.proxy);

            options.proxy = {
                host: proxyUrl.hostname,
                port: parseInt(proxyUrl.port, 10),
                protocol: proxyUrl.protocol.replace(':', ''),
            };
        }
        return axios(options);
    }
}
