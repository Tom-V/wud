import { ValidationError } from 'joi';
import { Ntfy, NtfyConfiguration } from './Ntfy';
import { Container } from '../../../model/container';
import axios from 'axios';
jest.mock('axios');

const ntfy = new Ntfy();

const configurationValid: NtfyConfiguration = {
    url: 'http://xxx.com',
    topic: 'xxx',
    priority: 2,
    mode: 'simple',
    threshold: 'all',
    once: true,
    auto: true,
    simpletitle:
        'New ${container.updateKind.kind} found for container ${container.name}',

    simplebody:
        'Container ${container.name} running with ${container.updateKind.kind} ${container.updateKind.localValue} can be updated to ${container.updateKind.kind} ${container.updateKind.remoteValue}${container.result && container.result.link ? "\\n" + container.result.link : ""}',

    batchtitle: '${containers.length} updates available',
};

beforeEach(() => {
    jest.resetAllMocks();
});

test('validateConfiguration should return validated configuration when valid', () => {
    const validatedConfiguration =
        ntfy.validateConfiguration(configurationValid);
    expect(validatedConfiguration).toStrictEqual(configurationValid);
});

test('validateConfiguration should throw error when invalid', () => {
    const configuration = {
        url: 'git://xxx.com',
    } as NtfyConfiguration;
    expect(() => {
        ntfy.validateConfiguration(configuration);
    }).toThrowError(ValidationError);
});

test('trigger should call http client', async () => {
    ntfy.configuration = configurationValid;
    const container = {
        name: 'container1',
        updateKind: {
            kind: 'tag',
            localValue: '1.0.0',
            remoteValue: '2.0.0',
        },
    } as Container;
    await ntfy.trigger(container);
    expect(axios).toHaveBeenCalledWith({
        data: {
            message:
                'Container container1 running with tag 1.0.0 can be updated to tag 2.0.0',
            priority: 2,
            title: 'New tag found for container container1',
            topic: 'xxx',
        },
        headers: {
            'Content-Type': 'application/json',
        },
        method: 'POST',
        url: 'http://xxx.com',
    });
});

test('trigger should use basic auth when configured like that', async () => {
    ntfy.configuration = {
        ...configurationValid,
        auth: { user: 'user', password: 'pass' },
    };
    const container = {
        name: 'container1',
        updateKind: {
            kind: 'tag',
            localValue: '1.0.0',
            remoteValue: '2.0.0',
        },
    } as Container;
    await ntfy.trigger(container);
    expect(axios).toHaveBeenCalledWith({
        data: {
            message:
                'Container container1 running with tag 1.0.0 can be updated to tag 2.0.0',
            priority: 2,
            title: 'New tag found for container container1',
            topic: 'xxx',
        },
        headers: {
            'Content-Type': 'application/json',
        },
        method: 'POST',
        url: 'http://xxx.com',
        auth: { username: 'user', password: 'pass' },
    });
});

test('trigger should use bearer auth when configured like that', async () => {
    ntfy.configuration = {
        ...configurationValid,
        auth: { token: 'token' },
    };
    const container = {
        name: 'container1',
        updateKind: {
            kind: 'tag',
            localValue: '1.0.0',
            remoteValue: '2.0.0',
        },
    } as Container;
    await ntfy.trigger(container);
    expect(axios).toHaveBeenCalledWith({
        data: {
            message:
                'Container container1 running with tag 1.0.0 can be updated to tag 2.0.0',
            priority: 2,
            title: 'New tag found for container container1',
            topic: 'xxx',
        },
        headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer token'
        },
        method: 'POST',
        url: 'http://xxx.com',
    });
});
