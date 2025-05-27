import { Logger } from '../../../log';
import { Anonymous } from './Anonymous';

const anonymous = new Anonymous();
anonymous.log = new Logger() as Logger;
jest.spyOn(anonymous.log, 'info').mockImplementation(jest.fn());

const configurationValid = {};

beforeEach(() => {
    jest.resetAllMocks();
    // Mock the log property
    (anonymous as any).log = { warn: jest.fn() };
});

test('validateConfiguration should return validated configuration when valid', () => {
    const validatedConfiguration =
        anonymous.validateConfiguration(configurationValid);
    expect(validatedConfiguration).toStrictEqual(configurationValid);
});

test('getStrategy should return an Authentication strategy', () => {
    const strategy = anonymous.getStrategy();
    expect(strategy.name).toEqual('anonymous');
});
