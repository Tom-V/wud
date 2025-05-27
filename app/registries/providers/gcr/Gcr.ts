import { Registry } from '../../Registry';
import { ContainerImage } from '../../../model/container';
import axios, { AxiosRequestConfig } from 'axios';

export interface GcrConfiguration {
    clientemail: string;
    privatekey: string;
}

/**
 * Google Container Registry integration.
 */
export class Gcr extends Registry<GcrConfiguration> {
    getConfigurationSchema() {
        return this.joi.alternatives([
            this.joi.string().allow(''),
            this.joi.object().keys({
                clientemail: this.joi.string().required(),
                privatekey: this.joi.string().required(),
            }),
        ]);
    }

    /**
     * Sanitize sensitive data
     */
    maskConfiguration() {
        return {
            ...this.configuration,
            clientemail: this.configuration.clientemail,
            privatekey: Gcr.mask(this.configuration.privatekey),
        };
    }

    /**
     * Return true if image has not registry url.
     * @param image the image
     */

    match(image: ContainerImage) {
        return /^.*\.?gcr.io$/.test(image.registry.url);
    }

    /**
     * Normalize image according to AWS ECR characteristics.
     * @param image
     */

    normalizeImage(image: ContainerImage) {
        const imageNormalized = image;
        if (!imageNormalized.registry.url.startsWith('https://')) {
            imageNormalized.registry.url = `https://${imageNormalized.registry.url}/v2`;
        }
        return imageNormalized;
    }

    async authenticate(image: ContainerImage, requestOptions: AxiosRequestConfig) {
        if (!this.configuration.clientemail) {
            return requestOptions;
        }
        const request = {
            method: 'GET',
            url: `https://gcr.io/v2/token?scope=repository:${image.name}:pull`,
            headers: {
                Accept: 'application/json',
                Authorization: `Basic ${Gcr.base64Encode(
                    '_json_key',
                    JSON.stringify({
                        client_email: this.configuration.clientemail,
                        private_key: this.configuration.privatekey,
                    }),
                )}`,
            },
        };

        const response = await axios(request);
        const requestOptionsWithAuth = requestOptions;
        requestOptionsWithAuth.headers!.Authorization = `Bearer ${response.data.token}`;
        return requestOptionsWithAuth;
    }

    getAuthPull() {
        return {
            username: this.configuration.clientemail,
            password: this.configuration.privatekey,
        };
    }
}
