# YZForge 框架迁移

这个目录保存随 YZForge 发布的项目迁移脚本。文件按名称排序仅用于阅读；实际执行顺序由脚本声明的 `from` 和 `to` 版本决定。

迁移文件导出一个对象：

```js
'use strict';

module.exports = {
  id: '0.3.0-to-0.4.0',
  from: '0.3.0',
  to: '0.4.0',
  description: '迁移旧版项目结构。',
  run(context) {
    const value = context.readJson('some-file.json', {});
    context.writeJson('some-file.json', value);
  },
};
```

`context` 提供以下能力：

- `projectRoot`：项目绝对路径。
- `check`：当前是否只做升级检查。
- `exists(path)`：检查项目内路径。
- `readJson(path, fallback)` / `readText(path, fallback)`：读取项目文件。
- `writeJson(path, value)` / `writeText(path, content)`：写入或在检查模式下报告变化。
- `remove(path)`：删除或在检查模式下报告待删除路径。

迁移必须可以从当前版本连续走到目标版本。缺少迁移路径时，升级器会直接失败，不会猜测或跳过版本。

迁移应只通过 `context` 修改项目内文件，并保证重复执行仍然得到相同结果。健康检查通过后升级器才会推进版本锁；如果升级中断，修复问题后可能会重新执行同一迁移。
