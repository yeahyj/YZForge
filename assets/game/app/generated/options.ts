// 自动生成的项目设置，请通过工作台或源设置文件修改。
import type { AppOptions } from '../../../framework/core/app';
/** App 的音频、日历及清理参数；日历 offsetMinutes 为固定时区分钟偏移，480 表示 UTC+8。 */
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
