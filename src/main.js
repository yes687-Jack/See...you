import './styles/main.css';
import { show } from './ui/router.js';
import * as app from './app.js';
import { buildMode, generateBuild } from './paint2d/paint2d.js';
import { enter3d, clear3dTools, toggleModelCat, updateCupHint, switchModel } from './three/viewer.js';

// HTML 内联事件处理函数（保持原有 onclick 写法不变）
Object.assign(window, {
  show,
  buildMode,
  generateBuild,
  enter3d,
  clear3dTools,
  toggleModelCat,
  updateCupHint,
  switchModel,
  ...app
});
