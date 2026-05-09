import { WebClient } from '@slack/web-api';
import Trigger from '../Trigger';
import { Container } from '../../../model/container';

/*
 * Slack Trigger implementation
 */
class Slack extends Trigger {
    /*
     * Get the Trigger configuration schema.
     * @returns {*}
     */
    getConfigurationSchema() {
        return this.joi.object().keys({
            token: this.joi.string().required(),
            channel: this.joi.string().required(),
            disabletitle: this.joi.boolean().default(false),
        });
    }

    /**
     * Sanitize sensitive data
     * @returns {*}
     */
    maskConfiguration() {
        return {
            ...this.configuration,
            channel: this.configuration.channel,
            token: Slack.mask(this.configuration.token),
        };
    }

    private client: WebClient;
    /*
     * Init trigger.
     */
    async initTrigger() {
        this.client = new WebClient(this.configuration.token);
    }

    /*
     * Post a message with new image version details.
     *
     * @param image the image
     * @returns {Promise<void>}
     */
    async trigger(container: Container) {
        const body = this.renderSimpleBody(container);

        if (this.configuration.disabletitle) {
            await this.sendMessage(body);
            return;
        }

        const title = this.renderSimpleTitle(container);
        await this.sendMessage(`*${title}*\n\n${body}`);
    }

    async triggerBatch(containers: Container[]) {
        const body = this.renderBatchBody(containers);
        if (this.configuration.disabletitle) {
            await this.sendMessage(body);
            return;
        }

        const title = this.renderBatchTitle(containers);
        await this.sendMessage(`*${title}*\n\n${body}`);
    }

    /**
     * Post a message to a Slack channel.
     * @param text the text to post
     * @returns {Promise<ChatPostMessageResponse>}
     */
    async sendMessage(text) {
        return this.client.chat.postMessage({
            channel: this.configuration.channel,
            text,
        });
    }
}

export default Slack;
