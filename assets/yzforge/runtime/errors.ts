export class YZForgeError extends Error {
    public constructor(
        message: string,
        public readonly code: string,
        public readonly details?: unknown,
    ) {
        super(message);
        this.name = 'YZForgeError';
    }
}

export function fail(code: string, message: string, details?: unknown): never {
    throw new YZForgeError(message, code, details);
}
