export enum AppProfile {
    Debug = 'debug',
    Release = 'release',
}

export interface AppBootProfile {
    readonly channel: string;
    readonly profile: string;
    readonly debug: boolean;
}

export interface AppBootProfileInput {
    readonly channel?: string;
    readonly profile?: AppProfile | string;
    readonly debug?: boolean;
}

export const DefaultAppBootProfile: AppBootProfile = Object.freeze({
    channel: 'default',
    profile: AppProfile.Debug,
    debug: true,
});

export function normalizeAppBootProfile(input: AppBootProfileInput = {}): AppBootProfile {
    const channel = normalizeName(input.channel, DefaultAppBootProfile.channel);
    const profile = normalizeName(input.profile, DefaultAppBootProfile.profile);
    const debug = input.debug ?? profile !== AppProfile.Release;
    return {
        channel,
        profile,
        debug,
    };
}

function normalizeName(value: unknown, fallback: string): string {
    if (typeof value !== 'string') {
        return fallback;
    }
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : fallback;
}
