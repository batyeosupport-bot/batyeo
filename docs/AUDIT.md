# Audit avant lancement — 2026-09-20

> **Suite donnée le 2026-09-20** : tous les points ci-dessous ont été corrigés, sauf ceux
> explicitement marqués « reste à faire » dans la section finale. Le document garde la description
> d'origine du problème, qui explique *pourquoi* chaque correction existe.

Revue complète du dépôt à la recherche d'incohérences, de bugs et de manques, en vue d'un usage
avec de vrais clients. Chaque point a été vérifié dans le code, pas supposé. Classé par ce que
ça coûte, pas par difficulté.

État des vérifications automatiques au moment de l'audit : 279 tests, `tsc`, ESLint,
`pnpm build`, `pnpm test:sql`, `pnpm test:integration` — tous verts.

---

## 1. Bug corrigé pendant l'audit

**Un retour physique confirmé par la borne pouvait rester bloqué et déclencher la capture de
toute la caution.** `prepareReturn(..., detected=true)` passait encore par
`MockBatteryStationProvider.returnBattery`, qui refuse si la station de retour est marquée hors
ligne **côté BATYEO** ou si son plan de slots local est saturé. L'erreur était avalée par
`onReturnDetected` (à raison : elle ne doit pas invalider la synchronisation), donc la location
restait `ACTIVE` en silence et la tâche des 48 h capturait les 20 € pour une batterie pourtant
rendue. Les deux cas ont été reproduits avant correction.

Corrigé : quand la borne confirme elle-même le retour, la comptabilité locale **suit le
matériel** au lieu de le contredire (`RentalEngine.placeReturned`). Si aucun slot n'est libre à
la station de retour, la batterie est placée ailleurs dans le réseau plutôt que de bloquer la
clôture : l'argent est juste, et l'écart de position remonte comme un `SLOT_MISMATCH` ordinaire
à la lecture suivante. Deux tests de non-régression couvrent les deux sabotages.

---

## 2. Incohérences qui coûtent de l'argent ou de la confiance

### A. Une borne réellement hors ligne reste « en ligne » dans BATYEO — le plus grave

`RentalEngine.create` refuse une location sur `station.online` (drapeau **local**). La
synchronisation fabricant, elle, n'écrit que `station.providerStatus` et ne touche jamais
`online` (choix délibéré : la synchro reste en lecture seule). Seul le simulateur — interdit en
production — écrit `online`.

Conséquence : tu débranches la borne (le brief dit que ça arrive à la main), l'API fabricant
répond `Device not online`, et le site public continue d'afficher la borne disponible. Un client
lance une location, sa caution est autorisée, puis l'éjection échoue. Avec l'éjecteur réel la
caution est bien relâchée, mais le client a payé une attente pour rien.

Aggravant : `evaluateAlerts` construit l'alerte `STATION_OFFLINE` sur le même drapeau local.
Une borne physiquement morte ne déclenche donc **aucune alerte**.

### B. La disponibilité affichée au client vient de la base, pas de la borne

`stationViews` compte les slots locaux. Entre deux lectures, toute sortie hors BATYEO (flux
natif ChargeNow, éjection manuelle depuis leur panneau) rend le compte faux. Le client voit
« 4 batteries disponibles » alors que la borne est vide. La détection d'écarts existe déjà
(`UNEXPLAINED_SLOT_CHANGE`), mais elle journalise au lieu de corriger l'affichage.

### C. Une batterie perdue puis rendue est définitivement hors service

`markDepositLost` passe la batterie en `LOST`. Aucune route ne permet de revenir en arrière : le
statut `MAINTENANCE` n'est atteignable que par le simulateur (`server/http.ts`, route
`simulate`), interdit en production. Or le cas est certain : un client paie la caution au bout
de 48 h puis rapporte la batterie. Elle reste alors `LOST` pour toujours, la borne perd une
place, et « Aligner l'inventaire » la refuse justement parce qu'elle porte un historique.

Même trou pour une batterie physiquement abîmée : impossible de la sortir de la rotation.

### D. Aucun remboursement, aucune gestion de litige

