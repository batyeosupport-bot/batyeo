'use client';
import {useState, type ReactNode} from 'react';
import {upload as uploadBlob} from '@vercel/blob/client';
import {toast} from 'sonner';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {Checkbox} from '@/components/ui/checkbox';
import {Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger} from '@/components/ui/dialog';
import {Busy, DataTable, Empty, Picker, Status, api, type Dashboard} from './shared';
import {KioskPoster, KioskPromo} from './kiosk-poster';
import {POSTER_LOCALES, POSTER_STRINGS, type PosterCopy, type PosterLocale} from '@/core/poster-i18n';
import {ALL_POSTER_LOCALES, POSTER_THEMES, POSTER_THEME_KEYS, promoScheduleLabel, type PosterTheme, type VenueBranding, type Weekday} from '@/core/screen';

type Refresh = () => Promise<void>;
const IMAGE_MAX_BYTES = 15 * 1024 * 1024;
const DAYS: {value: Weekday; label: string}[] = [{value: 1, label: 'Lun'}, {value: 2, label: 'Mar'}, {value: 3, label: 'Mer'}, {value: 4, label: 'Jeu'}, {value: 5, label: 'Ven'}, {value: 6, label: 'Sam'}, {value: 0, label: 'Dim'}];
const toTime = (minute: number) => `${String(Math.floor(minute / 60) % 24).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
const fromTime = (value: string) => {const [h, m] = value.split(':').map(Number); return (h || 0) * 60 + (m || 0);};
const toLocalDate = (ms: number | null) => ms == null ? '' : new Date(ms - new Date(ms).getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
const fromLocalDate = (value: string) => value ? new Date(value).getTime() : null;

function Title({title, subtitle, action}: {title: string; subtitle?: string; action?: ReactNode}) {
 return <div className="panel-title"><div><h2>{title}</h2>{subtitle && <p>{subtitle}</p>}</div>{action}</div>;
}

/** Same upload path as the media library (Vercel Blob, token from media/upload-token), limited to images. */
function ImageField({label, value, onChange}: {label: string; value: string | null; onChange: (url: string | null) => void}) {
 const [busy, setBusy] = useState(false);
 async function pick(file: File | undefined) {
  if (!file) return;
  if (file.size > IMAGE_MAX_BYTES) {toast.error('Image trop lourde (15 Mo maximum).'); return;}
  setBusy(true);
  try {const blob = await uploadBlob(file.name, file, {access: 'public', handleUploadUrl: '/api/core/media/upload-token', clientPayload: 'IMAGE'}); onChange(blob.url);}
  catch (e) {toast.error(e instanceof Error ? e.message : 'Envoi impossible.');}
  finally {setBusy(false);}
 }
 return <label className="field-label">{label}
  <div className="cell-inline"><input type="file" accept="image/jpeg,image/png,image/webp" onChange={e => void pick(e.target.files?.[0])}/>{busy && <Busy/>}{value && <Button type="button" variant="outline" size="sm" onClick={() => onChange(null)}>Retirer</Button>}</div>
  <Input value={value ?? ''} onChange={e => onChange(e.target.value.trim() || null)} placeholder="… ou coller une adresse https://"/>
 </label>;
}

function livePreview(data: Dashboard, venueId: string) {
 const station = data.stations.find(s => s.venueId === venueId && !s.archivedAt);
 const venue = data.venues.find(v => v.id === venueId);
 return {venueName: venue?.name ?? '', city: venue?.city ?? '', online: station?.online ?? true, available: station?.available ?? 4, hourlyCents: data.pricing?.hourlyCents ?? 200, capCents: data.pricing?.capCents ?? 800, depositCents: data.pricing?.depositCents ?? 2000, qrTarget: `https://batyeo.vercel.app/rent/${station?.publicId ?? 'apercu'}`};
}

