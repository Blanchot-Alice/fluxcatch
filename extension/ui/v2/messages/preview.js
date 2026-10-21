// Copy owned by the component preview (extension/preview/). Keys use the
// preview. prefix only. The preview names its views and specimens here; the
// specimens themselves show product copy from common.js, media.js, popup.js
// and settings.js, so the gallery never drifts from the product. No spec
// annotations (review §7): names say what a component is for, never its
// sizes or tokens.

const en = {
  "preview.title": "Components",
  "preview.views": "Component views",
  "preview.view.type": "Type and brand",
  "preview.view.text": "Text styles",
  "preview.view.controls": "Controls",
  "preview.view.rows": "Rows and progress",
  "preview.view.feedback": "Status and empty states",
  "preview.view.overlays": "Dialogs and menus",

  "preview.group.brand": "Brand mark",
  "preview.group.icon": "App icon",
  "preview.group.type": "Type",
  "preview.group.buttons": "Buttons",
  "preview.group.settings": "Setting rows",
  "preview.group.nav": "Navigation",
  "preview.group.status": "Status",
  "preview.group.statusLines": "Status lines",
  "preview.group.toasts": "Toasts",
  "preview.group.confirm": "Confirm in place",
  "preview.group.empty": "Empty state",
  "preview.group.dialog": "Dialog",
  "preview.group.menu": "Menu",

  "preview.brand.small": "Popup and side panel",
  "preview.brand.medium": "Full pages",

  "preview.role.empty": "Empty-state sentence",
  "preview.role.title": "Section and dialog titles",
  "preview.role.row": "File names, settings and buttons",
  "preview.role.body": "Descriptions and input text",
  "preview.role.meta": "Sizes, times and sources",
  "preview.role.label": "Group and form labels",

  "preview.setting.theme": "Theme",
  "preview.setting.themeHint": "Auto follows your system.",
  "preview.theme.auto": "Auto",
  "preview.theme.morning": "Morning",
  "preview.theme.dusk": "Dusk",
  "preview.setting.density": "Density",
  "preview.setting.densityHint": "Compact fits more rows on screen.",
  "preview.density.comfortable": "Comfortable",
  "preview.density.compact": "Compact",
  "preview.setting.motion": "Reduce motion",
  "preview.setting.motionHint": "Turns off the shimmer and slides.",

  "preview.dialog.modes": "How the dialog opens"
};

const zh = {
  "preview.title": "组件",
  "preview.views": "组件分类",
  "preview.view.type": "字体与品牌",
  "preview.view.text": "文字样式",
  "preview.view.controls": "控件",
  "preview.view.rows": "条目与进度",
  "preview.view.feedback": "状态与空状态",
  "preview.view.overlays": "对话框与菜单",

  "preview.group.brand": "品牌标识",
  "preview.group.icon": "应用图标",
  "preview.group.type": "字体",
  "preview.group.buttons": "按钮",
  "preview.group.settings": "设置项",
  "preview.group.nav": "导航",
  "preview.group.status": "状态",
  "preview.group.statusLines": "状态行",
  "preview.group.toasts": "提示条",
  "preview.group.confirm": "就地确认",
  "preview.group.empty": "空状态",
  "preview.group.dialog": "对话框",
  "preview.group.menu": "菜单",

  "preview.brand.small": "弹窗与侧边栏",
  "preview.brand.medium": "独立页面",

  "preview.role.empty": "空状态文案",
  "preview.role.title": "区块与对话框标题",
  "preview.role.row": "文件名、设置项与按钮",
  "preview.role.body": "说明与输入文字",
  "preview.role.meta": "大小、时间与来源",
  "preview.role.label": "分组与表单标签",

  "preview.setting.theme": "主题",
  "preview.setting.themeHint": "自动模式跟随系统外观。",
  "preview.theme.auto": "自动",
  "preview.theme.morning": "清晨",
  "preview.theme.dusk": "黄昏",
  "preview.setting.density": "密度",
  "preview.setting.densityHint": "紧凑模式一屏能显示更多条目。",
  "preview.density.comfortable": "宽松",
  "preview.density.compact": "紧凑",
  "preview.setting.motion": "减少动效",
  "preview.setting.motionHint": "关闭微光与滑动效果。",

  "preview.dialog.modes": "对话框的打开方式"
};

/** Display strings (the page title): their Chinese glyphs must be in the
 *  bundled Noto Serif SC subset (scripts/build-display-font.mjs). The empty
 *  sentences the preview shows are media.js keys, already listed there. */
const display = ["preview.title"];

export default { en, zh, display };
