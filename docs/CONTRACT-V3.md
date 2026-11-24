# Token Island — V3 contract: selective dot-matrix (readability first)

用户对 V2「像素风」的反馈与 V3 方向（原文）：

> 「更准确的说，应该是合适的地方使用点阵的元素，整体不能影响阅读才行」

V3 是一次**局部替换**，不是重做：**所有文字保持清晰可读，点阵只用于“数据标记”与少量装饰**。

---

## 0. 一句话原则

**读字用清晰字形，数据用点阵元素。**

- ✅ 点阵用于：hero 大数字、图表数据点、sparkline、比例条、状态 LED、徽章图标/极少量点状纹理。
- ❌ 点阵禁止用于：标签、正文、模型名、项目名、表格、footer、按钮文字、任何小于 16px 的信息文本。
- 阅读性硬指标（不达标就回退为普通像素字）：
  - 正文/标签保持 V2 的字号与对比度（≥ 4.5:1，实测仍用 V2 的 Silkscreen 文本渲染路径）。
  - 点阵数字只允许出现在 **≥ 24px 高**的位置；0.3x 缩放的徽章文字继续用位图字形。
  - 点阵图表的数据仍必须有轴标签（位图文字）与空数据状态文字。
  - LED 光晕只允许出现在 ≤ 8px 的状态点上，文字与数字**不加光晕**。

## 1. 共享实现（Lead 已完成，勿改）

| 路径 | 内容 |
| --- | --- |
| `packages/core/src/dotmatrix.ts` | 点阵渲染 API：`dotTextDots/dotTextSvg`、`dotFigureSvg`（hero 数字 + 光环）、`dotColumnsSvg`（点阵柱）、`dotSparklineSvg`、`dotRatioStripSvg`、`dotLedSvg`、`dotTextureSvg`；**只有 `dotLedSvg` 带光环** |
| `packages/core/test/dotmatrix.test.ts` | 47 个 core 测试全绿 |
| `assets/fonts/pixel-glyphs.json` | Silkscreen 位图字形 JSON（供 Swift 渲染点阵数字）；由 `assets/fonts/export_glyphs.mjs` 生成 |
| `docs/demos/dotmatrix/` | 调研 + 四方向 demo（LED/VFD/flip/flat），仅作为视觉参考，不并入正式 UI |

调色板/字体沿用 V2：`PIXEL` 调色板 + Silkscreen（文字）+ 位图字形（点阵）。**不引入新字体、新依赖、新颜色体系。**

## 2. macOS 灵动岛（`apps/island-macos`）— owner: island-v3

只改四处，其余 UI 原样保留（包括所有文字字号、布局、面板、壁纸、Preferences/About）：

1. **Hero 今日 token 数字 → 点阵数字**（唯一较大的变化）：
   - 用 `pixel-glyphs.json` 在 SwiftUI `Canvas` 中画点阵数字（圆心对齐整数点阵，pitch 4–5pt，scale 2 → 约 40–50pt 高，与现在 hero 尺寸一致）。
   - 颜色 `PIXEL.ink`，数字下方仍保留 `TODAY` 文字（Silkscreen 16pt），右侧 EST/成本/趋势仍用文字。
   - 数字外围允许 2 圈低透明度光环（模拟 LED），**不加 blur、不加扫描线**，必须保证数字轮廓清晰可辨（截图自检：2.28M / 8.4K / 1.2B 三种形态）。
   - 加载失败或 Reduce Motion/Transparency 时回退到 V2 的 Silkscreen 文本数字（新增一个 feature flag 便于对比）。
2. **14 天图表 → 点阵柱状图**：数据点用点阵柱（每列 2 dots 宽 + 极淡 track 点），今天列用 `PIXEL.teal` 高亮、其余 `PIXEL.inkDim`；保留现有的 `14 DAYS`/`MAX` 文字标签与字号。
3. **收起态 sparkline → 点阵 sparkline**（点阵柱，尺寸/位置不变）。
4. **实时状态点 → LED 点**（2 圈光环，仅此一处允许光晕；闪烁仍为 2 帧步进）。

