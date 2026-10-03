import { defineConfig } from 'vite';

// 构建后把 <script type="module"> 转为普通 <script>，使 dist/index.html 可直接通过 file:// 打开运行
function classicScriptPlugin(){
  return {
    name:'classic-script',
    closeBundle(){
      const fs=require('fs');
      const path=require('path');
      const htmlPath=path.resolve(__dirname,'dist/index.html');
      if(!fs.existsSync(htmlPath))return;
      let html=fs.readFileSync(htmlPath,'utf8');
      // 构建产物图片在 ./assets/（非 public/assets/），把图片前缀逻辑改为始终用 "."
      html=html.replace(/var prefix = location\.protocol === 'file:' \? '\.\/public' : '\.';/g,"var prefix = '.';");
      // 去掉 script 的 type="module" 与 crossorigin，改为普通脚本（支持 file:// 直接打开）
      html=html.replace(/\s+type="module"/g,'');
      html=html.replace(/\s+crossorigin(="[^"]*")?/g,'');
      // 去掉 modulepreload 链接（仅模块需要）
      html=html.replace(/<link[^>]*rel="modulepreload"[^>]*>\s*/g,'');
      fs.writeFileSync(htmlPath,html);
    }
  };
}

// 纯静态站点：构建产物可部署到任意静态托管 / 线下装置本地服务器
export default defineConfig({
  base: './',
  plugins:[classicScriptPlugin()],
  server: {
    host: true, // 允许局域网设备（平板/手机）访问调试
    port: 5173
  },
  build: {
    outDir: 'dist',
    assetsInlineLimit: 0 // 图片一律产出为文件，便于缓存与离线部署
  }
});
