# 配置表

配置表源文件在 `config-source/excel`。

## Excel 表头

固定 4 行表头：

| 行 | 含义 |
| --- | --- |
| 1 | 字段名，lowerCamelCase |
| 2 | 字段类型 |
| 3 | 字段规则 |
| 4 | 字段注释 |

主键只由第三行 `pk` 决定。字段名是 `id` 时必须标 `pk`。

## 登记导出规则

```bash
npm run yzforge:config:table -- --label "Battle Items" --source config-source/excel/Battle.xlsx --sheet Items --scope module:Battle --table battleItems
```

不要传 `--row` 或 `--primary-key`。行类型由 `--table` 推导，主键由 Excel `pk` 推导。

## 生成

```bash
npm run yzforge:config:build
npm run yzforge:ai:context
npm run yzforge:ai:doctor
```

## 读取

```ts
const row = this.config.tables.battleItems.require('item_001');
const all = this.config.tables.battleItems.all();
```

如果需要按非主键字段查询，不要滥用 `pk`；以后应增加 `index` 规则。