不改：面板边框/切角/阴影、壁纸、所有文字、布局尺寸、轮询、快照 CLI、Preferences/About、菜单栏。

验证：`build-app.sh` + `codesign --verify` + `package-dmg.sh` + `hdiutil verify`；`--snapshot-all` 三种状态 2x PNG 用 `read_image` 自检（重点看 hero 数字是否清晰、图表是否仍可读）；`--demo` 3s 无崩溃。DMG 版本改为 **0.3.0**（Info.plist / build-app.sh / package-dmg.sh 同步）。

## 3. 云端（`apps/cloud`）— owner: cloud-v3

保持 API/页面结构/文字排版不变，只把**数据标记**换成点阵，并守住可读性：

1. **图表 SVG**（`src/render/chart.ts`）：
   - `bar`：点阵柱（每列 2 dots，淡 track 点），标签/轴/标题**保持位图文字不变**。
   - `line`：数据点改为点阵圆点（每点 1 个 dot，半径 1.8–2.4px）+ 1px 低透明度阶梯连线（仅连接），避免整条线变粗难读；面积填充改为极淡点状 texture。
   - `heatmap`：**保留方形单元格**（网格数据用方块更易读），仅把 legend 的色块改成点阵点。
   - `models`：横向比例条改为点阵段（dots），模型名/数值仍位图文字。
   - 空数据状态、轴标签、主题（dark/light/auto）与尺寸参数全部保持。
2. **徽章**（`src/render/badge.ts`）：文字保持位图字形不变；把左侧图标改成点阵 icon（tokens=点簇、cost=点圆、streak=点火焰、status=LED 点），并在 label 区域加 `opacity 0.10` 的极淡点阵纹理（不得降低文字对比度；light/dark 都要测）。
3. **HTML**（landing/dashboard）：保持现有排版与字号；图表换成上面的点阵 SVG；统计卡片的大数字（如 114M/49d）允许用点阵 SVG 数字（≥40px 高，旁边保留文字标签），其余文字不动；可加细点状分隔线（≤2 处/页），不要整页点阵化。
4. 测试：保留现有 29 个测试，新增点阵断言（图表含 `<circle>`、徽章含点阵 icon、无 `<text>` 仍成立、对比度不变）；`worker:dry-run` 绿。
5. 版本改为 **0.3.0**（package.json / 页面 footer 显示）。

## 4. 文档/QA（`qa-docs`，V3 阶段）— 等 island/cloud 完成后

- e2e 增加点阵断言（图表 circle 数量、README 徽章 icon、灵动岛快照 hero 数字区域非空且非全像素方块——可用渲染图人工复核 + 至少断言 SVG 特性）。
- 截图全部重渲染：island 三态 + 真实数据版、badges 明暗、charts、card、landing、dashboard、app icon 保持。
- README 增加「点阵元素的使用边界」小节：列出哪些是点阵、哪些保持可读字形，附改造前后对比图 1 张。
- docs/badges 重新导出；docs/ARCHITECTURE 更新点睛：dotmatrix.ts 的职责边界。
- 全量验证 `pnpm typecheck && pnpm test && pnpm e2e`；doctor 绿。

## 5. 验收清单（Lead 会逐项复核）

- [ ] 逐张截图确认：所有文字清晰无光晕、字号不小于 V2、无重叠。
- [ ] hero 数字点阵在 2x 截图中每个点可数、轮廓清晰；2.28M/8.4K/1.2B 三种长度都不溢出。
- [ ] 图表在 1x 与 2x 下数据可读（不是一团点）。
- [ ] 对比度：标签在各自背景 ≥ 4.5:1（含徽章 light/dark）。
- [ ] SVG 仍自包含、无外部字体、无 `<text>`、XML 合法。
- [ ] codesign/DMG/hdiutil/workerd dry-run 结果与 V2 相同或更好。