/** Habillage d'un établissement : ce que ses bornes affichent au repos. Aperçu exact, avant enregistrement. */
export function ScreenStudio({data, refresh}: {data: Dashboard; refresh: Refresh}) {
 const [venueId, setVenueId] = useState(data.venues[0]?.id ?? '');
 const venue = data.venues.find(v => v.id === venueId);
 return <section className="panel">
  <Title title="Habillage des écrans" subtitle="Logo, photo, couleurs, langues et accroches de chaque établissement. Seule l’équipe BATYEO les modifie."/>
  {data.venues.length ? <>
   <label className="field-label">Établissement<Picker label="Établissement" value={venueId} onChange={setVenueId} options={data.venues.map(v => ({value: v.id, label: `${v.name} · ${v.city}`}))}/></label>
   {venue && <BrandingEditor key={venue.id + (venue.branding?.updatedAt ?? 0)} data={data} venueId={venue.id} initial={venue.branding ?? null} refresh={refresh}/>}
  </> : <Empty>Créez d’abord un établissement.</Empty>}
 </section>;
}

function BrandingEditor({data, venueId, initial, refresh}: {data: Dashboard; venueId: string; initial: VenueBranding | null; refresh: Refresh}) {
 const [theme, setTheme] = useState<PosterTheme>(initial?.theme ?? 'batyeo');
 const [logoUrl, setLogoUrl] = useState<string | null>(initial?.logoUrl ?? null);
 const [backgroundUrl, setBackgroundUrl] = useState<string | null>(initial?.backgroundUrl ?? null);
 const [locales, setLocales] = useState<PosterLocale[]>(initial?.locales?.length ? initial.locales : ALL_POSTER_LOCALES);
 const [copy, setCopy] = useState<Partial<Record<PosterLocale, PosterCopy>>>(initial?.copy ?? {});
 const [editLocale, setEditLocale] = useState<PosterLocale>('fr-FR');
 const [busy, setBusy] = useState(false);
 const edited = copy[editLocale] ?? {headlines: [], tagline: ''};
 const defaults = POSTER_STRINGS[editLocale];
 const toggle = (locale: PosterLocale, on: boolean) => {const next = ALL_POSTER_LOCALES.filter(l => l === locale ? on : locales.includes(l)); if (next.length) setLocales(next);};
 async function save() {
  setBusy(true);
  try {await api('venue/branding', {venueId, theme, logoUrl, backgroundUrl, locales, copy}); await refresh(); toast.success('Habillage enregistré · les bornes le prennent dans les 20 secondes.');}
  catch (e) {toast.error(e instanceof Error ? e.message : 'Enregistrement impossible.');}
  finally {setBusy(false);}
 }
 return <div className="screen-studio">
  <div className="screen-preview"><KioskPoster branding={{logoUrl, backgroundUrl, primary: POSTER_THEMES[theme].primary, accent: POSTER_THEMES[theme].accent, locales, copy}} live={livePreview(data, venueId)}/></div>
  <div className="venue-geo">
   <label className="field-label">Style<Picker label="Style" value={theme} onChange={v => setTheme(v as PosterTheme)} options={POSTER_THEME_KEYS.map(key => ({value: key, label: POSTER_THEMES[key].label}))}/></label>
   <label className="field-label">Langue des textes à modifier<Picker label="Langue" value={editLocale} onChange={v => setEditLocale(v as PosterLocale)} options={POSTER_LOCALES.map(l => ({value: l.locale, label: l.label}))}/></label>
  </div>
  <div className="venue-geo"><ImageField label="Logo de l’établissement" value={logoUrl} onChange={setLogoUrl}/><ImageField label="Photo de fond" value={backgroundUrl} onChange={setBackgroundUrl}/></div>
  <fieldset className="field-label"><legend>Langues proposées au toucher (le français reste la langue de repos)</legend>
   <div className="media-targets">{POSTER_LOCALES.map(l => <label className="target-check" key={l.locale}><Checkbox checked={locales.includes(l.locale)} onCheckedChange={v => toggle(l.locale, !!v)}/>{l.label}</label>)}</div>
  </fieldset>
  <label className="field-label">Phrases d’accroche · {POSTER_LOCALES.find(l => l.locale === editLocale)?.label} (une par ligne, vide = texte traduit par défaut)
   <textarea className="text-area" rows={3} value={edited.headlines.join('\n')} onChange={e => setCopy({...copy, [editLocale]: {...edited, headlines: e.target.value.split('\n')}})} placeholder={[defaults.headline1, defaults.headline2, defaults.headline3].join('\n')}/>
  </label>
  <label className="field-label">Sous-titre<Input value={edited.tagline} maxLength={140} onChange={e => setCopy({...copy, [editLocale]: {...edited, tagline: e.target.value}})} placeholder={defaults.tagline}/></label>
  <Button className="cta" disabled={busy} onClick={() => void save()}>{busy && <Busy/>}Enregistrer l’habillage</Button>
 </div>;
}

