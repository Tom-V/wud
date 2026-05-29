// @ts-nocheck
import BasicStrategy from './BasicStrategy';
import Authentication from '../Authentication';
import { validateHtpasswdHash } from './htpasswd';

/**
 * Htpasswd authentication.
 */
class Basic extends Authentication {
    /**
     * Get the Trigger configuration schema.
     * @returns {*}
     */
    getConfigurationSchema() {
        return this.joi.object().keys({
            user: this.joi.string().required(),
            hash: this.joi.string().required(),
        });
    }

    /**
     * Sanitize sensitive data
     * @returns {*}
     */
    maskConfiguration() {
        return {
            user: this.configuration.user,
            hash: Basic.mask(this.configuration.hash),
        };
    }

    /**
     * Return passport strategy.
     */
    getStrategy() {
        return new BasicStrategy((user, pass, done) =>
            this.authenticate(user, pass, done),
        );
    }

    getStrategyDescription() {
        return {
            type: 'basic',
            name: 'Login',
        };
    }

    authenticate(user, pass, done) {
        // No user or different user? => reject
        if (!user || user !== this.configuration.user) {
            done(null, false);
            return;
        }

        // Different password? => reject
        validateHtpasswdHash(pass, this.configuration.hash)
            .then((success) => {
                if (success) {
                    done(null, {
                        username: this.configuration.user,
                    });
                } else {
                    done(null, false);
                }
            })
            .catch(() => done(null, false));
    }
}

export default Basic;
