'use client';
import {useState} from 'react';
import {QRCodeSVG} from 'qrcode.react';
import {toast} from 'sonner';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {Busy, api, type Dashboard} from './shared';

/** Réglages → double vérification : scanner, confirmer par un premier code, ou désactiver (mot de passe + code). */
export function TwoFactorCard({data, refresh}: {data: Dashboard; refresh: () => Promise<void>}) {
 const [setup, setSetup] = useState<{secret: string; uri: string} | null>(null);
 const [code, setCode] = useState(''), [password, setPassword] = useState(''), [busy, setBusy] = useState(false);
 async function run(action: () => Promise<unknown>, success: string) {
  setBusy(true);
  try {await action(); await refresh(); toast.success(success); setSetup(null); setCode(''); setPassword('');}
  catch (e) {toast.error(e instanceof Error ? e.message : 'Action impossible.');}
  finally {setBusy(false);}
 }
 async function start() {
  setBusy(true);
  try {setSetup(await api<{secret: string; uri: string}>('account/2fa/setup', {}));}
  catch (e) {toast.error(e instanceof Error ? e.message : 'Action impossible.');}
  finally {setBusy(false);}
 }
 const codeInput = <Input inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={e => setCode(e.target.value.replace(/\D/g, ''))} placeholder="123456"/>;
 return <section className="panel">
  <div className="panel-title"><div><h2>Double vérification</h2><p>À chaque connexion, un code à 6 chiffres donné par une application (Google Authenticator, Authy, 1Password…) en plus du mot de passe. Un mot de passe volé ne suffit plus.</p></div></div>
  {data.user.twoFactor ? <>
   <p><strong>Active.</strong> Téléphone perdu : un administrateur peut générer un nouveau mot de passe depuis Équipe, ce qui désactive aussi la double vérification.</p>
   <div className="venue-geo">
    <label className="field-label">Mot de passe<Input type="password" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)}/></label>
    <label className="field-label">Code actuel{codeInput}</label>
   </div>
   <Button variant="outline" disabled={busy || !password || code.length !== 6} onClick={() => void run(() => api('account/2fa/disable', {password, code}), 'Double vérification désactivée.')}>{busy && <Busy/>}Désactiver</Button>
  </> : setup ? <>
   <p>1. Scannez ce QR code avec votre application d’authentification.</p>
   <div className="totp-qr"><QRCodeSVG value={setup.uri} size={176}/></div>
   <p className="small muted">Pas d’appareil photo ? Saisissez cette clé : <code>{setup.secret.match(/.{1,4}/g)?.join(' ')}</code></p>
   <label className="field-label">2. Entrez le code affiché par l’application{codeInput}</label>
   <Button className="cta" disabled={busy || code.length !== 6} onClick={() => void run(() => api('account/2fa/enable', {code}), 'Double vérification activée.')}>{busy && <Busy/>}Activer</Button>
  </> : <Button className="cta" disabled={busy} onClick={() => void start()}>{busy && <Busy/>}Configurer la double vérification</Button>}
 </section>;
}
