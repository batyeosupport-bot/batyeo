'use client';
import {useEffect, useState} from 'react';
import {KioskPoster, KioskPromo, POSTER_THEMES, type PosterBranding} from '@/components/batyeo/kiosk-poster';
import {POSTER_LOCALES, POSTER_STRINGS, type PosterCopy, type PosterLocale} from '@/core/poster-i18n';
import {DEFAULT_PRICING} from '@/core/pricing';
import {posterLayout, type PosterTheme} from '@/core/screen';

// Files picked here stay in this browser (object URLs): nothing is uploaded while BATYEO tries a design.
function pickFile(onPick: (url: string | null) => void) {
 return (e: React.ChangeEvent<HTMLInputElement>) => {
  const file = e.target.files?.[0];
  onPick(file ? URL.createObjectURL(file) : null);
 };
}

export default function KioskPreviewPage() {
 const [theme, setTheme] = useState<PosterTheme>('sport');
 const [venueName, setVenueName] = useState('Le Comptoir');
 const [city, setCity] = useState('Paris');
 const [logoUrl, setLogoUrl] = useState<string | null>(null);
 const [backgroundUrl, setBackgroundUrl] = useState<string | null>(null);
 const [locales, setLocales] = useState<PosterLocale[]>(['fr-FR', 'en-GB', 'es-ES']);
 const [images, setImages] = useState<Partial<Record<PosterLocale, string>>>({});
 // ?style=arcade&lieu=Smile%20World&ville=Montigny(&langue=en-GB) opens a ready-made mock-up, handy to show a prospect.
 useEffect(() => {
  const query = new URLSearchParams(window.location.search);
  const style = query.get('style'), lieu = query.get('lieu'), ville = query.get('ville');
  const timer = setTimeout(() => {
   if (style && style in POSTER_THEMES) setTheme(style as PosterTheme);
   if (lieu) setVenueName(lieu.slice(0, 60));
   if (ville !== null) setCity(ville.slice(0, 40));
   // &image=…&image_en=… : the finished visuals for the made-to-measure style (an https address or a path on this site).
   const image = query.get('image'), imageEn = query.get('image_en');
   const safe = (url: string | null) => url && (url.startsWith('https://') || url.startsWith('/')) ? url : undefined;
   if (safe(image) || safe(imageEn)) {setImages({'fr-FR': safe(image), 'en-GB': safe(imageEn)}); setLocales(['fr-FR', 'en-GB']);}
   const langue = query.get('langue');
   if (langue && POSTER_LOCALES.some(l => l.locale === langue)) setLocales([langue as PosterLocale]);
  }, 0);
  return () => clearTimeout(timer);
 }, []);
 const [editLocale, setEditLocale] = useState<PosterLocale>('fr-FR');
 const [copy, setCopy] = useState<Partial<Record<PosterLocale, PosterCopy>>>({});
 const [available, setAvailable] = useState(4);
 const [online, setOnline] = useState(true);
 const [promo, setPromo] = useState({title: 'Happy hour', highlight: 'Pinte à 5 €', subtitle: 'Toutes les pintes et les cocktails maison', schedule: 'Lun–Ven · 18h–20h'});

 const defaults = POSTER_STRINGS[editLocale];
 const edited = copy[editLocale] ?? {headlines: [], tagline: ''};
 const editCopy = (patch: Partial<PosterCopy>) => setCopy({...copy, [editLocale]: {...edited, ...patch}});
 const toggleLocale = (locale: PosterLocale, on: boolean) => {
  const next = POSTER_LOCALES.map(l => l.locale).filter(l => l === locale ? on : locales.includes(l));
  if (next.length) setLocales(next);
 };

 const branding: PosterBranding = {logoUrl, backgroundUrl, primary: POSTER_THEMES[theme].primary, accent: POSTER_THEMES[theme].accent, layout: posterLayout(theme), locales, copy, images};
 const live = {venueName, city, online, available, hourlyCents: DEFAULT_PRICING.hourlyCents, capCents: DEFAULT_PRICING.capCents, depositCents: DEFAULT_PRICING.depositCents, qrTarget: 'https://batyeo.vercel.app/rent/apercu'};

 return (
  <main style={styles.page}>
   <div style={styles.poster}><KioskPoster branding={branding} live={live}/></div>
   <div style={styles.poster}><KioskPromo promo={{id: 'apercu', imageUrl: null, ...promo}} branding={branding} venueName={venueName} qrTarget={live.qrTarget} canRent={online && available > 0}/></div>
   <form style={styles.panel} onSubmit={e => e.preventDefault()}>
    <label style={styles.field}>Promo · titre<input value={promo.title} onChange={e => setPromo({...promo, title: e.target.value})} style={styles.input}/></label>
    <label style={styles.field}>Promo · en grand<input value={promo.highlight} onChange={e => setPromo({...promo, highlight: e.target.value})} style={styles.input}/></label>
    <label style={styles.field}>Promo · détail<input value={promo.subtitle} onChange={e => setPromo({...promo, subtitle: e.target.value})} style={styles.input}/></label>
    <label style={styles.field}>Promo · horaires<input value={promo.schedule} onChange={e => setPromo({...promo, schedule: e.target.value})} style={styles.input}/></label>
   </form>
   <form style={styles.panel} onSubmit={e => e.preventDefault()}>
    <label style={styles.field}>Style
     <select value={theme} onChange={e => setTheme(e.target.value as PosterTheme)} style={styles.input}>
      {Object.entries(POSTER_THEMES).map(([key, t]) => <option key={key} value={key}>{t.label}</option>)}
     </select>
    </label>
    <label style={styles.field}>Nom du bar<input value={venueName} onChange={e => setVenueName(e.target.value)} style={styles.input}/></label>
    <label style={styles.field}>Ville (affichée sous le logo en style Arcade)<input value={city} onChange={e => setCity(e.target.value)} style={styles.input}/></label>
    <label style={styles.field}>Logo du bar<input type="file" accept="image/*" onChange={pickFile(setLogoUrl)} style={{maxWidth: '100%'}}/></label>
    <label style={styles.field}>Photo de fond<input type="file" accept="image/*" onChange={pickFile(setBackgroundUrl)} style={{maxWidth: '100%'}}/></label>
    {posterLayout(theme) === 'image' && <>
     <label style={styles.field}>Visuel en français<input type="file" accept="image/*" onChange={pickFile(url => setImages(current => ({...current, 'fr-FR': url ?? undefined})))} style={{maxWidth: '100%'}}/></label>
     <label style={styles.field}>Visuel en anglais<input type="file" accept="image/*" onChange={pickFile(url => setImages(current => ({...current, 'en-GB': url ?? undefined})))} style={{maxWidth: '100%'}}/></label>
    </>}
    <fieldset style={styles.fieldset}>
     <legend style={styles.legend}>Langues proposées (le client touche la sienne, français par défaut)</legend>
     <div style={styles.checks}>
      {POSTER_LOCALES.map(l => <label key={l.locale} style={styles.check}><input type="checkbox" checked={locales.includes(l.locale)} onChange={e => toggleLocale(l.locale, e.target.checked)}/>{l.label}</label>)}
     </div>
    </fieldset>
    <label style={styles.field}>Batteries disponibles : {available}<input type="range" min={0} max={8} value={available} onChange={e => setAvailable(Number(e.target.value))}/></label>
    <label style={{...styles.field, flexDirection: 'row', alignItems: 'center', gap: 8}}><input type="checkbox" checked={online} onChange={e => setOnline(e.target.checked)}/>Borne en ligne</label>
   </form>
   <form style={styles.panel} onSubmit={e => e.preventDefault()}>
    <label style={styles.field}>Textes du bar, langue
     <select value={editLocale} onChange={e => setEditLocale(e.target.value as PosterLocale)} style={styles.input}>
      {POSTER_LOCALES.map(l => <option key={l.locale} value={l.locale}>{l.label}</option>)}
     </select>
     <span style={styles.hint}>Laisse vide pour garder le texte traduit par défaut (affiché en gris).</span>
    </label>
    <label style={styles.field}>Phrases d’accroche (une par ligne, elles défilent)
     <textarea rows={3} value={edited.headlines.join('\n')} onChange={e => editCopy({headlines: e.target.value.split('\n')})} placeholder={(posterLayout(theme) === 'arcade' ? [defaults.arcadeHeadline, defaults.arcadeKicker] : [defaults.headline1, defaults.headline2, defaults.headline3]).join('\n')} style={styles.input}/>
    </label>
    <label style={styles.field}>Sous-titre
     <input value={edited.tagline} onChange={e => editCopy({tagline: e.target.value})} placeholder={posterLayout(theme) === 'arcade' ? defaults.arcadePill : defaults.tagline} style={styles.input}/>
    </label>
   </form>
  </main>
 );
}