type PromoRow = Dashboard['promos'][number];
/** Promos des établissements : conçues par BATYEO, programmées par jour et par créneau, à l'heure de Paris. */
export function PromoStudio({data, refresh}: {data: Dashboard; refresh: Refresh}) {
 const venueName = (id: string) => data.venues.find(v => v.id === id)?.name ?? '—';
 async function setStatus(id: string, path: 'promo/publish' | 'promo/archive', label: string) {
  try {await api(path, {id}); await refresh(); toast.success(label);} catch (e) {toast.error(e instanceof Error ? e.message : 'Action impossible.');}
 }
 return <section className="panel">
  <Title title="Promos des établissements" subtitle="Happy hour, soirée match… Affichées entre deux affiches BATYEO, uniquement sur les créneaux choisis." action={data.venues.length ? <PromoEditor data={data} refresh={refresh}/> : undefined}/>
  {data.promos.length ? <DataTable rows={data.promos} searchText={p => `${p.title} ${venueName(p.venueId)}`} columns={[
   {key: 'venue', label: 'ÉTABLISSEMENT', render: p => venueName(p.venueId), sort: p => venueName(p.venueId)},
   {key: 'title', label: 'PROMO', render: p => <strong>{p.title}{p.highlight ? ` · ${p.highlight}` : ''}</strong>},
   {key: 'when', label: 'CRÉNEAU', render: p => promoScheduleLabel(p)},
   {key: 'status', label: 'STATUT', render: p => <Status value={p.status}/>},
   {key: 'actions', label: '', render: p => <div className="sim-buttons"><PromoEditor data={data} refresh={refresh} promo={p}/>{p.status !== 'PUBLISHED' && <Button variant="outline" onClick={() => void setStatus(p.id, 'promo/publish', 'Promo publiée.')}>Publier</Button>}{p.status !== 'ARCHIVED' && <Button variant="outline" onClick={() => void setStatus(p.id, 'promo/archive', 'Promo archivée.')}>Archiver</Button>}</div>},
  ]}/> : <Empty>Aucune promo pour l’instant. Les demandes des établissements arrivent dans Assistance.</Empty>}
 </section>;
}

