# 点阵（Dot-Matrix）风格调研 & 四个方向 Demo

> 结论先行：你说得对，V2 的「像素风」其实是**方块像素（pixel art）**；**点阵（dot-matrix）** 的核心是「离散的发光圆点阵列 + 可见的未点亮点网格」，气质更接近 LED / VFD / 翻牌显示屏。本文给出调研结论、四个方向的可视 demo 与取舍，等你选定方向后再改正式 App。

Demo 文件（都是静态渲染，非最终实现）：

```
docs/demos/dotmatrix/
├── generate.mjs                 # 生成器（改参数即可再出图）
├── out/overview.png             # 四方向对比总览
├── out/{led,vfd,flip,flat}-expanded.png    # 展开态（448×400 面板 + 壁纸，2x）
├── out/{led,vfd,flip,flat}-collapsed.png   # 收起态（224×44，2x）
├── out/{led,vfd,flip,flat}-readme.png      # GitHub README 素材（徽章 + 图表）
└── out/gallery.html             # 浏览器里一次性看完 12 张图
```

## 1. 术语与视觉语言：像素 ≠ 点阵

| | 像素风（当前 V2） | 点阵风（本次调研方向） |
| --- | --- | --- |
| 基本单元 | 实心方块像素，像素之间无缝 | **圆形/八角形点**，点与点之间有固定点距（pitch） |
| 表面 | 一块连续画布 | **可见的“熄灭点”网格**是灵魂；亮灭对比 ≥ 70% |
| 光感 | 无发光，纯色块 | LED/VFD 有热核 + 光晕（bloom）、扫描线、玻璃反光 |
| 字体 | 5×7 位图字形，方块笔划 | 同样的 5×7 骨架，但用点拼成字形（点距决定字号） |
| 信息密度 | 高（方块几乎无间隙） | 中（点距越大密度越低，翻牌点阵最粗） |

关键判断：**点阵感 = 点距 + 未点亮网格 + 亮度层次**，三者缺一就会退回“有点圆的像素风”。

## 2. 调研：真实世界的点阵参考

