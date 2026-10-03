// 官方 ESM 版扩展（r128 examples/jsm），挂载到与 viewer 共享的 THREE 副本上。
// 不使用 examples/js 旧式脚本：其 IIFE 内自由变量 THREE 在生产打包后无法正确解析。
import THREE from './three-global.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

THREE.GLTFLoader = GLTFLoader;
