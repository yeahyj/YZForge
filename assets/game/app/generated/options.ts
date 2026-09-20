// Generated project settings. Framework defaults do not select a game, resolution or time zone.
import type { AppOptions } from '../../../framework/core/app';
export const runtimeOptions: Pick<
    AppOptions,
    'appId' | 'cleanupTimeoutMs' | 'maxAudioVoices' | 'audioChannels' | 'time' | 'clockOptions'
> = {
    appId: 'com.example.yzforge-demo',
    cleanupTimeoutMs: 10000,
    maxAudioVoices: 16,
    audioChannels: {
        bgm: 1,
        sfx: 1,
        voice: 1,
    },
    time: {
        calendar: {
            offsetMinutes: 0,
            weekStartsOn: 1,
            resetMinute: 0,
        },
    },
    clockOptions: {
        wechatPerformanceUnit: 'microseconds',
    },
};