- **LED 点阵 / 出发牌**：火车站、机场的 LED 板是点阵风格的默认心智模型。Framer 的 [Text Matrix](https://www.framer.com/community/marketplace/components/text-matrix/) 和 [LED Board](https://marketplace.framer.com/marketplace/components/led-board-design/) 组件都是「未点亮网格 + 辉光 + 扫描线」的现代复刻。
- **LED 字体工程**：Deutsche Bahn 的 [MONITOR LED](https://www.cape-arcona.com/custom-typefaces/monitor-led-deutsche-bahn/) 针对不同点距做了 13 个字重，说明「点距决定字形设计」是专业做法，不能一套字形到处缩放。
- **翻牌点阵（flip-dot）**：物理圆片，两个面、高光与投影随单个光源变化。Tactile UI 的 [Flip-Dot](https://tactileui.dev/objects/flip-dot) 演示了「每个圆片单独着色」的物理感；专利文件描述了圆片对称性对观感的影响（[EP2069892B1](https://patentimages.storage.googleapis.com/be/93/24/5ac743b5223c81/EP2069892B1.pdf)）。
- **交通标志可读性标准**：美国公共交通标识指南要求目的地显示屏「至少 16 行 × 105 列八角形点」，字符与背景对比度 ≥ 70%（[Transit Signage Guidelines](https://rosap.ntl.bts.gov/view/dot/14900/dot_14900_DS1.pdf#3#9#3)）——直接给我们的对比度与点阵密度提供了工程底线。
- **VFD 真空荧光**：自发光、青绿色、1978 年已实现绿/橙双色（[IEEE Milestone](https://ieeemilestones.ethw.org/w/index.php?title=Milestone-Proposal:Vacuum_Fluorescent_Display,_1967)），DIY 圈子有真实复刻项目 [MyVFD](https://github.com/megabitsenmzq/MyVFD)；特点是**强 bloom + 玻璃反光**，比 LED 更“精密仪器”。
- **现代产品里的点阵**：Nothing Phone 3 的 Glyph Matrix 用 489 颗 micro-LED 组成点阵作为品牌语言（[Engadget](https://www.engadget.com/mobile/smartphones/nothing-phone-3-hands-on-dot-matrix-glyph-flagship-phone-173019742.html)）——证明点阵也能做得克制、现代，而不只是复古。
- **点阵图表**：用等大圆点表达比例/计数的 dot-matrix chart（[anyplot 规范](https://github.com/markusneusinger/anyplot/blob/602301ac15257f2a7b678add15b9d3fee9be3b4f/plots/dot-matrix-proportional/specification.md)），适合把「14 天用量」做成点阵柱、把「模型占比」做成点阵条。

## 3. 沉淀出的设计原则

1. **网格是主角**：面板永远铺满暗淡的未点亮点（体感 10–20% 亮度），亮字只是“点亮”其中一部分。
2. **两层亮度**：每个亮点 = 热核（半径 0.4×点距）+ 光晕（blur 0.8–1.2×点距，40–60% 不透明度）；只有 LED/VFD 需要，平点阵不加。
3. **点距决定信息密度**：3px 点距 ≈ 现在 V2 的信息量；5px 以上必须减少内容（翻牌点阵 demo 就是反例：同样内容会拥挤）。
4. **单色 + 1 强调色**：琥珀/青色为主，绿色只用于 LIVE/正增长，红/橙用于负值/离线；避免彩虹色。
5. **字体 = 5×7 点字**：沿用现有 Silkscreen 位图骨架，用点重绘（SVG 里每点 `<circle>`，SwiftUI 里 Canvas 画点），保证与 README 徽章、App 完全同形。
6. **物理细节克制**：`扫描线`（VFD 弱、LED 中）、`玻璃反光`（左上到右下 2–4% 白）、`金属/塑料边框 + 螺丝`，不要过度做旧。
7. **动效步进**：只做“点亮/熄灭”两帧或整点刷新，不做平滑渐变；点阵的浪漫来自离散跳变。

## 4. 四个方向对比

| | A 琥珀 LED 点阵 | B 青色 VFD 点阵 | C 物理翻牌点阵 | D 现代平点阵 |
| --- | --- | --- | --- | --- |
| 气质 | 机场出发牌 / 80s 仪表 | 90s 高端音响 / 仪器 | 老式翻牌时刻表 / 物理装置 | Nothing / Teenage Engineering |
| 光感 | 琥珀辉光 + 扫描线 | 青色强 bloom + 玻璃反光 | 无发光，单光源高光+投影 | 无 glow，纯点密度 |
| 信息密度 | 高（3px 点距，可放 2 模型 + 2 会话） | 高（同 A） | 低（5px 点距，仅够 hero + 图表 + 2 行） | 高（3px，最接近现在排布） |
| 可读性 | 好（琥珀对暗底对比 > 7:1） | 很好（青白高对比，但光晕易糊小字） | 中（白点对深灰，物理阴影增加辨识负担） | 最好（无色偏、点小而清晰） |
| 情绪/记忆点 | ★★★★☆ 复古但不廉价 | ★★★★★ 最“高级/性能感” | ★★★★☆ 最有物理质感但最挑内容 | ★★★☆☆ 克制、耐看、偏产品 |
| 实现成本 | 中：圆点 + blur 光晕（SwiftUI 需多层 Canvas/blur） | 中高：双层 bloom（性能更重） | 中高：每点径向渐变 + 投影，SVG 体积最大 | 低：纯圆点，性能最好 |
| SVG 体积（徽章/图表） | ~+40–80%（点比方块路径多） | 同 A（+ filter defs） | ~+120%（每点渐变引用） | +20–40% |
| 适合 | 想强化品牌记忆、复古科技感 | 想走高端仪器感 | 想要“实体感”但可接受信息减少 | 想稳妥升级、保留现排布 |
| 风险 | 长期看可能偏“赛博” | bloom 在小尺寸（GitHub 1x 徽章）易糊 | 信息密度不足，需重排布局 | 像素→点阵的变化感知最弱 |

**我的推荐**：**A（琥珀 LED）作为默认主风格，B（青色 VFD）作为可切换主题**。两者共享同一套点阵网格与字形，只是调色板、bloom 强度和玻璃细节不同；实现一份渲染器即可。D 作为「低眩光/日间」主题备用；C 不建议作为默认（内容密度与现有信息架构冲突），但可以作为彩蛋/演示模式。

## 5. 落地改造计划（选定后执行）

1. **共享点阵渲染层**（`packages/core/src/dotmatrix.ts`）
   - 用现有 Silkscreen 位图字形生成点阵字形：`dotText() / dotDots() / dotPanel() / dotBar() / dotHeatmap()`，所有坐标整数、点距参数化。
   - 输出 SVG（App 与 README 同一套），并导出点阵字形数据供 Swift 使用。
2. **macOS App**：把 `Text` 换成 `DotText`（SwiftUI Canvas 画圆点，`blendMode(.plusLighter)` 叠 bloom），面板改为点阵背景（低亮度点阵 Tile）。光晕用两层 `blur(radius:)` 叠加，2s 刷新下点数量 ~2–4k，性能无压力；仍保留 Reduce Transparency/Reduce Motion 的降级（关 bloom、静态点）。
3. **云端 SVG**：徽章/图表改用点阵渲染；点阵 SVG 会变大约 40–80%（单 SVG 仍 < 100KB，GitHub camo 缓存无压力）；小尺寸徽章改用 2px 点距保证 1x 清晰。
4. **文档/截屏**：README 的 12 张图与 docs/badges 全部重渲染；保留像素版文件作为历史。
5. **验证**：新增点阵渲染单测（点数量/坐标整数/SVG 自包含/无 `<text>`）、e2e 像素→点阵断言、App 快照与星标对比。

## 6. 需要你拍板的参数

- **主风格**：A / B / C / D / A+B 双主题。
- **点距**：3px（信息密度同现在，推荐）/ 4px（更“灯珠”但内容要减）/ 2.5–3.5 按区域不同。
- **光晕强度**：0（平）/ 中（推荐）/ 强（更复古，但小字会糊）。
- **面板外框**：保留金属边框+螺丝 / 极简无边框 / 仅细线框。
- **壁纸**：保留现有像素城市壁纸 / 换成全黑或点阵桌面。
