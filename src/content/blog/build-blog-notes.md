---
title: 搭建博客的笔记：用 Astro 建一个可拓展的站点
description: 记录我是怎么从零搭起这个博客的，包括技术选型和目录结构。
date: '2026-08-01'
tags:
  - 未分配
hidden: true
---
<p>这个博客是用 <a href="https://astro.build">Astro</a> 静态站点框架搭建的。写这篇笔记，既是记录过程，也方便以后自己回顾和扩展。</p><p>
</p><h2>为什么选 Astro</h2><p>
</p><p>对比了一圈，最终选择 Astro，理由很简单：</p><p>
</p><ol><li><span class="ql-ui" contenteditable="false"></span><strong>写作体验好</strong>：文章就是 Markdown 文件，放在 <code>src/content/blog/</code> 里，写完即发布</li><li><span class="ql-ui" contenteditable="false"></span><strong>目录即路由</strong>：<code>src/pages/</code> 下放什么文件，就生成什么页面，不用配路由</li><li><span class="ql-ui" contenteditable="false"></span><strong>可拓展</strong>：需要新功能时，加一个组件或页面就行，不用推翻重来</li><li><span class="ql-ui" contenteditable="false"></span><strong>免费部署</strong>：构建出来是纯静态文件，扔到 GitHub Pages 零成本</li></ol><p>
</p><h2>项目结构</h2><p>
</p><p><br></p><p>
</p><h2>怎么加一篇文章</h2><p>
</p><p>超简单，三步：</p><p>
</p><ol><li><span class="ql-ui" contenteditable="false"></span>在 <code>src/content/blog/</code> 新建一个 <code>.md</code> 文件</li><li><span class="ql-ui" contenteditable="false"></span>文件开头写一段 frontmatter：</li></ol><p>
</p><p><br></p><p>
</p><ol start="3"><li><span class="ql-ui" contenteditable="false"></span>下面写正文，保存即可。首页、标签页、搜索会自动带上新文章。</li></ol><p>
</p><h2>怎么本地预览</h2><p>
</p><p><br></p><p>
</p><p>然后打开浏览器访问 <code>http://localhost:4321</code>，改文件会实时刷新。</p><p>
</p><h2>下一步想加的功能</h2><p>
</p><p><br></p><p>
</p><p>慢慢来，一个一个加上去。</p><p>
</p>
