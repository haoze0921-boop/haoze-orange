import { getCollection, type CollectionEntry } from 'astro:content';

// 只取网站上可见的文章（排除 hidden 的草稿/私密文章）
export async function getVisiblePosts(): Promise<CollectionEntry<'blog'>[]> {
  const posts = await getCollection('blog');
  return posts.filter((p) => !p.data.hidden);
}

// 排序：置顶在前，其余按日期倒序
export function sortPosts(posts: CollectionEntry<'blog'>[]): CollectionEntry<'blog'>[] {
  return [...posts].sort((a, b) => {
    if (a.data.pinned !== b.data.pinned) return a.data.pinned ? -1 : 1;
    return b.data.date.valueOf() - a.data.date.valueOf();
  });
}

// 分类 = 文章所在目录（文件名里的目录部分）
export function categoryOf(id: string): string {
  const i = id.indexOf('/');
  return i === -1 ? '' : id.slice(0, i);
}
