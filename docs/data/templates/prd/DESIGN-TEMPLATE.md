---
version: alpha
name: "<项目名称>"
colors:
  background: "oklch(1 0 0)"
  foreground: "oklch(.18 0 0)"
  primary: "oklch(.30 .08 260)"
  primary-foreground: "oklch(.99 0 0)"
  destructive: "oklch(.55 .20 25)"
  border: "oklch(.89 0 0)"
  ring: "oklch(.55 .14 260)"
typography:
  body:
    fontFamily: "ui-sans-serif, system-ui, sans-serif"
    fontSize: 16px
    fontWeight: 400
    lineHeight: 1.5
rounded:
  sm: 6px
  md: 8px
  lg: 10px
spacing:
  xs: 4px
  sm: 8px
  md: 16px
  lg: 24px
  xl: 32px
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.primary-foreground}"
    rounded: "{rounded.md}"
    padding: "{spacing.md}"
---
## Overview
本文件是项目唯一的视觉与无障碍契约：PRD 阶段建立并维护，ARCH 只记录实现映射（Token 到样式文件、组件集、明暗策略、字体加载），TDD 取值变更先改本文件再改样式，QA 据此核验还原度与无障碍。
<用一两句话写产品气质与目标用户>；功能级旅程、线框与交互仍写在 UX 规范。
## Colors
初始色板取自息壤架构包 shadcn 组件的默认 Token，项目按品牌替换取值；业务页面只引用 Token，不硬编码色值。
暗色策略：<写明是否支持暗色，以及各 Token 的暗色取值；规范本身没有暗色机制，以文字约定>。
## Typography
<字体族、字号阶梯与字重用途；只用系统字体栈时无需加载策略，使用网络字体须写明加载方式与回退>。
## Layout
断点（默认，可按项目调整）：768 以下单列、底部导航；768–1023 双列、侧边栏或汉堡菜单；1024–1439 多列、顶部导航；1440 及以上限制最大内容宽度；最小支持宽度 320。间距只用 spacing 档位。
## Elevation & Depth
<层级与阴影：共几层、各自用途；不使用阴影时说明用边框或色差表达层次>。
## Shapes
圆角档位见 rounded：按钮与输入框用 md，卡片与面板用 lg；<图标风格与描边粗细>。
## Components
button-primary 是示例，按项目补充其他组件与变体；各组件的状态覆盖矩阵（默认、悬停、聚焦、禁用、错误、加载、空状态）写在 UX 规范。
## Do's and Don'ts
- 只引用 Token，不在业务页面硬编码色值、字号与间距。
- 取值变更先改本文件再改样式文件，两者保持一致。
### Accessibility
- 基线 WCAG 2.1 AA；对比度正文 ≥ 4.5:1，大文本 ≥ 3:1。
- 触控目标：推荐 ≥ 44×44；WCAG 2.2 SC 2.5.8 最低 24×24（AA）。
- 键盘全程可达，焦点指示可见，信息不只靠颜色传达。
### Motion
<动效时长与缓动、哪些交互有动效>；遵循系统“减少动态效果”设置，不使用闪烁内容。
### Visual QA
关键页面视觉还原度 ≥ 95%（默认，可按项目调整）；<覆盖的页面与断点、对比方式>。
