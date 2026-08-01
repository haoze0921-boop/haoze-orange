import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

// 博客文章的内容集合：src/content/blog/ 下的每个 .md 文件即一篇文章
const blog = defineCollection({
  // loader 告诉 Astro 去哪里找文章
  loader: glob({ pattern: '**/*.md', base: './src/content/blog' }),
  schema: z.object({
    // 文章标题（必填）
    title: z.string(),
    // 一句话简介，显示在卡片和搜索里（选填）
    description: z.string().optional(),
    // 发布日期（必填），frontmatter 里写 YYYY-MM-DD 即可
    date: z.coerce.date(),
    // 更新日期（选填）
    updated: z.coerce.date().optional(),
    // 标签列表（选填），如 tags: ['生活', '技术']
    tags: z.array(z.string()).default([]),
    // 置顶（选填）：置顶文章在列表里排最前
    pinned: z.boolean().default(false),
    // 隐藏（选填）：隐藏文章不在网站上显示，仅后台可见
    hidden: z.boolean().default(false),
  }),
});

export const collections = { blog };