const styles = {
 page: {minHeight: '100vh', background: '#0b0d0c', color: '#e8ece6', padding: 16, display: 'flex', flexDirection: 'column' as const, gap: 20, alignItems: 'center', fontFamily: 'system-ui, sans-serif'},
 poster: {width: '100%', maxWidth: 1280, borderRadius: 12, overflow: 'hidden', boxShadow: '0 20px 60px rgba(0,0,0,.6)'},
 panel: {width: '100%', maxWidth: 1280, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(260px, 100%), 1fr))', gap: 16, background: '#151917', borderRadius: 12, padding: 20, boxSizing: 'border-box' as const},
 field: {display: 'flex', flexDirection: 'column' as const, gap: 6, fontSize: 14, fontWeight: 600, minWidth: 0},
 fieldset: {border: 0, padding: 0, margin: 0, minWidth: 0},
 legend: {fontSize: 14, fontWeight: 600, marginBottom: 6, padding: 0},
 checks: {display: 'flex', flexWrap: 'wrap' as const, gap: '6px 14px'},
 check: {display: 'flex', alignItems: 'center', gap: 6, fontSize: 14},
 hint: {fontSize: 12, fontWeight: 400, color: '#9aa59d'},
 input: {width: '100%', boxSizing: 'border-box' as const, background: '#0b0d0c', color: '#e8ece6', border: '1px solid #2d3530', borderRadius: 8, padding: '8px 10px', fontSize: 14, fontFamily: 'inherit'},
};
