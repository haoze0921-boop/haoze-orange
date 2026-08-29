import type { APIRoute } from 'astro';
import { formatDate } from '../lib/format';
import { getVisiblePosts } from '../lib/posts';

// 从 Markdown/HTML 源码里提取纯文本（用于搜索匹配与摘要）。
// 关键：剔除 base64 内嵌图片与 HTML 标签，避免超大索引拖慢搜索页加载。
export function toSearchText(md: string): string {
  return md
    .replace(/data:image\/[^"')>\s]+/gi, ' ') // base64 内嵌图片（占体积大头）
    .replace(/<[^>]+>/g, ' ')                  // HTML 标签
    .replace(/```[\s\S]*?```/g, ' ')           // 代码块
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')      // 图片
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')    // 链接只留文字
    .replace(/[#>*`\-_~|]/g, ' ')               // Markdown 符号
    .replace(/\s+/g, ' ')
    .trim();
}

// 构建时生成 search-index.json：全站文章的搜索索引（不含隐藏文章）
// 静态构建下该接口会被预渲染成一个静态 JSON 文件，供搜索页拉取
export const GET: APIRoute = async () => {
  const posts = await getVisiblePosts();

  const index = posts.map((post) => {
    const raw = 'body' in post ? post.body : '';
    return {
      title: post.data.title,
      description: post.data.description ?? '',
      date: formatDate(post.data.date),
      tags: post.data.tags,
      slug: post.id,
      // 纯文本正文（无 base64 图片/HTML/Markdown），搜索匹配与摘要都用它
      text: toSearchText(raw),
    };
  });

  return new Response(JSON.stringify(index), {
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
};