`core/stripe.ts` expose `authorize`, `capture`, `release` — pas `refund`. Une fois la caution
capturée, rien dans l'admin ne permet de rendre l'argent, même en cas d'erreur manifeste.
`applyWebhook` traite quatre événements Stripe (autorisation, succès, annulation, échec) mais
ni `charge.dispute.created` ni `charge.refunded` : une contestation bancaire passerait
inaperçue côté BATYEO.

### E. Aucun versement aux partenaires

La commission est calculée par location, figée dans le snapshot tarifaire et affichée dans
Finance. Mais rien ne la **paie**. Il n'existe ni relevé de période, ni export comptable, ni
virement. (Attention au faux ami : `completeSettlement` et le trigger `batyeo_check_settlement`
désignent la clôture financière d'une location, pas un versement.) Un partenaire réel demandera
son argent dès le premier mois.

---

## 3. Trous fonctionnels

### F. Le client n'est identifié que par un cookie

Aucun email ni téléphone n'est collecté (`CustomerSession` ne porte qu'un identifiant opaque).
C'est sobre côté RGPD, mais : aucun reçu envoyé, **aucun moyen de prévenir un client avant de
lui débiter 20 €**, et un cookie perdu (navigation privée, autre téléphone, nettoyage) coupe
l'accès à sa location en cours. Le transfert web → mobile existe (`customer/handoff`) mais exige
la session d'origine, donc il ne répare pas ce cas. Débiter une caution sans avoir jamais pu
joindre la personne est commercialement dur et juridiquement fragile.

### G. Aucun envoi d'email dans tout le projet

Conséquences en chaîne : pas de « mot de passe oublié » (un admin doit générer un mot de passe
temporaire), pas de reçu, pas de relance avant la perte définitive, pas de notification
partenaire.

### H. Aucune tâche planifiée configurée

`vercel.json` ne contient pas de `crons`. Les deux routes existent et sont protégées par secret
(`internal/manufacturer/sync`, `internal/rentals/capture-overdue-losses`) mais personne ne les
appelle. Donc aujourd'hui : une batterie jamais rendue n'est **jamais** facturée, et la
détection de retour ne se déclenche qu'au webhook (non enregistré) ou à une synchro manuelle.

### I. Aucune surveillance d'erreurs

Une requête qui échoue fait `console.error` et renvoie un 503 générique. C'est exactement ce qui
a rendu l'incident `DATABASE_URL` si long à diagnostiquer. Le panneau Système aide désormais,
mais il faut encore que quelqu'un regarde.

---

## 4. Mentions « démonstration » encore présentes partout

À retirer d'un bloc le jour du passage en réel, sinon le site dit au client que son paiement est
fictif :

- `dashboard()` renvoie `demo:true` **en dur**, quel que soit l'environnement (`core/queries.ts`).
- Badge « DONNÉES DÉMO » en dur dans l'en-tête du portail (`portal.tsx`).
- Bandeau « MODE DÉMO · AUCUN PAIEMENT RÉEL » et « Paiement simulé. Aucune carte nécessaire. »
  sur la page de location (`rental.tsx`, `WEB_DEFAULT_STRINGS_FR`).
- `/terms` et `/privacy` sont des « DOCUMENT DE DÉMONSTRATION » (`public.tsx`) — il faut de
  vraies CGU et une vraie politique de confidentialité.
- La version de conditions acceptée par le client est `demo-2026-09-v1` (`core/rental.ts`).
- `/api/core/health` annonce toujours `station:'mock'`, même avec une borne réelle branchée et
  l'éjecteur réel actif (`server/http.ts`).
- Pied de page « Paiements et stations simulés ».

Aucun de ces points n'est un bug, mais ensemble ils rendent le produit impossible à présenter
comme réel.

---

## 5. Points déjà connus, rappelés pour mémoire

- Paiement réel volontairement impossible (`PaymentMode='mock'|'stripe_test'`).
- Boucle physique : éjection verrouillée en attente du fournisseur, webhook non enregistré.
- `paris-demo` porte de l'historique de démo : « Aligner l'inventaire » y sera refusé, et il
  n'existe aucune commande pour détacher un `externalId` d'une station.
- Paiement par carte sur la borne : décision produit ouverte.
- App mobile jamais lancée sur un appareil ; Vercel Blob à activer.

---

## Ordre conseillé

