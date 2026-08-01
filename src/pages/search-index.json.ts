import type { APIRoute } from 'astro';
import { getCollection } from 'astro:content';
import { formatDate } from '../lib/format';

// 构建时生成 search-index.json：全站文章的搜索索引
// 静态构建下该接口会被预渲染成一个静态 JSON 文件，供搜索页拉取
export const GET: APIRoute = async () => {
  const posts = await getCollection('blog');

  const index = posts.map((post) => ({
    title: post.data.title,
    description: post.data.description ?? '',
    date: formatDate(post.data.date),
    tags: post.data.tags,
    slug: post.id,
    // 正文（Markdown 源码），用于关键词匹配。用 'body' in post 兼容不同版本
    body: 'body' in post ? post.body : '',
  }));

  return new Response(JSON.stringify(index), {
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
};
