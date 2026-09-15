import type {MetadataRoute} from 'next';
const origin='https://batyeo-web.anismeslin5.chatgpt.site';
export default function sitemap():MetadataRoute.Sitemap{return ['','/how-it-works','/pricing','/stations','/for-business','/partners','/faq','/support','/contact','/terms','/privacy'].map(path=>({url:origin+path,changeFrequency:'monthly',priority:path===''?1:0.7}));}
