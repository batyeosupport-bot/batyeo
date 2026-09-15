import type {MetadataRoute} from 'next';
export default function robots():MetadataRoute.Robots{return{rules:{userAgent:'*',allow:'/',disallow:['/admin','/partner/','/partner','/rent/','/api/']},sitemap:'https://batyeo-web.anismeslin5.chatgpt.site/sitemap.xml'};}
