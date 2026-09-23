'use strict';
exports.configs = {
    '*': {
        hooks: './build-hooks.js',
        options: {
            configHash: {
                label: '游戏配置标识',
                default: '',
                render: { ui: 'ui-input', attributes: { readonly: true } },
            },
        },
    },
};
