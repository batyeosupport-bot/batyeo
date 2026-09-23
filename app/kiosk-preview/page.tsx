'use client';
import {useState} from 'react';
import {KioskPoster, POSTER_THEMES, type PosterBranding} from '@/components/batyeo/kiosk-poster';
import {DEFAULT_PRICING} from '@/core/pricing';

// Files picked here stay in this browser (object URLs): nothing is uploaded while BATYEO tries a design.
function pickFile(onPick: (url: string | null) => void) {
 return (e: React.ChangeEvent<HTMLInputElement>) => {
  const file = e.target.files?.[0];
  onPick(file ? URL.createObjectURL(file) : null);
 };
}

export default function KioskPreviewPage() {
 const [theme, setTheme] = useState('sport');
 const [venueName, setVenueName] = useState('Le Comptoir');
 const [logoUrl, setLogoUrl] = useState<string | null>(null);
 const [backgroundUrl, setBackgroundUrl] = useState<string | null>(null);
 const [headlines, setHeadlines] = useState('Batterie à plat ?\nReste encore un peu.\nLe match n’est pas fini.');
 const [tagline, setTagline] = useState('Recharge ton téléphone sans quitter ta table.');
 const [available, setAvailable] = useState(4);
 const [online, setOnline] = useState(true);

 const branding: PosterBranding = {logoUrl, backgroundUrl, primary: POSTER_THEMES[theme].primary, accent: POSTER_THEMES[theme].accent, headlines: headlines.split('\n'), tagline};
 const live = {venueName, city: 'Paris', online, available, hourlyCents: DEFAULT_PRICING.hourlyCents, capCents: DEFAULT_PRICING.capCents, depositCents: DEFAULT_PRICING.depositCents, qrTarget: 'https://batyeo.vercel.app/rent/apercu'};

 return (
  <main style={styles.page}>
   <div style={styles.poster}><KioskPoster branding={branding} live={live}/></div>
   <form style={styles.panel} onSubmit={e => e.preventDefault()}>
    <label style={styles.field}>Style
     <select value={theme} onChange={e => setTheme(e.target.value)} style={styles.input}>
      {Object.entries(POSTER_THEMES).map(([key, t]) => <option key={key} value={key}>{t.label}</option>)}
     </select>
    </label>
    <label style={styles.field}>Nom du bar<input value={venueName} onChange={e => setVenueName(e.target.value)} style={styles.input}/></label>
    <label style={styles.field}>Logo du bar<input type="file" accept="image/*" onChange={pickFile(setLogoUrl)} style={{maxWidth: '100%'}}/></label>
    <label style={styles.field}>Photo de fond<input type="file" accept="image/*" onChange={pickFile(setBackgroundUrl)} style={{maxWidth: '100%'}}/></label>
    <label style={styles.field}>Phrases d’accroche (une par ligne, elles défilent)<textarea rows={3} value={headlines} onChange={e => setHeadlines(e.target.value)} style={styles.input}/></label>
    <label style={styles.field}>Sous-titre<input value={tagline} onChange={e => setTagline(e.target.value)} style={styles.input}/></label>
    <label style={styles.field}>Batteries disponibles : {available}<input type="range" min={0} max={8} value={available} onChange={e => setAvailable(Number(e.target.value))}/></label>
    <label style={{...styles.field, flexDirection: 'row', alignItems: 'center', gap: 8}}><input type="checkbox" checked={online} onChange={e => setOnline(e.target.checked)}/>Borne en ligne</label>
   </form>
  </main>
 );
}

const styles = {
 page: {minHeight: '100vh', background: '#0b0d0c', color: '#e8ece6', padding: 16, display: 'flex', flexDirection: 'column' as const, gap: 20, alignItems: 'center', fontFamily: 'system-ui, sans-serif'},
 poster: {width: '100%', maxWidth: 1280, borderRadius: 12, overflow: 'hidden', boxShadow: '0 20px 60px rgba(0,0,0,.6)'},
 panel: {width: '100%', maxWidth: 1280, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(260px, 100%), 1fr))', gap: 16, background: '#151917', borderRadius: 12, padding: 20, boxSizing: 'border-box' as const},
 field: {display: 'flex', flexDirection: 'column' as const, gap: 6, fontSize: 14, fontWeight: 600, minWidth: 0},
 input: {width: '100%', boxSizing: 'border-box' as const, background: '#0b0d0c', color: '#e8ece6', border: '1px solid #2d3530', borderRadius: 8, padding: '8px 10px', fontSize: 14, fontFamily: 'inherit'},
};
