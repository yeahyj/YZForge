# 多语言目录规划

状态：已按此结构迁移并实现。实际使用、原生组件与四种示例见 [多语言文档](localization.md)。本文保留目录选择的依据。

## 选择

采用 `模块/localization/业务包/语言`，沿用业务包的语言变体设计。保留现有普通资源包、Excel 源表和类型合同的位置；语言包内部继续使用 `dynamic`、`static` 和根目录资源索引。

语言包增加根目录生成文件 `yz-locale.json`，保存该业务包、该语言的文案与资源映射。它与已有的 `yz-index.json` 都由工具管理，实际资源放在 `dynamic` 或 `static`。不再为这一份语言描述文件增加 `generated` 目录。

## 目标结构

以下展开 `showcase/default` 的英文变体。只有启用多语言的业务包和已启用的语言才创建对应目录；`extra` 的多语言目录和合同仅用于说明多个业务包的排列方式。

```text
assets/game/modules/showcase/
├─ module.json
├─ public.ts
├─ code/                              现有业务代码
├─ contracts/generated/
│  ├─ bundles.ts                      现有业务包入口
│  ├─ resources-default.ts            现有业务资源键
│  ├─ localization-default.ts         default 的语言键，不区分语言文件
│  └─ localization-extra.ts           extra 的语言键（启用后生成）
├─ bundles/
│  ├─ default/                        普通业务 Bundle
│  │  ├─ dynamic/
│  │  ├─ static/
│  │  └─ yz-index.json                自动生成的资源索引
│  └─ extra/                          另一个普通业务 Bundle
└─ localization/                      普通分组目录，不标记为 Bundle
   ├─ default/                        所属业务包，不标记为 Bundle
   │  ├─ zh-CN/                       中文 Bundle，与英文结构相同
   │  └─ en/                          英文 Bundle
   │     ├─ dynamic/                  需要通过资源键加载的资源
   │     │  ├─ images/                示例分类，按需要创建
   │     │  ├─ fonts/
   │     │  └─ audio/
   │     ├─ static/                   只通过编辑器静态引用使用的资源
   │     ├─ yz-index.json             自动生成的资源索引
   │     └─ yz-locale.json            自动生成的文案与语言资源映射
   └─ extra/                          extra 启用多语言后使用
      ├─ zh-CN/
      └─ en/

config-source/showcase/
├─ samples.xlsx                       普通配置表
├─ localization-default.xlsx          default 的全部语言，共用一份 Excel
└─ localization-extra.xlsx            extra 启用多语言后创建
```

上图省略 `.meta`、其他现有合同和由资源扫描生成的物理资源键文件；这些文件仍按现有框架规则维护。

## 固定规则

1. 普通业务 Bundle 与语言 Bundle 的根目录互不包含。一个语言 Bundle 对应一个业务包的一种语言，默认语言使用同一结构。
2. 归属顺序固定为业务包在前、语言在后，便于一起检查、迁移或停用一个业务包的翻译。语言目录使用项目校验过的标准语言标识，如 `zh-CN`、`en`。
3. `localization` 下的语言包由工具根据业务包的多语言声明管理。普通页面和配置表的目标列表只显示业务资源包，语言变体在多语言页按业务包分组显示。
4. `dynamic`、`static` 沿用现有框架含义。图片、字体、音频等分类不是新的框架类型，也不要求每个语言包都有这些目录。只有文案的语言包可以没有手工资源。
5. `yz-index.json` 供现有 Assets 查找物理资源；`yz-locale.json` 供多语言服务选择文案和资源键。两者职责不同，不合并为第二套加载器。后者不作为普通动态 JSON 重复生成资源键。
6. Excel 按业务包划分，每种语言占一列；继续使用 `config-source/<模块>/localization-<业务包>.xlsx`。生成的语言键继续位于 `contracts/generated/localization-<业务包>.ts`，业务调用不依赖具体语言目录。
7. 业务包的多语言声明是归属来源。实际 Bundle ID、加载路径和目录位置由工具校验、维护，不通过拆分 `default-en` 这类名字猜测归属。迁移时优先保留已有 Bundle ID、UUID 和公开资源键。
8. 普通公共资源留在现有公共业务包。同语言公共字体等可通过公开资源键显式复用公共语言包，不复制到每个使用者目录。引用校验需覆盖所有业务包与语言包，缺译继续走明确的默认语言回退。

## 为什么选这套结构

| 布局                                              | 判断                                                                                             |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `bundles/default-en/...` 平铺                     | 对现有工具改动最少，但语言包和业务包混排，语言增加后归属依赖命名识别。                           |
| `localization/default/en/...`                     | 归属直接体现在目录层级中，普通业务资源根目录保持稳定，适合当前框架。                             |
| `localization/en/default/...`                     | 便于集中查看一种语言，但维护、迁移一个业务包时需要跨多个语言目录。Excel 已提供按语言查看的入口。 |
| 在现有 `bundles/default` 内放语言 Bundle          | 包根目录互相包含，资源归属、引用检查和删除操作需要更仔细地区分边界。                             |
| 将业务包改为 `bundles/default/main`，旁边放语言包 | 归属紧凑，但会要求迁移现有普通业务资源，仅为增加多语言改变所有包的布局，收益不足。               |

包内采用根目录 `yz-locale.json`，与现有 `yz-index.json` 的生成约定一致。业务归属和语言已在父目录中明确，不再重复为 `dynamic/i18n/default/en.json`，也不增加单文件的 `generated/catalog.json` 层级。

## 迁移范围与验收

- 保留普通业务包根目录、Excel 源表、现有语言键合同及业务调用方式。
- 通过 Creator 移动现有英文语言包，尽量保留目录和资源 UUID；将默认语言目录迁到对应语言包（当前项目为 `zh-CN`）。仅迁移已确认归属的语言内容，普通公共资源不随之移动。
- 将语言目录文件移动、重命名为 `yz-locale.json`；同步更新生成所有权记录、加载路由、资源身份记录及构建审计。生成 JSON 的内容仍来自 Excel。
- 新目录与旧目录不能同时进入正式发布清单。旧目录仅在文件迁移完成、引用校验通过且确认空目录后，通过 Creator 清理；旧 `dynamic/locales` 空目录也纳入检查。
- 创建预览、生成器和运行时必须使用同一份派生路由，补齐前面审查发现的普通内容误选语言包、公共字体复用和依赖检查问题。
- 验证首次创建、追加语言、只含文案的语言包、同语言公共资源引用、停用及删除恢复、目录迁移、语言切换、页面关闭、Web 构建和产物运行。预览与构建中的 Bundle 归属须与清单一致。

本规划固定目录与包边界。按模块或按体积合并物理包会改变下载边界，留待实际构建数据证明有需要时单独评估。
