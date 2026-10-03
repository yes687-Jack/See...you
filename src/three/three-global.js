// r128 的 examples/js 旧式脚本依赖全局 THREE，并会向上挂载 GLTFLoader/OrbitControls。
// ESM 模块命名空间对象不可扩展（Object.isExtensible === false），
// 因此复制为普通可变对象后再挂到 window。
import * as THREE_NS from 'three';
const THREE = Object.assign({}, THREE_NS);
window.THREE = THREE;
export default THREE;
