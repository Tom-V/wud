import { ValidationError } from 'joi';
import { Telegram, TelegramConfiguration } from './Telegram';
import { Container } from '../../../model/container';

const telegram = new Telegram();

const configurationValid: TelegramConfiguration = {
    bottoken: 'token',
    chatid: '123456789',
    threshold: 'all',
    mode: 'simple',
    once: true,
    auto: true,
    simpletitle:
        'New ${container.updateKind.kind} found for container ${container.name}',

    simplebody:
        'Container ${container.name} running with ${container.updateKind.kind} ${container.updateKind.localValue} can be updated to ${container.updateKind.kind} ${container.updateKind.remoteValue}${container.result && container.result.link ? "\\n" + container.result.link : ""}',

    batchtitle: '${containers.length} updates available',
    disabletitle: false,
    messageformat: 'Markdown',
};

beforeEach(() => {
    jest.resetAllMocks();
});

test('validateConfiguration should return validated configuration when valid', () => {
    const validatedConfiguration =
        telegram.validateConfiguration(configurationValid);
    expect(validatedConfiguration).toStrictEqual(configurationValid);
});

test('validateConfiguration should throw error when invalid', () => {
    const configuration = {} as TelegramConfiguration;
    expect(() => {
        telegram.validateConfiguration(configuration);
    }).toThrowError(ValidationError);
});

test('maskConfiguration should mask sensitive data', () => {
    telegram.configuration = configurationValid;
    expect(telegram.maskConfiguration()).toEqual({
        batchtitle: '${containers.length} updates available',
        bottoken: 't***n',
        chatid: '1*******9',
        mode: 'simple',
        once: true,
        auto: true,
        simplebody:
            'Container ${container.name} running with ${container.updateKind.kind} ${container.updateKind.localValue} can be updated to ${container.updateKind.kind} ${container.updateKind.remoteValue}${container.result && container.result.link ? "\\n" + container.result.link : ""}',

        simpletitle:
            'New ${container.updateKind.kind} found for container ${container.name}',
        threshold: 'all',
        disabletitle: false,
        messageformat: 'Markdown',
    });
});

test('should send message with correct text', async () => {
    telegram.configuration = {
        ...configurationValid,
        simpletitle: 'Test Title',
        simplebody: 'Test Body',
    };
    telegram.sendMessage = jest.fn();
    await telegram.trigger({} as Container);
    expect(telegram.sendMessage).toHaveBeenCalledWith(
        '*Test Title*\n\nTest Body',
    );
});

test.each([
    { messageformat: 'Markdown' as const, expected: '*Test Title*\n\nTest Body' },
    { messageformat: 'HTML' as const, expected: '<b>Test Title</b>\n\nTest Body' },
])(
    'should send message with correct text in %s format',
    async ({ messageformat, expected }) => {
        telegram.configuration = {
            ...configurationValid,
            simpletitle: 'Test Title',
            simplebody: 'Test Body',
            messageformat: messageformat,
        };
        telegram.sendMessage = jest.fn();
        await telegram.trigger({} as Container);
        expect(telegram.sendMessage).toHaveBeenCalledWith(expected);
    },
);

test('disabletitle should result in no title in message', async () => {
    telegram.configuration = {
        ...configurationValid,
        simpletitle: 'Test Title',
        simplebody: 'Test Body',
        disabletitle: true,
    };

    telegram.sendMessage = jest.fn();
    await telegram.trigger({} as Container);

    expect(telegram.sendMessage).toHaveBeenCalledWith('Test Body');
});
