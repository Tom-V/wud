import { AxiosRequestConfig } from 'axios';
import { ContainerImage } from '../../../model/container';
import DockerRegistryV2 from '../../DockerRegistryV2';
import { AnySchema } from 'joi';

/**
 * Github Container Registry integration.
 */
class Ghcr extends DockerRegistryV2 {
    protected registryPattern = /^.*\.?ghcr.io$/;

    getConfigurationSchema(): AnySchema {
        return this.joi.alternatives([
            this.joi.string().allow(''),
            this.joi.object().keys({
                username: this.joi.string().required(),
                token: this.joi.string().required(),
                namespaces: this.joi
                    .alternatives()
                    .try(
                        this.joi.string().min(1),
                        this.joi.array().items(this.joi.string().min(1)).min(1),
                    ),
            }),
        ]);
    }

    maskConfiguration() {
        return this.maskSensitiveFields(['token']);
    }

    match(imageUrl: string, imageName?: string) {
        if (imageUrl !== 'ghcr.io') {
            return false;
        }

        const configuredNamespaces = (
            Array.isArray(this.configuration.namespaces)
                ? this.configuration.namespaces
                : this.configuration.namespaces?.split(',') || []
        ).map((namespace: string) => namespace.trim().toLowerCase());

        const imageNamespace = imageName?.split('/')[0]?.toLowerCase();
        return (
            configuredNamespaces.length === 0 ||
            (imageNamespace !== undefined &&
                configuredNamespaces.includes(imageNamespace))
        );
    }

    normalizeImage(image: ContainerImage) {
        return this.normalizeImageUrl(image);
    }

    async authenticate(
        image: ContainerImage,
        requestOptions: AxiosRequestConfig,
    ) {
        const token = Buffer.from(
            this.configuration.token || ':',
            'utf-8',
        ).toString('base64');
        return this.authenticateBearer(requestOptions, token);
    }
}

export default Ghcr;
