export class Logger {
    private _DEBUG = 0;
    private _INFO = 1;
    private _WARN = 2;
    private _ERROR = 3;

    private _logLevel = this._INFO;
    private getLogLevel(): number {
        return this.parent ? this.parent.getLogLevel() : this._logLevel;
    }

    private _prefix?: string;
    private getPrefix(): string {
        const parentPrefix = this.parent ? this.parent.getPrefix() : '';
        const currentPrefix = this._prefix ? this._prefix : '';

        if (parentPrefix && currentPrefix) {
            return ' ' + parentPrefix + ' - ' + currentPrefix;
        }
        const prefix = parentPrefix || currentPrefix || '';
        return prefix ? ' ' + prefix : '';
    }

    private parent?: Logger;

    public child(options: { component: string }) {
        const child = new Logger();
        child.parent = this;
        child._prefix = options.component;
        return child;
    }

    public setLogLevel(logLevel: LogLevel) {
        if (this.parent) {
            this.parent.setLogLevel(logLevel);
            return;
        }

        switch (logLevel) {
            case 'debug':
                this._logLevel = this._DEBUG;
                break;
            case 'warn':
                this._logLevel = this._WARN;
                break;
            case 'error':
                this._logLevel = this._ERROR;
                break;
            default:
            case 'info':
                this._logLevel = this._INFO;
                break;
        }
    }

    private infoColor = '\x1b[33m'; // Yellow
    private warnColor = '\x1b[38;5;214m'; // Orange
    private errorColor = '\x1b[31m'; // Red
    private debugColor = '\x1b[34m'; // Blue
    private resetColor = '\x1b[0m'; // Reset

    private formatDate(date: Date) {
        // HH:mm:ss.fff
        const pad = (num: number) => (num < 10 ? '0' : '') + num;
        return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${pad(date.getMilliseconds())}`;
    }

    private getLogString(level: string, color: string, message: string) {
        const date = this.formatDate(new Date());
        return `${date} ${color}${level}${this.resetColor}${this.getPrefix()}: ${message}`;
    }

    info(message: string) {
        if (this._logLevel > this._INFO) return;
        console.log(this.getLogString('INFO', this.infoColor, message));
    }

    warn(message: string) {
        if (this._logLevel > this._WARN) return;
        console.warn(this.getLogString('WARN', this.warnColor, message));
    }

    error(message: string) {
        console.error(this.getLogString('ERROR', this.errorColor, message));
    }

    debug(message: string) {
        if (this._logLevel > this._DEBUG) return;
        console.debug(this.getLogString('DEBUG', this.debugColor, message));
    }
}

export type LogLevel = 'info' | 'warn' | 'error' | 'debug';
export const logLevels: LogLevel[] = ['info', 'warn', 'error', 'debug'];
export default new Logger();