1. **H** (tâches planifiées) — sinon rien ne se facture tout seul. Geste de configuration.
2. **A** puis **B** — faire suivre l'état réel de la borne, sinon on vend du vide.
3. **C**, **D** — les deux gestes de rattrapage sans lesquels toute erreur est définitive.
4. **F**/**G** — collecter un email et l'utiliser : reçu, relance avant débit, mot de passe oublié.
5. **E** — versement partenaire, avant le premier vrai partenaire payé.
6. **4.** — retirer les mentions démo, en dernier, juste avant le passage en réel.


---

# Suite donnée — 2026-09-20

## Corrigé

- **Bug d'argent (retour bloqué)** — `RentalEngine.placeReturned` : quand la borne confirme le
  retour, la comptabilité locale suit le matériel au lieu de le contredire.
- **A. Borne hors ligne** — pour une station liée à une borne réelle, la synchronisation écrit
  `station.online` d'après la lecture. Une réponse « device not online » (code 2004) vaut borne
  hors ligne ; un simple timeout réseau ne touche à rien, pour ne pas couper les ventes sur un
  incident passager.
- **B. Disponibilité** — `cappedAvailability` : ni l'affichage public ni la porte de vente ne
  peuvent annoncer plus de batteries qu'une lecture fraîche (< 15 min) de la borne. Sous-promettre
  est le seul sens sûr.
- **C. Batteries bloquées** — `setBatteryService` + bouton dans Batteries : retirer du service une
  batterie abîmée, et remettre en service une batterie perdue puis rapportée (en indiquant la borne
  où elle a été retrouvée). Jamais sur une batterie en cours de location.
- **D. Remboursement et litiges** — `rental/refund` (rôles financiers BATYEO uniquement, jamais un
  partenaire), Stripe appelé avant tout enregistrement local. `charge.dispute.created` et
  `charge.refunded` sont rattachés au paiement par `payment_intent`, ce qui rattrape aussi un
  remboursement fait depuis le tableau de bord Stripe. Une contestation lève une alerte CRITICAL.
- **E. Versement partenaire** — `partnerStatements` + bouton « Relevé des commissions » : total dû
  par partenaire sur une période, exporté en CSV lisible directement par un tableur français. Les
  locations sont comptées à leur date de **retour**. Un remboursement baisse l'encaissé mais jamais
  la commission, figée dans le snapshot tarifaire.
- **F. Contact client** — champ email facultatif à la location, invisible des partenaires
  (`rentalView(..., contact)`), affiché dans le détail de la location côté BATYEO.
- **H. Tâche planifiée** — `GET internal/cron` protégé par `CRON_SECRET` (le secret que Vercel
  attache lui-même), qui lance la synchronisation **et** la capture des cautions en retard.
  Déclaré dans `vercel.json` à 3 h du matin, ce qui tient sur un plan gratuit.
- **I. Journalisation** — une requête qui échoue journalise sa route, sa méthode et le type
  d'erreur, sans rien exposer au client.
- **Section 4 (mentions démo)** — tout ce qu'on dit au client sur son argent découle désormais du
  mode de paiement réel. Le mode `stripe_live` existe et exige une clé `sk_live_` explicite.
  Conditions de location et confidentialité réécrites pour le service réel ; la version acceptée
  n'est plus `demo-…` mais `TERMS_VERSION` (`2026-09-v1` par défaut).

## Reste à faire, et pourquoi je ne l'ai pas fait

- **G. Envoi d'emails** — l'adresse est maintenant collectée et affichée, mais **rien n'est
  envoyé** : cela demande un prestataire (Resend, Postmark, SES…), un domaine vérifié et une clé
  API. Décision + identifiants côté utilisateur. Tant que ce n'est pas branché, la relance avant
  débit de caution se fait à la main depuis le détail de la location.
- **Validation juridique** — les deux pages légales décrivent fidèlement le service mais doivent
  être complétées (identité de l'exploitant, médiateur de la consommation, rétractation) et
  relues par un juriste avant tout encaissement réel.
- **Secrets à créer dans Vercel** — `CRON_SECRET` (sinon la tâche planifiée répond 401).
- **Migrations à appliquer** — `202609200001_refund_and_dispute` et `202609200002_customer_contact`
  sur staging puis production.
- **Le reste de la boucle physique** — inchangé : réponse du fournisseur, enregistrement du
  webhook, puis ouverture du verrou. Voir `docs/EXTERNAL_BLOCKERS.md`.
