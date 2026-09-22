import { deflateSync } from 'node:zlib';
import { call } from '../../tools/yzforge/mcp.mjs';
function crc32(bytes) {
    let crc = 0xffffffff;
    for (const byte of bytes) {
        crc ^= byte;
        for (let bit = 0; bit < 8; bit++) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
    }
    return (crc ^ 0xffffffff) >>> 0;
}
function chunk(name, content) {
    const type = Buffer.from(name),
        size = Buffer.alloc(4),
        checksum = Buffer.alloc(4);
    size.writeUInt32BE(content.length);
    checksum.writeUInt32BE(crc32(Buffer.concat([type, content])));
    return Buffer.concat([size, type, content, checksum]);
}
const width = 40,
    height = 40,
    pixels = Buffer.alloc((width * 4 + 1) * height);
for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
        const index = y * (width * 4 + 1) + 1 + x * 4,
            inside = (x - 19.5) ** 2 + (y - 19.5) ** 2 < 19 ** 2;
        pixels.set([102, 225, 177, inside ? 255 : 0], index);
    }
const header = Buffer.alloc(13);
header.writeUInt32BE(width);
header.writeUInt32BE(height, 4);
header[8] = 8;
header[9] = 6;
const png = Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(pixels)),
    chunk('IEND', Buffer.alloc(0)),
]);
const rate = 22050,
    samples = Math.floor(rate * 0.18),
    wav = Buffer.alloc(44 + samples * 2);
wav.write('RIFF');
wav.writeUInt32LE(wav.length - 8, 4);
wav.write('WAVEfmt ', 8);
wav.writeUInt32LE(16, 16);
wav.writeUInt16LE(1, 20);
wav.writeUInt16LE(1, 22);
wav.writeUInt32LE(rate, 24);
wav.writeUInt32LE(rate * 2, 28);
wav.writeUInt16LE(2, 32);
wav.writeUInt16LE(16, 34);
wav.write('data', 36);
wav.writeUInt32LE(samples * 2, 40);
for (let i = 0; i < samples; i++)
    wav.writeInt16LE(
        Math.round(Math.sin((i / rate) * 2 * Math.PI * 660) * Math.sin((Math.PI * i) / samples) * 4500),
        44 + i * 2,
    );
const result = await call('execute_javascript', {
    context: 'editor',
    args: {
        assets: [
            {
                path: 'assets/game/modules/lobby/bundles/default/dynamic/icons/status.png',
                data: png.toString('base64'),
            },
            {
                path: 'assets/game/modules/lobby/bundles/default/dynamic/audio/confirm.wav',
                data: wav.toString('base64'),
            },
        ],
    },
    code: `return await (async()=>{const io=require('fs/promises'), p=require('path'); const saved=[]; for(const asset of args.assets){
  if(!asset.path.startsWith('assets/game/modules/lobby/bundles/default/dynamic/'))throw Error('Unexpected fixture target');
  const target=p.join(Editor.Project.path,asset.path);await io.mkdir(p.dirname(target),{recursive:true});await io.writeFile(target,Buffer.from(asset.data,'base64'),{flag:'wx'});
  await Editor.Message.request('asset-db','refresh-asset','db://'+asset.path); saved.push(await Editor.Message.request('asset-db','query-asset-info','db://'+asset.path));
}return saved.map(info=>({uuid:info.uuid,url:info.url,subAssets:info.subAssets}));})();`,
});
console.log(JSON.stringify(result.data, null, 2));
