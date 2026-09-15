import type {Metadata} from 'next';
import { BatyeoApp } from '@/components/batyeo/app';
export default async function Page({params}: {params: Promise<{slug: string[]}>}) { const {slug} = await params; return <BatyeoApp path={'/'+slug.join('/')} />; }

const titles:Record<string,string>={'how-it-works':'Comment ça marche','pricing':'Tarifs','stations':'Nos stations','for-business':'Pour les professionnels','partners':'Nos partenaires','faq':'Questions fréquentes','support':'Assistance','contact':'Contact','terms':'Conditions d’utilisation','privacy':'Confidentialité'};
export async function generateMetadata({params}:{params:Promise<{slug:string[]}>}):Promise<Metadata>{const {slug}=await params;const privateRoute=['admin','partner','rent'].includes(slug[0]);return {title:titles[slug[0]]??(slug[0]==='rent'?'Louer une batterie':slug[0]==='partner'?'Espace partenaire':'Administration'),alternates:{canonical:'/'+slug.join('/')},robots:privateRoute?{index:false,follow:false}:undefined};}