function PromoEditor({data, refresh, promo}: {data: Dashboard; refresh: Refresh; promo?: PromoRow}) {
 const blank = {venueId: data.venues[0]?.id ?? '', title: '', highlight: '', subtitle: '', imageUrl: null as string | null, days: [1, 2, 3, 4, 5] as Weekday[], start: '18:00', end: '20:00', startsAt: '', endsAt: '', seconds: '8'};
 const fromPromo = () => promo ? {venueId: promo.venueId, title: promo.title, highlight: promo.highlight, subtitle: promo.subtitle, imageUrl: promo.imageUrl, days: promo.days, start: toTime(promo.startMinute), end: toTime(promo.endMinute), startsAt: toLocalDate(promo.startsAt), endsAt: toLocalDate(promo.endsAt), seconds: String(Math.round(promo.durationMs / 1000))} : blank;
 const [form, setForm] = useState(fromPromo);
 const [open, setOpen] = useState(false);
 const [busy, setBusy] = useState(false);
 const set = (patch: Partial<typeof form>) => setForm({...form, ...patch});
 const venue = data.venues.find(v => v.id === form.venueId);
 const branding = venue?.branding;
 const theme = POSTER_THEMES[branding?.theme ?? 'batyeo'];
 const schedule = promoScheduleLabel({days: form.days, startMinute: fromTime(form.start), endMinute: fromTime(form.end) || 1440});
 async function save() {
  setBusy(true);
  try {
   await api('promo/save', {...(promo ? {id: promo.id} : {}), venueId: form.venueId, title: form.title.trim(), highlight: form.highlight.trim(), subtitle: form.subtitle.trim(), imageUrl: form.imageUrl, days: form.days, startMinute: fromTime(form.start), endMinute: fromTime(form.end) || 1440, startsAt: fromLocalDate(form.startsAt), endsAt: fromLocalDate(form.endsAt), durationMs: Math.round(Number(form.seconds) * 1000)});
   await refresh(); toast.success(promo ? 'Promo modifiée.' : 'Promo créée en brouillon · à publier pour l’afficher.'); setOpen(false);
  } catch (e) {toast.error(e instanceof Error ? e.message : 'Enregistrement impossible.');}
  finally {setBusy(false);}
 }
 return <Dialog open={open} onOpenChange={o => {if (o) setForm(fromPromo()); setOpen(o);}}>
  <DialogTrigger asChild>{promo ? <Button variant="outline">Modifier</Button> : <Button className="cta">Nouvelle promo</Button>}</DialogTrigger>
  <DialogContent className="dialog-wide">
   <DialogHeader><DialogTitle>{promo ? 'Modifier la promo' : 'Nouvelle promo'}</DialogTitle><DialogDescription>Heures de Paris. Un créneau peut passer minuit (22:00 → 02:00).</DialogDescription></DialogHeader>
   <div className="screen-preview"><KioskPromo promo={{id: 'apercu', title: form.title || 'Titre', highlight: form.highlight, subtitle: form.subtitle, imageUrl: form.imageUrl, schedule}} branding={{logoUrl: branding?.logoUrl ?? null, backgroundUrl: branding?.backgroundUrl ?? null, primary: theme.primary, accent: theme.accent, locales: ['fr-FR'], copy: {}}} venueName={venue?.name ?? ''} qrTarget="https://batyeo.vercel.app" canRent/></div>
   {!promo && <label className="field-label">Établissement<Picker label="Établissement" value={form.venueId} onChange={v => set({venueId: v})} options={data.venues.map(v => ({value: v.id, label: `${v.name} · ${v.city}`}))}/></label>}
   <div className="venue-geo">
    <label className="field-label">Titre<Input value={form.title} maxLength={60} onChange={e => set({title: e.target.value})} placeholder="Happy hour"/></label>
    <label className="field-label">En grand<Input value={form.highlight} maxLength={30} onChange={e => set({highlight: e.target.value})} placeholder="Pinte à 5 €"/></label>
   </div>
   <label className="field-label">Détail<Input value={form.subtitle} maxLength={120} onChange={e => set({subtitle: e.target.value})} placeholder="Toutes les pintes et les cocktails maison"/></label>
   <ImageField label="Photo (sinon la photo de fond de l’établissement)" value={form.imageUrl} onChange={url => set({imageUrl: url})}/>
   <fieldset className="field-label"><legend>Jours</legend><div className="media-targets">{DAYS.map(d => <label className="target-check" key={d.value}><Checkbox checked={form.days.includes(d.value)} onCheckedChange={v => set({days: v ? [...form.days, d.value] : form.days.filter(x => x !== d.value)})}/>{d.label}</label>)}</div></fieldset>
   <div className="venue-geo">
    <label className="field-label">De<Input type="time" value={form.start} onChange={e => set({start: e.target.value})}/></label>
    <label className="field-label">À<Input type="time" value={form.end} onChange={e => set({end: e.target.value})}/></label>
    <label className="field-label">Durée à l’écran (s)<Input type="number" min={4} max={60} value={form.seconds} onChange={e => set({seconds: e.target.value})}/></label>
   </div>
   <div className="venue-geo">
    <label className="field-label">À partir du (optionnel)<Input type="datetime-local" value={form.startsAt} onChange={e => set({startsAt: e.target.value})}/></label>
    <label className="field-label">Jusqu’au (optionnel)<Input type="datetime-local" value={form.endsAt} onChange={e => set({endsAt: e.target.value})}/></label>
   </div>
   <Button className="cta" disabled={busy || !form.venueId || !form.title.trim() || !form.days.length || form.start === form.end} onClick={() => void save()}>{busy && <Busy/>}{promo ? 'Enregistrer' : 'Créer la promo'}</Button>
  </DialogContent>
 </Dialog>;
}

