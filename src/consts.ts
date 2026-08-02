// 站点全局配置：可在编辑后台「站点设置」里修改（写入 src/site-config.json）
import siteConfig from './site-config.json';

// 保持旧常量名，其余页面 import 不受影响
export const SITE_TITLE: string = siteConfig.siteTitle;
export const SITE_DESCRIPTION: string = siteConfig.siteDescription;
export const NAV_LINKS: { href: string; label: string }[] = siteConfig.navLinks;
export const HERO_TITLE: string = siteConfig.heroTitle;
export const HERO_SUBTITLE: string = siteConfig.heroSubtitle;
export const FOOTER_TEXT: string = siteConfig.footerText;
export const ABOUT_BODY: string = siteConfig.aboutBody;
