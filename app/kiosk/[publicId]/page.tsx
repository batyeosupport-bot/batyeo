'use client';
import {use} from 'react';
import {QRCodeSVG} from 'qrcode.react';
import {useApi,type PublicData} from '@/components/batyeo/shared';

export default function KioskPage({params}: {params: Promise<{publicId: string}>}) {
 const {publicId} = use(params);
 const {data, error, loading} = useApi<PublicData>('public', 15000);
 const station = data?.stations.find(s => s.publicId === publicId);
 const qrTarget = typeof window !== 'undefined' ? `${window.location.origin}/rent/${encodeURIComponent(publicId)}` : `/rent/${encodeURIComponent(publicId)}`;

 return (
  <main style={styles.screen}>
   {loading && <p style={styles.status}>Chargement…</p>}
   {!loading && error && <p style={styles.error}>Connexion indisponible. Nouvelle tentative dans 15 s.</p>}
   {!loading && !error && !station && <p style={styles.error}>Station « {publicId} » introuvable.</p>}
   {station && (
    <>
     <p style={styles.eyebrow}>batyeo<span style={styles.dot}>.</span></p>
     <h1 style={styles.title}>{station.venue.name}</h1>
     <p style={styles.subtitle}>{station.venue.city}</p>
     <div style={styles.badge(station.online)}>{station.online ? 'En ligne' : 'Hors ligne'}</div>
     <p style={styles.count}>{station.available} batterie{station.available > 1 ? 's' : ''} disponible{station.available > 1 ? 's' : ''}</p>
     <div style={styles.qrCard}>
      <QRCodeSVG value={qrTarget} size={280} bgColor="#f7f8f2" fgColor="#19382c" />
     </div>
     <p style={styles.instructions}>Scannez ce code avec votre téléphone pour louer une batterie</p>
    </>
   )}
  </main>
 );
}

const styles = {
 screen: {minHeight: '100vh', width: '100%', display: 'flex', flexDirection: 'column' as const, alignItems: 'center', justifyContent: 'center', gap: 20, background: '#19382c', color: '#f4f6ee', padding: 32, textAlign: 'center' as const, fontFamily: 'system-ui, sans-serif'},
 status: {fontSize: 22, color: '#d8ed98'},
 error: {fontSize: 22, color: '#ffd7d0', maxWidth: 480},
 eyebrow: {fontSize: 20, fontWeight: 800, margin: 0},
 dot: {color: '#d8ed98'},
 title: {fontSize: 48, fontWeight: 700, margin: 0, lineHeight: 1.1},
 subtitle: {fontSize: 22, color: '#c7d3c2', margin: 0},
 count: {fontSize: 26, fontWeight: 600, margin: 0},
 qrCard: {background: '#f7f8f2', borderRadius: 24, padding: 24, marginTop: 12},
 instructions: {fontSize: 18, color: '#c7d3c2', maxWidth: 420, margin: 0},
 badge: (online: boolean) => ({padding: '8px 20px', borderRadius: 999, fontSize: 16, fontWeight: 700, background: online ? '#d8ed98' : '#e7a99c', color: '#19382c'}),
};
