import type {MetadataRoute} from 'next';
import {SITE_URL} from '@/lib/site';
const origin=SITE_URL;
export default function sitemap():MetadataRoute.Sitemap{return ['','/how-it-works','/pricing','/stations','/for-business','/partners','/faq','/support','/contact','/terms','/privacy'].map(path=>({url:origin+path,changeFrequency:'monthly',priority:path===''?1:0.7}));}
