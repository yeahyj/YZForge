'use strict';
exports.localizationSettings = function (settings) {
    const config = settings.localization;
    if (config === undefined) return undefined;
    if (
        !config ||
        Object.keys(config).some((key) => !['defaultLocale', 'locales'].includes(key)) ||
        !Array.isArray(config.locales) ||
        !config.locales.length ||
        !config.locales.includes(config.defaultLocale) ||
        new Set(config.locales).size !== config.locales.length
    )
        throw Error('多语言设置需要默认语言和不重复的支持语言列表');
    for (const locale of config.locales) {
        if (
            typeof locale !== 'string' ||
            !/^[a-zA-Z]{2,8}(?:-[a-zA-Z0-9]{1,8})*$/.test(locale) ||
            Intl.getCanonicalLocales(locale)[0] !== locale
        )
            throw Error(`语言标识必须为标准写法，例如 zh-CN、en：${locale}`);
    }
    return { defaultLocale: config.defaultLocale, locales: [...config.locales] };
};
/** Shared by Creator and the command line; no engine or project-specific defaults. */
exports.runtimeOptions = function (settings) {
    exports.localizationSettings(settings);
    if (!settings || settings.formatVersion !== 1) throw Error('Unsupported framework settings version');
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(settings.appId || ''))
        throw Error('appId must be a stable application identifier');
    if (!Number.isFinite(settings.cleanupTimeoutMs) || settings.cleanupTimeoutMs <= 0)
        throw Error('cleanupTimeoutMs must be positive');
    if (!Number.isSafeInteger(settings.maxAudioVoices) || settings.maxAudioVoices <= 0)
        throw Error('maxAudioVoices must be a positive integer');
    const wechatPerformanceUnit = settings.wechatPerformanceUnit || 'microseconds';
    if (!['microseconds', 'milliseconds'].includes(wechatPerformanceUnit))
        throw Error('Invalid WeChat performance unit');
    const channels = settings.audioChannels || {};
    for (const [name, volume] of Object.entries(channels)) {
        if (
            !/^[a-z][a-z0-9-]*$/.test(name) ||
            ['master', 'constructor', 'prototype'].includes(name) ||
            !Number.isFinite(volume) ||
            volume < 0 ||
            volume > 1
        )
            throw Error(`Invalid audio channel: ${name}`);
    }
    const rules = { offsetMinutes: 0, weekStartsOn: 1, resetMinute: 0, ...settings.calendar };
    for (const name of Object.keys(rules))
        if (!['offsetMinutes', 'weekStartsOn', 'resetMinute'].includes(name))
            throw Error(`Unknown calendar setting: ${name}`);
    if (
        !Number.isInteger(rules.offsetMinutes) ||
        Math.abs(rules.offsetMinutes) > 840 ||
        !Number.isInteger(rules.weekStartsOn) ||
        rules.weekStartsOn < 0 ||
        rules.weekStartsOn > 6 ||
        !Number.isInteger(rules.resetMinute) ||
        rules.resetMinute < 0 ||
        rules.resetMinute > 1439
    )
        throw Error('Invalid calendar offset, week start or reset minute');
    const types = [
        'Node',
        'Component',
        'Button',
        'Label',
        'Sprite',
        'EditBox',
        'ScrollView',
        'Toggle',
        'Slider',
        'RichText',
        'UITransform',
        'Layout',
        'ProgressBar',
        'PageView',
        'Mask',
        'Widget',
        'UIOpacity',
    ];
    if (
        !settings.bindingPrefixes ||
        Object.entries(settings.bindingPrefixes).some(([key, type]) => !/^[a-z]+$/.test(key) || !types.includes(type))
    )
        throw Error('Invalid binding prefix/component mapping');
    return {
        appId: settings.appId,
        cleanupTimeoutMs: settings.cleanupTimeoutMs,
        maxAudioVoices: settings.maxAudioVoices,
        audioChannels: channels,
        time: { calendar: rules },
        clockOptions: { wechatPerformanceUnit },
    };
};
