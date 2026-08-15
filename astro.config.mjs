// @ts-check
import { defineConfig } from 'astro/config';

// https://astro.build/config
export default defineConfig({
  // site: 部署后的完整网址
  site: 'https://haoze0921-boop.github.io',
  // base: 站点子路径（项目页 = /仓库名/）
  base: '/haoze-orange/',
  // 本地开发/预览的监听地址：
  // 绑定 127.0.0.1（IPv4），避免 Windows 上 localhost 只解析到 IPv6 导致"拒绝连接"
  server: {
    host: '127.0.0.1',
  },
  preview: {
    host: '127.0.0.1',
  },
  vite: {
    plugins: [
      {
        // 修复：astro sync 的 ModuleRunner 使用 astro environment，
        // 其 optimizeDeps.noDiscovery=true 且 include 不含 picomatch，
        // 导致 rolldown-vite 以 /node_modules/... URL 内联转换 CJS 的
        // picomatch 时因 require 未定义而失败（GenerateContentTypesError）。
        // 把 picomatch 加入 astro environment 的依赖预打包列表即可规避。
        name: 'prebundle-picomatch-for-sync',
        config(cfg) {
          cfg.optimizeDeps = cfg.optimizeDeps || {};
          const inc = Array.isArray(cfg.optimizeDeps.include) ? cfg.optimizeDeps.include : [];
          if (!inc.includes('picomatch')) inc.push('picomatch');
          cfg.optimizeDeps.include = inc;
          cfg.environments = cfg.environments || {};
          const astroEnv = cfg.environments.astro || {};
          astroEnv.optimizeDeps = astroEnv.optimizeDeps || {};
          const ainc = Array.isArray(astroEnv.optimizeDeps.include) ? astroEnv.optimizeDeps.include : [];
          if (!ainc.includes('picomatch')) ainc.push('picomatch');
          astroEnv.optimizeDeps.include = ainc;
          cfg.environments.astro = astroEnv;
          return cfg;
        },
      },
    ],
  },
});
