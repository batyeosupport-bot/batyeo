import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = { metadataBase:new URL('https://batyeo-web.anismeslin5.chatgpt.site'),alternates:{canonical:'/'}, title: { default: 'BATYEO — Restez dans le moment.', template: '%s | BATYEO' }, description: 'Une batterie quand vous en avez besoin. Scannez, emportez, rechargez et rendez votre batterie dans une station BATYEO compatible.', openGraph: {title:'BATYEO — Restez dans le moment.',description:'Une batterie quand vous en avez besoin.',locale:'fr_FR',type:'website'}, icons:{icon:'/favicon.svg'} };
export default function RootLayout({children}: Readonly<{children: React.ReactNode}>) {return <html lang="fr"><body>{children}</body></html>;}
