import { parseDockerImageName } from './image';

describe('parseDockerImageName', () => {
    test.each([
        ['alpine', { path: 'alpine' }],
        [
            'alpine@sha256:aaaaf56b44807c64d294e6c8059b479f35350b454492398225034174808d1726',
            {
                path: 'alpine',
                digest: 'sha256:aaaaf56b44807c64d294e6c8059b479f35350b454492398225034174808d1726',
            },
        ],
        ['registry:2', { path: 'registry', tag: '2' }],
        ['jpetazzo/pxe', { path: 'jpetazzo/pxe' }],
        ['jpetazzo/pxe:latest', { path: 'jpetazzo/pxe', tag: 'latest' }],
        [
            'quay.io/signalfuse/zookeeper',
            { domain: 'quay.io', path: 'signalfuse/zookeeper' },
        ],
        [
            'index.docker.io/library/ubuntu:latest',
            {
                domain: 'index.docker.io',
                path: 'library/ubuntu',
                tag: 'latest',
            },
        ],
        [
            'internal.mycorp.com:5000/revealjs',
            { domain: 'internal.mycorp.com:5000', path: 'revealjs' },
        ],
        [
            'internal.mycorp.com:5000/revealjs:3.4.5-3',
            {
                domain: 'internal.mycorp.com:5000',
                path: 'revealjs',
                tag: '3.4.5-3',
            },
        ],
        [
            'localhost:5000/mart/mass:latest',
            { domain: 'localhost:5000', path: 'mart/mass', tag: 'latest' },
        ],
        ['localhost:5000/mass', { domain: 'localhost:5000', path: 'mass' }],
        ['localhost/mass', { domain: 'localhost', path: 'mass' }],
        [
            'ghcr.io/getwud/wud:1.2.3@sha256:abc',
            {
                domain: 'ghcr.io',
                path: 'getwud/wud',
                tag: '1.2.3',
                digest: 'sha256:abc',
            },
        ],
    ])('parses %s', (image, expected) => {
        expect(parseDockerImageName(image)).toEqual(expected);
    });
});
