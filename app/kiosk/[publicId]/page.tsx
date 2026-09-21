'use client';
import {use} from 'react';
import {QRCodeSVG} from 'qrcode.react';
import {useApi,type PublicData} from '@/components/batyeo/shared';
import {euro} from '@/core/pricing';

export default function KioskPage({params}: {params: Promise<{publicId: string}>}) {
 const {publicId} = use(params);
 const {data, error, loading} = useApi<PublicData>('public', 15000);
 const station = data?.stations.find(s => s.publicId === publicId);
 const qrTarget = typeof window !== 'undefined' ? `${window.location.origin}/rent/${encodeURIComponent(publicId)}` : `/rent/${encodeURIComponent(publicId)}`;

 return (
  <main style={styles.screen}>
   <style>{KIOSK_CSS}</style>
   {loading && <p style={styles.status}>Chargement…</p>}
   {!loading && error && <p style={styles.error}>Connexion indisponible. Nouvelle tentative dans 15 s.</p>}
   {!loading && !error && !station && <p style={styles.error}>Station « {publicId} » introuvable.</p>}
   {station && (
    <div className="kiosk-layout">
     <div className="kiosk-info">
      <p style={styles.eyebrow}>batyeo<span style={styles.dot}>.</span></p>
      <h1 style={styles.title}>{station.venue.name}</h1>
      <p style={styles.subtitle}>{station.venue.city}</p>
      <div style={styles.badge(station.online)}>{station.online ? 'En ligne' : 'Hors ligne'}</div>
      {station.online&&<p style={styles.count}>{station.available > 0 ? `${station.available} batterie${station.available > 1 ? 's' : ''} disponible${station.available > 1 ? 's' : ''}` : 'Toutes les batteries sont en cours de location'}</p>}
      {station.online&&data?.pricing&&<p style={styles.price}>{euro(data.pricing.hourlyCents)} / heure commencée · maximum {euro(data.pricing.capCents)}<br/>Caution {euro(data.pricing.depositCents)}, libérée au retour</p>}
      {station.online&&<ol style={styles.steps}><li>1 · Scannez le code</li><li>2 · Payez la caution</li><li>3 · Prenez la batterie</li><li>4 · Rendez-la dans n’importe quelle borne</li></ol>}
      {!station.online&&<p style={styles.error}>Cette borne est momentanément indisponible. Une autre borne BATYEO est peut-être proche de vous.</p>}
     </div>
     {station.online&&<div className="kiosk-qr">
      <div style={styles.qrCard}>
       <QRCodeSVG value={qrTarget} size={260} bgColor="#f7f8f2" fgColor="#19382c" />
      </div>
      <p style={styles.instructions}>Scannez avec l’appareil photo de votre téléphone</p>
     </div>}
    </div>
   )}
  </main>
 );
}

// Cabinet screens are landscape and cannot scroll: two columns keep the QR, the price and the steps all on screen at once.
const KIOSK_CSS=`
.kiosk-layout{display:flex;flex-direction:column;align-items:center;gap:20px}
.kiosk-info,.kiosk-qr{display:flex;flex-direction:column;align-items:center;gap:12px}
@media (orientation:landscape){
 .kiosk-layout{flex-direction:row;justify-content:center;gap:64px;width:100%}
 .kiosk-info{align-items:flex-start;text-align:left;max-width:520px}
}`;

const styles = {
 screen: {minHeight: '100vh', width: '100%', display: 'flex', flexDirection: 'column' as const, alignItems: 'center', justifyContent: 'center', gap: 20, background: '#19382c', color: '#f4f6ee', padding: 32, textAlign: 'center' as const, fontFamily: 'system-ui, sans-serif'},
 status: {fontSize: 22, color: '#d8ed98'},
 error: {fontSize: 22, color: '#ffd7d0', maxWidth: 480},
 eyebrow: {fontSize: 20, fontWeight: 800, margin: 0},
 dot: {color: '#d8ed98'},
 title: {fontSize: 44, fontWeight: 700, margin: 0, lineHeight: 1.1},
 subtitle: {fontSize: 22, color: '#c7d3c2', margin: 0},
 count: {fontSize: 26, fontWeight: 600, margin: 0},
 qrCard: {background: '#f7f8f2', borderRadius: 24, padding: 20},
 price: {fontSize: 20, fontWeight: 600, margin: 0, maxWidth: 520, color: '#d8ed98'},
 steps: {display: 'flex', flexDirection: 'column' as const, gap: 6, listStyle: 'none', padding: 0, margin: 0, fontSize: 17, color: '#c7d3c2'},
 instructions: {fontSize: 18, color: '#c7d3c2', maxWidth: 420, margin: 0},
 badge: (online: boolean) => ({padding: '8px 20px', borderRadius: 999, fontSize: 16, fontWeight: 700, background: online ? '#d8ed98' : '#e7a99c', color: '#19382c'}),
};
