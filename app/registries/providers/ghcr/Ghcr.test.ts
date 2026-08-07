import { ContainerImage } from '../../../model/container';
import Ghcr from './Ghcr';
import { testRegistryProvider } from '../RegistryTestHelper';

const validConfig = {
    username: 'testuser',
    token: 'testtoken',
};

describe('GitHub Container Registry specific tests', () => {
    let ghcr: Ghcr;

    beforeEach(async () => {
        ghcr = new Ghcr();
        await ghcr.register('registry', 'ghcr', 'test', validConfig);
    });

    // testRegistryProvider boilerplate handles create instance

    test('should match registry', async () => {
        expect(ghcr.match('ghcr.io')).toBe(true);
        expect(ghcr.match('docker.io')).toBe(false);
        expect(ghcr.match('subdomain.ghcr.io')).toBe(false);
    });

    test('should allow any namespace when no namespaces are configured', async () => {
        expect(ghcr.match('ghcr.io', 'account-one/image')).toBe(true);
        expect(ghcr.match('ghcr.io', 'account-two/image')).toBe(true);
    });

    test('should match any configured namespace', async () => {
        ghcr.configuration.namespaces = ['account-one', 'account-two'];

        expect(ghcr.match('ghcr.io', 'account-one/image')).toBe(true);
        expect(ghcr.match('ghcr.io', 'account-two/image')).toBe(true);
        expect(ghcr.match('ghcr.io', 'account-three/image')).toBe(false);
    });

    test('should support comma-separated namespaces', async () => {
        ghcr.configuration.namespaces = 'account-one, account-two';

        expect(ghcr.match('ghcr.io', 'account-two/image')).toBe(true);
    });

    test('should normalize image name', async () => {
        const image = {
            name: 'user/repo',
            registry: { url: 'ghcr.io' },
        } as ContainerImage;
        const normalized = ghcr.normalizeImage(image);
        expect(normalized.name).toBe('user/repo');
        expect(normalized.registry.url).toBe('https://ghcr.io/v2');
    });

    test('should not modify URL if already starts with https', async () => {
        const image = {
            name: 'user/repo',
            registry: { url: 'https://ghcr.io/v2' },
        } as ContainerImage;
        const normalized = ghcr.normalizeImage(image);
        expect(normalized.registry.url).toBe('https://ghcr.io/v2');
    });

    test('should mask configuration token', async () => {
        ghcr.configuration = { username: 'testuser', token: 'secret_token' };
        const masked = ghcr.maskConfiguration();
        expect(masked.username).toBe('testuser');
        expect(masked.token).toBe('s**********n');
    });

    test('should return auth pull credentials', async () => {
        ghcr.configuration = { username: 'testuser', token: 'testtoken' };
        const auth = await ghcr.getAuthPull();
        expect(auth).toEqual({
            username: 'testuser',
            password: 'testtoken',
        });
    });

    test('should return undefined auth pull when no credentials', async () => {
        ghcr.configuration = {};
        const auth = await ghcr.getAuthPull();
        expect(auth).toBeUndefined();
    });

    test('should authenticate with token', async () => {
        ghcr.configuration = { token: 'test-token' };
        const image = { name: 'user/repo' } as ContainerImage;
        const requestOptions = { headers: {} };

        const result = await ghcr.authenticate(image, requestOptions);

        const expectedBearer = Buffer.from('test-token', 'utf-8').toString(
            'base64',
        );
        expect(result.headers.Authorization).toBe(`Bearer ${expectedBearer}`);
    });

    test('should authenticate without token', async () => {
        ghcr.configuration = {};
        const image = { name: 'user/repo' } as ContainerImage;
        const requestOptions = { headers: {} };

        const result = await ghcr.authenticate(image, requestOptions);

        const expectedBearer = Buffer.from(':', 'utf-8').toString('base64');
        expect(result.headers.Authorization).toBe(`Bearer ${expectedBearer}`);
    });

    // testRegistryProvider boilerplate handles validate string configuration

    test('should validate namespaces configuration', async () => {
        expect(() =>
            ghcr.validateConfiguration({
                username: 'testuser',
                token: 'testtoken',
                namespaces: ['test-namespace', 'another-namespace'],
            }),
        ).not.toThrow();
    });

    test('should return undefined auth pull when missing username', async () => {
        ghcr.configuration = { token: 'test-token' };
        const auth = await ghcr.getAuthPull();
        expect(auth).toBeUndefined();
    });

    test('should return undefined auth pull when missing token', async () => {
        ghcr.configuration = { username: 'testuser' };
        const auth = await ghcr.getAuthPull();
        expect(auth).toBeUndefined();
    });

    test('should return undefined auth pull when no credentials', async () => {
        ghcr.configuration = {};
        const auth = await ghcr.getAuthPull();
        expect(auth).toBeUndefined();
    });
});

testRegistryProvider(Ghcr, validConfig, {
    matchingUrls: ['ghcr.io'],
    nonMatchingUrls: ['docker.io'],
    sampleImage: {
        input: {
            name: 'user/repo',
            registry: { url: 'ghcr.io' },
        },
        expected: {
            name: 'user/repo',
            registry: { url: 'https://ghcr.io/v2' },
        },
    },
    maskConfig: {
        input: validConfig,
        expected: {
            username: 'testuser',
            token: 't*******n',
        },
    },
    authPullConfig: {
        input: validConfig,
        expected: {
            username: 'testuser',
            password: 'testtoken',
        },
    },
});
