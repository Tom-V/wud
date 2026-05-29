// @ts-nocheck
import crypto from 'crypto';
import { spawn } from 'child_process';
import bcrypt from 'bcryptjs';

function safeEqual(a, b) {
    const left = Buffer.from(a);
    const right = Buffer.from(b);
    return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function normalizeBcryptHash(hash) {
    return hash.startsWith('$2y$') ? `$2a$${hash.slice(4)}` : hash;
}

function opensslPasswd(args) {
    return new Promise((resolve, reject) => {
        const cmd = spawn('openssl', ['passwd', ...args]);
        const stdout = [];
        const stderr = [];

        cmd.stdout.on('data', (data) => stdout.push(data));
        cmd.stderr.on('data', (data) => stderr.push(data));
        cmd.on('error', reject);
        cmd.on('close', (code) => {
            if (code) {
                reject(
                    new Error(
                        Buffer.concat(stderr).toString().trim() ||
                            `Exit code ${code}`,
                    ),
                );
                return;
            }
            resolve(Buffer.concat(stdout).toString().trim());
        });
    });
}

export async function validateHtpasswdHash(password, hash) {
    try {
        password = password || '';
        hash = hash?.trim() || '';

        if (hash.startsWith('{SHA}')) {
            const digest = crypto
                .createHash('sha1')
                .update(password)
                .digest('base64');
            return safeEqual(`{SHA}${digest}`, hash);
        }

        if (/^\$2[aby]\$/.test(hash)) {
            return bcrypt.compareSync(password, normalizeBcryptHash(hash));
        }

        if (hash.startsWith('$apr1$') || hash.startsWith('$1$')) {
            const [, type, salt] = hash.split('$');
            const result = await opensslPasswd([
                `-${type}`,
                '-salt',
                salt,
                password,
            ]);
            return safeEqual(result, hash);
        }

        if (hash.length === 13) {
            const result = await opensslPasswd([
                '-crypt',
                '-salt',
                hash.slice(0, 2),
                password,
            ]);
            return safeEqual(result, hash);
        }

        return safeEqual(password, hash);
    } catch {
        return false;
    }
}
