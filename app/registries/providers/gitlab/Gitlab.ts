import { Registry } from '../../Registry';
import { ContainerImage } from '../../../model/container';
import axios, { AxiosRequestConfig } from 'axios';

export interface GitlabConfiguration {
    url: string;
    authurl: string;
    token: string;
}

/**
 * Docker Gitlab integration.
 */
export class Gitlab extends Registry<GitlabConfiguration> {
    /**
     * Get the Gitlab configuration schema.
     */
    getConfigurationSchema() {
        return this.joi.object().keys({
            url: this.joi.string().uri().default('https://registry.gitlab.com'),
            authurl: this.joi.string().uri().default('https://gitlab.com'),
            token: this.joi.string().required(),
        });
    }

    /**
     * Sanitize sensitive data
     */
    maskConfiguration() {
        return {
            ...this.configuration,
            url: this.configuration.url,
            authurl: this.configuration.authurl,
            token: Gitlab.mask(this.configuration.token),
        };
    }

    /**
     * Return true if image has no registry url.
     * @param image the image
     */
    match(image: ContainerImage) {
        return this.configuration.url.indexOf(image.registry.url) !== -1;
    }

    /**
     * Normalize images according to Gitlab characteristics.
     * @param image
     */

    normalizeImage(image: ContainerImage) {
        const imageNormalized = image;
        if (!imageNormalized.registry.url.startsWith('https://')) {
            imageNormalized.registry.url = `https://${imageNormalized.registry.url}/v2`;
        }
        return imageNormalized;
    }

    /**
     * Authenticate to Gitlab.
     * @param image
     * @param requestOptions
     */
    async authenticate(image: ContainerImage, requestOptions: AxiosRequestConfig) {
        const request = {
            method: 'GET',
            url: `${this.configuration.authurl}/jwt/auth?service=container_registry&scope=repository:${image.name}:pull`,
            headers: {
                Accept: 'application/json',
                Authorization: `Basic ${Gitlab.base64Encode('', this.configuration.token)}`,
            },
        };
        const response = await axios(request);
        const requestOptionsWithAuth = requestOptions;
        requestOptionsWithAuth.headers!.Authorization = `Bearer ${response.data.token}`;
        return requestOptionsWithAuth;
    }

    /**
     * Return empty username and personal access token value.
     */
    getAuthPull() {
        return {
            username: '',
            password: this.configuration.token,
        };
    }
}
