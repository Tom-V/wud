// @ts-nocheck
import bcrypt from 'bcryptjs';
import { validateHtpasswdHash } from './htpasswd';

jest.mock('child_process', () => ({
    spawn: jest.fn((_command, args) => {
        const { EventEmitter } = jest.requireActual('events');
        const child = new EventEmitter();
        child.stdout = new EventEmitter();
        child.stderr = new EventEmitter();

        const password = args[args.length - 1];
        let result = 'invalid';

        if (password === 'myPassword' && args[1] === '-apr1') {
            result = '$apr1$r31.....$HqJZimcKQFAMYayBlzkrA/';
        } else if (password === 'myPassword' && args[1] === '-1') {
            result = '$1$saltsalt$2vnaRpHa6Jxjz5n83ok8Z0';
        } else if (password === 'myPassword' && args[1] === '-crypt') {
            result = 'rqXexS6ZhobKA';
        }

        process.nextTick(() => {
            child.stdout.emit('data', Buffer.from(result));
            child.emit('close', 0);
        });

        return child;
    }),
}));

describe('htpasswd validation', () => {
    test('should validate SHA1 hashes', async () => {
        expect(
            await validateHtpasswdHash(
                'myPassword',
                '{SHA}VBPuJHI7uixaa6LQGWx4s+5GKNE=',
            ),
        ).toBe(true);
        expect(
            await validateHtpasswdHash(
                'myPass',
                '{SHA}VBPuJHI7uixaa6LQGWx4s+5GKNE=',
            ),
        ).toBe(false);
    });

    test('should validate Apache MD5 hashes', async () => {
        expect(
            await validateHtpasswdHash(
                'myPassword',
                '$apr1$r31.....$HqJZimcKQFAMYayBlzkrA/',
            ),
        ).toBe(true);
        expect(
            await validateHtpasswdHash(
                'myPass',
                '$apr1$r31.....$HqJZimcKQFAMYayBlzkrA/',
            ),
        ).toBe(false);
    });

    test('should validate MD5 crypt hashes', async () => {
        expect(
            await validateHtpasswdHash(
                'myPassword',
                '$1$saltsalt$2vnaRpHa6Jxjz5n83ok8Z0',
            ),
        ).toBe(true);
        expect(
            await validateHtpasswdHash(
                'myPass',
                '$1$saltsalt$2vnaRpHa6Jxjz5n83ok8Z0',
            ),
        ).toBe(false);
    });

    test('should validate crypt hashes', async () => {
        expect(await validateHtpasswdHash('myPassword', 'rqXexS6ZhobKA')).toBe(
            true,
        );
        expect(await validateHtpasswdHash('myPass', 'rqXexS6ZhobKA')).toBe(
            false,
        );
    });

    test('should validate bcrypt hashes', async () => {
        const hash = bcrypt.hashSync('myPassword', 4);

        expect(await validateHtpasswdHash('myPassword', hash)).toBe(true);
        expect(await validateHtpasswdHash('myPass', hash)).toBe(false);
    });

    test('should validate htpasswd bcrypt y hashes', async () => {
        const hash = bcrypt.hashSync('myPassword', 4).replace('$2b$', '$2y$');

        expect(await validateHtpasswdHash('myPassword', hash)).toBe(true);
        expect(await validateHtpasswdHash('myPass', hash)).toBe(false);
    });

    test('should validate plain text hashes', async () => {
        expect(await validateHtpasswdHash('myPassword', 'myPassword')).toBe(
            true,
        );
        expect(await validateHtpasswdHash('myPass', 'myPassword')).toBe(false);
    });

    test('should reject malformed hashes', async () => {
        expect(await validateHtpasswdHash('myPassword', '$2b$bad')).toBe(false);
    });
});