/** Fiche légale d'un partenaire — ce qu'il faut pour lui verser sa commission et le facturer. BATYEO seul la modifie. */
export function PartnerProfileAction({partner, refresh}: {partner: Dashboard['partners'][number]; refresh: Refresh}) {
 const initial = () => ({legalName: partner.legalName ?? '', siret: partner.siret ?? '', billingAddress: partner.billingAddress ?? '', contactName: partner.contactName ?? '', contactEmail: partner.contactEmail ?? '', contactPhone: partner.contactPhone ?? '', iban: partner.iban ?? '', contract: partner.contractStartedAt ? new Date(partner.contractStartedAt).toISOString().slice(0, 10) : ''});
 const [form, setForm] = useState(initial);
 const [open, setOpen] = useState(false);
 const [busy, setBusy] = useState(false);
 const set = (patch: Partial<typeof form>) => setForm({...form, ...patch});
 const missing = [!partner.legalName && 'raison sociale', !partner.siret && 'SIRET', partner.iban === '' && 'IBAN', !partner.contactEmail && 'contact'].filter(Boolean);
 async function save() {
  setBusy(true);
  try {await api('partner/profile', {partnerId: partner.id, legalName: form.legalName, siret: form.siret.replace(/\s+/g, ''), billingAddress: form.billingAddress, contactName: form.contactName, contactEmail: form.contactEmail.trim(), contactPhone: form.contactPhone, iban: form.iban, contractStartedAt: form.contract ? new Date(form.contract).getTime() : null}); await refresh(); toast.success('Fiche partenaire enregistrée.'); setOpen(false);}
  catch (e) {toast.error(e instanceof Error ? e.message : 'Enregistrement impossible.');}
  finally {setBusy(false);}
 }
 return <Dialog open={open} onOpenChange={o => {if (o) setForm(initial()); setOpen(o);}}>
  <DialogTrigger asChild><Button size="sm" variant="outline">Fiche{missing.length ? ` · ${missing.length} manquant${missing.length > 1 ? 's' : ''}` : ''}</Button></DialogTrigger>
  <DialogContent>
   <DialogHeader><DialogTitle>Fiche de {partner.name}</DialogTitle><DialogDescription>Utilisée pour verser la commission. Un changement d’IBAN est inscrit au journal.</DialogDescription></DialogHeader>
   <label className="field-label">Raison sociale<Input value={form.legalName} maxLength={160} onChange={e => set({legalName: e.target.value})} placeholder="SAS Le Comptoir"/></label>
   <div className="venue-geo">
    <label className="field-label">SIRET<Input value={form.siret} maxLength={17} onChange={e => set({siret: e.target.value})} placeholder="14 chiffres"/></label>
    <label className="field-label">Début du contrat<Input type="date" value={form.contract} onChange={e => set({contract: e.target.value})}/></label>
   </div>
   <label className="field-label">Adresse de facturation<Input value={form.billingAddress} maxLength={300} onChange={e => set({billingAddress: e.target.value})}/></label>
   <div className="venue-geo">
    <label className="field-label">Contact<Input value={form.contactName} maxLength={120} onChange={e => set({contactName: e.target.value})}/></label>
    <label className="field-label">Téléphone<Input value={form.contactPhone} maxLength={30} onChange={e => set({contactPhone: e.target.value})}/></label>
   </div>
   <label className="field-label">Email du contact<Input type="email" value={form.contactEmail} maxLength={200} onChange={e => set({contactEmail: e.target.value})}/></label>
   {partner.iban !== undefined && <label className="field-label">IBAN (versement de la commission)<Input value={form.iban} maxLength={42} onChange={e => set({iban: e.target.value})} placeholder="FR76 …"/></label>}
   <Button className="cta" disabled={busy} onClick={() => void save()}>{busy && <Busy/>}Enregistrer</Button>
  </DialogContent>
 </Dialog>;
}

