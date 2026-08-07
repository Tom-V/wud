import Ghcr from '../ghcr/Ghcr';

/**
 * Trueforge Container Registry integration.
 */
class Trueforge extends Ghcr {
    protected registryPattern = /^.*\.?oci.trueforge.org$/;

    match(imageUrl: string) {
        return imageUrl === 'oci.trueforge.org';
    }

    getConfigurationSchema() {
        return this.joi.object().keys({
            username: this.joi.string().required(),
            token: this.joi.string().required(),
        });
    }
}

export default Trueforge;
