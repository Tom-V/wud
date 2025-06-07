import TelegramBot from 'node-telegram-bot-api';
import { Trigger, TriggerConfiguration } from '../Trigger';
import { Container } from '../../../model/container';

export interface TelegramConfiguration extends TriggerConfiguration {
    bottoken: string;
    chatid: string;
    disabletitle: boolean;
    messageformat: 'Markdown' | 'HTML';
}

/**
 * Telegram Trigger implementation
 */
export class Telegram extends Trigger<TelegramConfiguration> {
    telegramBot!: TelegramBot;

    /**
     * Get the Trigger configuration schema.
     * @returns {*}
     */
    getConfigurationSchema() {
        return this.joi.object().keys({
            bottoken: this.joi.string().required(),
            chatid: this.joi.string().required(),
            disabletitle: this.joi.boolean().default(false),
            messageformat: this.joi.string().valid('Markdown', 'HTML').insensitive().default('Markdown'),
        });
    }

    /**
     * Sanitize sensitive data
     */
    maskConfiguration() {
        return {
            ...this.configuration,
            bottoken: Telegram.mask(this.configuration.bottoken),
            chatid: Telegram.mask(this.configuration.chatid),
        };
    }

    /**
     * Init trigger (create telegram client).
     */
    async initTrigger() {
        this.telegramBot = new TelegramBot(this.configuration.bottoken);
    }

    /*
     * Post a message with new image version details.
     *
     * @param image the image
     */
    async trigger(container: Container) {
        const body = this.renderSimpleBody(container);

        if (this.configuration.disabletitle) {
            return this.sendMessage(body);
        }

        const title = this.renderSimpleTitle(container);

        return this.sendMessage(`${this.bold(title)}\n\n${body}`);
    }

    async triggerBatch(containers: Container[]) {
        const body = this.renderBatchBody(containers);
        if (this.configuration.disabletitle) {
            return this.sendMessage(body);
        }

        const title = this.renderBatchTitle(containers);
        return this.sendMessage(`${this.bold(title)}\n\n${body}`);
    }

    /**
     * Post a message to a Slack channel.
     * @param text the text to post
     * @returns {Promise<>}
     */
    async sendMessage(text: string) {
        return this.telegramBot.sendMessage(this.configuration.chatid, text, {
            parse_mode: this.getParseMode(),
        });
    }

    private bold(text: string) {
        return this.configuration.messageformat.toLowerCase() === 'markdown' ? `*${text}*` : `<b>${text}</b>`;
    }

    private getParseMode() {
        return this.configuration.messageformat.toLowerCase() === 'markdown' ? 'MarkdownV2' : 'HTML';
    }
}