/** Côté établissement : il demande, BATYEO conçoit. Il voit aussi ce qui passe déjà sur son écran. */
export function PartnerPromos({data}: {data: Dashboard}) {
 const [venueId, setVenueId] = useState(data.venues[0]?.id ?? '');
 const [offer, setOffer] = useState(''), [when, setWhen] = useState(''), [details, setDetails] = useState('');
 const [busy, setBusy] = useState(false);
 async function send() {
  setBusy(true);
  try {await api('promo/request', {venueId, offer: offer.trim(), when: when.trim(), details: details.trim() || undefined}); toast.success('Demande envoyée · l’équipe BATYEO prépare votre affiche.'); setOffer(''); setWhen(''); setDetails('');}
  catch (e) {toast.error(e instanceof Error ? e.message : 'Envoi impossible.');}
  finally {setBusy(false);}
 }
 return <section className="panel">
  <Title title="Vos promos à l’écran" subtitle="Votre offre, mise en forme par BATYEO, affichée sur votre borne aux créneaux convenus." action={data.venues.length ? <Dialog><DialogTrigger asChild><Button className="cta">Demander une promo</Button></DialogTrigger><DialogContent>
   <DialogHeader><DialogTitle>Demander une promo</DialogTitle><DialogDescription>Décrivez votre offre : BATYEO crée l’affiche et vous confirme sa mise en ligne.</DialogDescription></DialogHeader>
   {data.venues.length > 1 && <label className="field-label">Établissement<Picker label="Établissement" value={venueId} onChange={setVenueId} options={data.venues.map(v => ({value: v.id, label: v.name}))}/></label>}
   <label className="field-label">L’offre<Input value={offer} maxLength={200} onChange={e => setOffer(e.target.value)} placeholder="Happy hour : pinte à 5 €"/></label>
   <label className="field-label">Quand<Input value={when} maxLength={200} onChange={e => setWhen(e.target.value)} placeholder="Du lundi au vendredi, 18h-20h"/></label>
   <label className="field-label">Précisions (optionnel)<textarea className="text-area" rows={3} maxLength={1000} value={details} onChange={e => setDetails(e.target.value)}/></label>
   <Button className="cta" disabled={busy || offer.trim().length < 3 || when.trim().length < 2} onClick={() => void send()}>{busy && <Busy/>}Envoyer la demande</Button>
  </DialogContent></Dialog> : undefined}/>
  {data.promos.length ? <DataTable rows={data.promos} searchText={p => p.title} columns={[
   {key: 'title', label: 'PROMO', render: p => <strong>{p.title}{p.highlight ? ` · ${p.highlight}` : ''}</strong>},
   {key: 'when', label: 'CRÉNEAU', render: p => promoScheduleLabel(p)},
  ]}/> : <Empty>Aucune promo en cours sur votre écran.</Empty>}
 </section>;
}
