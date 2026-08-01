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
});
