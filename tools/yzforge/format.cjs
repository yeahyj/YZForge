const prettier = require('prettier');

/** Used only by editor/build tools; never imported by the game runtime. */
exports.formatScript = async function formatScript(filePath, source) {
    const options = await prettier.resolveConfig(filePath, { useCache: false });
    if (!options) throw Error(`Missing project Prettier configuration for ${filePath}`);
    return prettier.format(source, { ...options, filepath: filePath });
};
