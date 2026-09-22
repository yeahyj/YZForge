# 运行时与制作流程优化

本轮修改位于 `E:\study\YZForge`，保留 Module、Bundle、Scope 三个核心概念。没有新增运行时插件容器、全局配置单例或独立 Part 管理器。准确验证结果见 [实施记录](implementation-status.md)，日常调用见 [API 指南](api-guide.md)。

## 这次解决的问题

| 原问题                                        | 当前行为                                                                         |
| --------------------------------------------- | -------------------------------------------------------------------------------- |
| UI 反复传 show.scope，容易误持有到模块结束    | show.assets/config/audio/time 默认跟随本次展示，原显式 Scope 接口保留            |
| 页面内部 await 返回清理可能等待自身回调       | show.back/dismiss/finish 发出请求；外部用请求 completed 或 handle.result 等待    |
| 一次按钮操作失败就使页面退出                  | listen 可接收 onError，普通操作失败保留页面；初始化与清理故障仍隔离              |
| 动态 Part 提前 destroy 后资源仍跟随整个父页面 | destroyInstance 等待独立实例回收，直接节点销毁也触发持有归还                     |
| Service 放在哪、页面怎么拿，缺少可运行范例    | defineModule 明确工厂合同和依赖，ctx.services 取本代内部服务，跨模块使用公开 API |
| 日期显示和日切默认规则不同                    | 时间上下文 calendar 统一继承项目规则，独立纯工具保持 UTC                         |
| 长时间前台运行后服务器样本过期，没有自动恢复  | 有 source 时自动提前校时，失败退避，前后台切换恢复；可关闭自动策略               |
| 存档版本改变或主数据损坏容易丢失              | 显式逐版本迁移、读取状态、有效备份、未来版本覆盖保护                             |
| 只能通过内部字段排查资源为什么没释放          | app.inspect 返回只读诊断快照，包含任务和实际持有者                               |
| 创建失败留下半成品，无法判断该撤销什么        | 保存前后快照，撤销前检查修改与引用，生成失败可单独重试                           |
| 公式失败只显示导出错误                        | 增加环境检测，保留独立副本重算和输入摘要校验                                     |
| 构建只知道独立包有没有出现                    | 增加真实输出字节、重复文件、依赖与预算检查                                       |

## 已有调用如何迁移

1. **返回导航**：页面内部改用 `show.back()`。外部原来 `await ui.back()` 若需要等物理完成，改为 `await ui.back().completed`。不要在当前页的受管任务里等待 `.completed`，否则又会等待自己。
2. **配置与资源**：UI 中推荐 `show.config.load(Table)`、`show.assets.load(Key)`、`show.audio.play(Key)`。`ctx.config.load(Table, show.scope, options)` 仍兼容。模块级长期持有继续使用 ctx。
3. **日历默认值**：`time.calendar.format(now, 'datetime')` 现在继承项目时区。旧代码若必须固定 UTC，传 `0`；直接导入纯日历工具的调用不受影响。
4. **校时策略**：注入 source 后默认自动同步；已有登录流程必须完全控制请求时，设置 `autoSync: false`。resetSync 仍负责使上一会话样本失效。
5. **按钮错误**：`show.listen` 的普通操作错误不再自动结束 UI。需要告知用户可传第四参数；不能把这个回调当业务事务回滚。
6. **存储构造**：业务继续用 ctx.storage/app.storage；直接 `new Storage` 的平台/测试代码需传入 `StorageBackend`，App 默认注入 Cocos sys.localStorage。
7. **模块工厂**：已有普通工厂仍可装配；新工厂推荐 `defineModule(公开引用, { dependencies, services }, factory)`，依赖还须声明在 module.json。声明服务合同后须返回对应 services，工厂未就绪时不可反过来读取自己。

## 示例链路

`Dashboard → LobbyService → ProfileApi → WalletService → Storage` 负责共享业务状态。`Dashboard → show.config.load(EconomyTable)` 读取 common 包的公开只读配置，common 业务工厂无需启动。`Dashboard → WalletPart.render` 只传展示数据；重新加载按钮会先回收旧 Part 再创建新实例。

示例奖励可以反复点击，用于演示确认、存档和共享状态，不实现每日领取限制或服务端经济系统。示例目录可以通过正常引用检查后替换或删除。

## 制作流程与边界

失败创建记录保存在 `.yzforge/creations`。完整创建但生成失败，可以修复后重试生成；创建步骤本身失败，不能只运行生成就标成完成。撤销仅处理记录内变化，拒绝覆盖用户后续编辑和外部引用；Creator 资产由 AssetDB 删除/恢复。任意进程崩溃没有完整后快照时仍需检查残留，不能宣称全局事务。

构建预算使用 `project-settings/build-budgets.json` 的 default 与 platforms 合并规则。支持 maxTotalBytes、maxLocalRootBytes、maxDuplicateBytes，单位都是字节，null 不限制。构建钩子和 `audit-build --output <目录> --platform <目标>` 共用规则，超限返回失败并保留报告。同内容文件只检查至少 1 KiB 的完整字节重复，尚不分析合并 JSON/图集内部的语义重复。

设备后台行为、权限、下载缓存和原生平台仍须真机验证。时间是固定 UTC 偏移日历，不支持 IANA/DST；跨重启周期去重由业务持久化。诊断快照不代表全部 Cocos/原生/GPU 内存，构建输出统计也不代表真实首屏流量。
