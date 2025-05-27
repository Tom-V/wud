import { Trigger, TriggerConfiguration } from '../Trigger';
import { Container } from '../../../model/container';
import axios, { AxiosRequestConfig } from 'axios';

export interface NtfyConfiguration extends TriggerConfiguration {
    url: string;
    topic: string;
    priority: 0 | 1 | 2 | 3 | 4 | 5;
    auth?: {
        user?: string;
        password?: string;
        token?: string;
    } | undefined;
}

/**
 * Ntfy Trigger implementation
 */
export class Ntfy extends Trigger<NtfyConfiguration> {
    /**
     * Get the Trigger configuration schema.
     * @returns {*}
     */
    getConfigurationSchema() {
        return this.joi.object().keys({
            url: this.joi
                .string()
                .uri({
                    scheme: ['http', 'https'],
                })
                .default('https://ntfy.sh'),
            topic: this.joi.string(),
            priority: this.joi.number().integer().min(0).max(5),
            auth: this.joi.object({
                user: this.joi.string(),
                password: this.joi.string(),
                token: this.joi.string(),
            }),
        });
    }

    /**
     * Sanitize sensitive data
     */
    maskConfiguration() {
        return {
            ...this.configuration,
            auth: this.configuration.auth
                ? {
                    user: Ntfy.mask(this.configuration.auth.user),
                    password: Ntfy.mask(this.configuration.auth.password),
                    token: Ntfy.mask(this.configuration.auth.token),
                }
                : undefined,
        };
    }

    /**
     * Send an HTTP Request to Ntfy.
     */
    async trigger(container: Container) {
        return this.sendHttpRequest({
            topic: this.configuration.topic,
            title: this.renderSimpleTitle(container),
            message: this.renderSimpleBody(container),
            priority: this.configuration.priority,
        });
    }

    /**
     * Send an HTTP Request to Ntfy.
     */
    async triggerBatch(containers: Container[]) {
        return this.sendHttpRequest({
            topic: this.configuration.topic,
            title: this.renderBatchTitle(containers),
            message: this.renderBatchBody(containers),
            priority: this.configuration.priority,
        });
    }

    /**
     * Send http request to Ntfy.
     * @param body
     * @returns {Promise<*>}
     */
    async sendHttpRequest(body: any) {
        const options: AxiosRequestConfig = {
            method: 'POST',
            url: this.configuration.url,
            headers: {
                'Content-Type': 'application/json',
            },
            data: body,
        };
        if (
            this.configuration.auth &&
            this.configuration.auth.user &&
            this.configuration.auth.password
        ) {
            options.auth = {
                username: this.configuration.auth.user,
                password: this.configuration.auth.password,
            };
        }
        if (this.configuration.auth && this.configuration.auth.token) {
            options.headers!.Authorization = `Bearer ${this.configuration.auth.token}`;
        }
        await axios(options);
    }
}
