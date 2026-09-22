# Brief de reprise — état au 2026-09-19 (fin de session)

> Colle ce brief tel quel au démarrage d'une nouvelle session Claude Code.
> Aucun secret ici : mots de passe, clés Stripe et identifiants ChargeNow
> restent dans tes notes personnelles, jamais dans le dépôt.

---

## Le projet

BATYEO loue des batteries externes dans des bornes physiques installées chez des commerçants (bars, hôtels). Le client scanne un QR ou paie par carte sur la borne, prend une batterie, la rend sous 48 h.

Repo à `/Users/anismeslin/Developer/BATYEO` (monorepo) :
- **`core/`** — domaine métier, très testé (264 tests, tous passants).
- **`server/http.ts`** — toutes les routes API, un seul dispatcher par chaîne de caractères.
- **`app/` + `components/batyeo/`** — site public Next.js, portail admin/partenaire, page kiosque `/kiosk/[publicId]`, parcours client `/rent/[publicId]`.
- **`mobile/`** — app **cliente** Expo/React Native (npm, pas pnpm) — à ne pas confondre avec `runtime/`.
- **`runtime/`** — app kiosque Android native en Kotlin qui tourne **sur la borne physique** : carrousel média natif + WebView qui affiche le parcours web + Stripe Terminal.

## Où en est le déploiement

- **Production Vercel** : `batyeo.vercel.app`, base Postgres staging Supabase (projet `mrmbhdachgrzzjtylzwv` — **distinct** du projet dans `.env`, qui est la prod).
- Une seule borne visible : « Borne maison test » (`paris-demo`), liée à la vraie borne `DTA55480`. Lecture temps réel confirmée via l'Open API ChargeNow.
- `PAYMENT_PROVIDER=stripe_test` avec une vraie clé `sk_test_…` (compte Stripe personnel de l'utilisateur).
- Connexion admin : `https://batyeo.vercel.app/admin/login` (compte démo `admin@batyeo.demo`, mot de passe dans tes notes).
- 264 tests, `tsc`, ESLint, `pnpm build`, `pnpm test:sql` : tous verts au dernier commit.

## Interdits absolus (inchangés)

1. **`MANUFACTURER_ALLOW_PHYSICAL_ACTIONS` doit rester `false`** partout tant que le fournisseur n'a pas confirmé la désactivation de son flux de location natif — sinon deux systèmes peuvent distribuer la même batterie. Le code est prêt et testé ; ne l'active **jamais** sans instruction explicite.
2. **Ne jamais cliquer sur un bouton d'action physique** dans le panneau admin ChargeNow (Eject, Restart, Firmware update…). Lecture et capture d'écran seulement.
3. **Ne jamais lancer le serveur de dev contre `.env`** : il pointe la prod. Toute commande Prisma/script doit exporter explicitement les URLs de la base staging avant de s'exécuter.
4. **Ne commit aucun secret.**
5. La borne physique est débranchable à la main : `"Device not online."` (code 2004) n'est pas un bug, c'est son état réel — vérifier avec l'utilisateur avant de creuser le code.

## Ce qui a été fait dans la session du 2026-09-19 (16 commits)

1. **Commission par partenaire** — `Partner.commissionBps` dormait depuis le premier commit, jamais lu. Réactivé comme surcharge optionnelle de la grille (`null` = suit la grille). Le taux est figé dans le snapshot tarifaire à la **création** de la location, seul endroit possible : `commissionCents` doit valoir `amountCents × pricingSnapshot.commissionBps`, imposé à la fois par l'invariant TS et par le trigger Postgres `batyeo_check_settlement`. Le non-recalcul rétroactif est donc structurel. Paliers 0/5/10/20/30 %, réservés aux rôles financiers. Migration appliquée sur staging.
2. **Finances par borne + plage de dates précise** dans le panneau Finance (le sélecteur réutilise le `Calendar` shadcn déjà présent, aucune dépendance ajoutée). « Aujourd'hui » découpait la journée sur minuit UTC — corrigé en journée locale.
3. **Modification d'un établissement** (`updateVenue`) — n'existait pas, l'adresse de la borne réelle avait dû être saisie par requête API. Changer l'adresse/ville détache la Location Stripe des bornes du lieu (même raison que `relocateStation`).
4. **Téléversement de fichiers pour les médias** (`@vercel/blob`, upload direct navigateur → Blob car Vercel plafonne le corps d'une requête serveur à 4,5 Mo). `checksum` passait un UUID aléatoire jamais lu ; devient l'ETag réel du fichier.
5. **Programmation d'une pub** (`startsAt`/`endsAt`) — existait de bout en bout sauf les champs du formulaire.
6. **Parcours de location web traduit** — `WEB_STRING_KEYS` (~37 clés) séparé de `RUNTIME_STRING_KEYS` (la liste borne suppose un terminal carte/NFC physique). `WEB_DEFAULT_STRINGS_FR` est **codé en dur** : cette page encaisse de l'argent, elle ne doit jamais dépendre d'une config admin. Nouvel onglet « Parcours web » dans l'éditeur de traductions. Route publique `translations/:publicId`.
7. **Création de partenaire** (`partner/create`) — crée la fiche **et** son premier compte PARTNER_ADMIN en une fois (un partenaire sans utilisateur est une impasse). Réservé SUPER_ADMIN/ADMIN. Mot de passe temporaire affiché une seule fois.

### Bugs réels trouvés et corrigés en chemin
- `displayConfigFor`/`stationDisplaySnapshot` levaient `Error` au lieu de `DomainError` → 503 générique au lieu d'un 404 propre. Invisible jusqu'ici (tous les appelants validaient déjà la station), devenu atteignable via la nouvelle route publique.
- Une erreur de config au démarrage cassait **toutes** les routes en 503 générique (`resolvePaymentMode`/`validateManufacturerStartup` hors du try/catch).

### Incident de production résolu
`DATABASE_URL` dans Vercel contenait un mot de passe périmé → toute l'API en 503 générique. Diagnostiqué en déployant temporairement le détail de l'exception dans la réponse (`PrismaClientKnownRequestError P1000`), corrigé côté tableau de bord, patch retiré. **Leçon opérationnelle** : une route **neuve** met parfois plusieurs minutes à se propager sur Vercel alors que `/health` répond déjà 200 — ne jamais conclure à un bug de routage avant d'avoir attendu et re-testé **authentifié** (un 401 ne prouve rien, il se déclenche pour n'importe quel chemin inconnu).

---

## Ce qu'il reste à faire, par priorité

### A. Le trou le plus important : la boucle physique est ouverte des deux côtés

En production aujourd'hui, **aucune action physique réelle n'a lieu** :

- **Éjection réelle** : code prêt (`ManufacturerBatteryEjector`), verrou fermé. Bloqué sur la réponse du fournisseur (Tony).
- **Détection de retour réelle : construite côté code, pas encore alimentée.** *(mis à jour en fin de session — voir plus bas)* Ancien constat : `ManufacturerBatteryStationProvider.returnBattery()` lève `PHYSICAL_BLOCKED`. La seule façon dont une location se termine aujourd'hui est `customer/return` — **le client déclare lui-même avoir rendu la batterie**, sans aucune confirmation matérielle. En démo c'est sans conséquence ; avec de vrais paiements, c'est un trou de revenus (déclarer un retour sans rendre la batterie arrête la facturation).
- Le mécanisme existe pourtant côté fournisseur : l'abonnement webhook `cabinet/eventPush/config` publie un événement **`BATTERY_IN`** (batterie insérée). La route `manufacturer/webhook` existe déjà côté BATYEO et fait ce qu'il faut (ne fait jamais confiance au payload, déclenche une relecture `cabinet/query`) — mais **aucun abonnement n'a jamais été enregistré**, et le webhook ne clôture aucune location.

**État après la session du 2026-09-19 (suite)** : `detectReturns` (`core/manufacturer-sync.ts`) est fait, testé et poussé — toute relecture `cabinet/query` qui voit la batterie d'une location `ACTIVE`/`OVERDUE` dans un slot (sortie depuis plus de 2 min) clôt la location et capture le paiement (`prepareReturn(..., detected=true)`). Il ne reste **que** : (1) l'abonnement webhook (accord de l'utilisateur requis pour donner l'URL au fournisseur) ; sans lui, seule la synchro planifiée déclenche la détection ; (2) ~~l'invariant « orphan rental battery »~~ — le vrai défaut était plus grave et est corrigé : voir « Alignement de l'inventaire » dans `docs/EXTERNAL_BLOCKERS.md` (bouton « Aligner l'inventaire » ; `paris-demo` de staging sera refusée tant qu'elle porte de l'historique de démo).

**Étape d'origine** : enregistrer `pushUrl` = `https://batyeo.vercel.app/api/core/manufacturer/webhook` via `cabinet/eventPush/config` (nécessite l'accord de l'utilisateur pour donner cette URL au fournisseur), puis faire remonter `BATTERY_IN` jusqu'à la clôture d'une location — en gardant le principe déjà en place : le payload est une *suggestion de réconciliation*, la relecture `cabinet/query` reste la source de vérité.

### B. Paiement par carte sur la borne
`runtime/TerminalManager.kt` sait découvrir et connecter un lecteur Bluetooth BBPOS WisePOS, et attend une Location Stripe (bouton admin déjà construit). Il s'arrête **volontairement** avant `createPaymentIntent → collectPaymentMethod → confirmPaymentIntent` (commentaire explicite aux lignes 31-32). Décision produit encore ouverte : réutiliser le lecteur déjà dans la borne ou en acheter un dédié.

### C. Comptes et accès — **fait le 2026-09-19** (`core/accounts.ts`, section « Équipe » du portail)
Changement de mot de passe en libre-service (`settings/password`, coupe les autres sessions), création de compte pour un partenaire existant (`team/create`), désactivation/réactivation immédiate (`team/set-disabled`), nouveau mot de passe temporaire généré par un admin (`team/reset-password`, affiché une seule fois). Un PARTNER_ADMIN ne voit et ne gère que son partenaire ; un ADMIN ne touche pas un SUPER_ADMIN ; personne ne peut se désactiver soi-même. **Pas encore fait** : réinitialisation par email « mot de passe oublié » (il n'y a aucun envoi d'email dans le projet) ; interface **vérifiée dans un vrai Chrome le 2026-09-19** (création de compte, désactivation, changement de mot de passe, dialogue média) via `node scripts/ui-check.mjs` après `pnpm build` : il monte l'app sur une base D1 jetable en mémoire, sans jamais lire `.env`.

### D. Panneau d'état du système — **fait le 2026-09-19** (section « Système », personnel BATYEO seulement)
Route `system/status` : mode de paiement, fournisseur de la borne, verrou d'éjection physique, santé de la synchronisation, en langage courant. Vérifié dans Chrome (un défaut d'affichage des pastilles a été trouvé et corrigé à cette occasion).

### E. Reste de moindre priorité
- **Activer Vercel Blob** (Storage → Create → Blob) : sans ça le bouton de téléversement des médias renvoie une erreur claire mais ne fonctionne pas. Geste tableau de bord, côté utilisateur.
- ~~Écrans rares du parcours client non traduits~~ — **fait le 2026-09-19** : échec, retour en cours, vérification, annulation/expiration et batterie perdue passent par `web_failed_*`, `web_returning_*`, `web_review_*`, `web_cancelled_*`, `web_lost_*` (français codé en dur en repli ; `\n` = retour à la ligne dans les titres). Restent codés en dur : « Besoin d’aide ? », « Les stations », le bandeau « MODE DÉMO » et le libellé « Langue ».
- ~~Médias pour les partenaires~~ — **fait le 2026-09-19** : la section « Affichage » apparaît pour un PARTNER_ADMIN (pas PARTNER_USER) ; il ne voit et ne crée que des médias visant *exclusivement* ses propres stations (les pubs « toutes stations » et celles d'un autre partenaire lui restent invisibles). Un média multi-partenaires créé par le personnel joue sur sa borne sans qu'il le voie. Jamais vu dans un navigateur.
- **App mobile cliente** : jamais lancée sur un vrai appareil (pas d'émulateur Android sur cette machine ; un simulateur iOS existe, jamais essayé).
- ~~`pnpm test:integration` échouait~~ — **corrigé** : il manquait deux tables (`displayConfigs`, `stationHeartbeats`) dans `drizzle/`, migration `0008` ajoutée. La cible D1/Workers n'est pas abandonnée : `pnpm dev`, `pnpm build` et le smoke test navigateur en dépendent (Vercel utilise Postgres).

---

> **Audit complet du 2026-09-20 : `docs/AUDIT.md`** — incohérences vérifiées dans le code (borne hors ligne invisible, disponibilité locale, batterie perdue irrécupérable, aucun remboursement, aucun versement partenaire), manques (email, client identifié par un simple cookie, tâches planifiées, surveillance) et inventaire des mentions « démo » à retirer. Un bug d'argent y a été trouvé et corrigé. À lire avant de planifier la suite.

> **Paiement par carte : construit (2026-09-21).** Parcours en deux temps : `POST start` crée la location et l'intent Stripe (carte uniquement) et renvoie `clientSecret` + `publishableKey` ; la page charge Stripe.js et le Payment Element ; `POST rental/confirm-payment` relit l'intent chez Stripe (`requires_capture`, montant exact, `metadata.rentalId`) avant d'éjecter (`StripeRentalCoordinator.begin/confirm/activate`). `expireStale` (cron, 15 min) et `abandon` libèrent les locations jamais confirmées. Correctif au passage : l'éjecteur réel reçoit désormais l'identifiant **interne** de la station (il recevait l'identifiant public du QR et aurait échoué *après* la sortie de la batterie). **Reste** : l'app mobile n'affiche pas le formulaire de carte (mock uniquement) ; le formulaire n'a été vérifié dans Chrome qu'avec un **faux Stripe.js** — jamais avec le vrai Stripe : premier test réel = carte 4242 en `stripe_test`.

> **Écran de la borne en secours web (2026-09-22).** L'admin (Affichage → Médias + Écran des bornes)
> était déjà fonctionnel, mais rien n'en affichait le résultat sans l'application Android installée.
> `GET display/:publicId` (public, sans identifiants) expose maintenant le sous-ensemble sûr de
> `displayConfigFor` (message d'accueil, bandeau de maintenance, playlist active — jamais l'ID de
> Location Stripe Terminal). `app/kiosk/[publicId]/page.tsx` alterne l'écran prix/QR (20 s) avec
> chaque média promotionnel (sa propre durée), un petit QR restant affiché en permanence pendant les
> médias. Vérifié en Chrome avec une vraie image, un bandeau et un message d'accueil.

> **Mise en service : `docs/GO_LIVE.md`** — checklist ordonnée, avec les commandes exactes. Tout ce qui pouvait se faire par le code est fait (2026-09-21) : déplacement de la borne réelle (`manufacturer/move-link`), amorçage de production (`pnpm db:bootstrap`, `--retire-demo`), envoi d'emails complet mais éteint, détection de borne hors ligne et de retour sans webhook (lecture à la demande, limitée). Ce qui reste est **uniquement** externe : Tony, Stripe, statut juridique, Resend, secrets Vercel, migrations, terrain.

## Bilan de complétude (2026-09-19) — le projet n'est PAS fini pour de vrais clients

Ce qui est solide : le cœur métier, l'admin/partenaire, les comptes, l'affichage, le parcours web, la démo de bout en bout (274 tests, `test:sql`, `test:integration`, build, smoke test navigateur).

Ce qui sépare encore la démo d'un lancement, par ordre de gravité :
1. **Aucun vrai paiement n'est possible** : `core/payment-mode.ts` interdit volontairement Stripe Live (`PaymentMode='mock'|'stripe_test'`). Passer en réel = décision + chantier (clés live, conformité, copy « paiement simulé » à retirer, conditions `demo-2026-09-v1` à remplacer par de vraies CGU).
2. **La boucle physique est ouverte** : éjection réelle verrouillée (attente du fournisseur), retour réel codé mais alimenté par aucun webhook, et, avant correction, une vraie éjection aurait échoué *après* la sortie de la batterie (caution libérée, client servi). Corrigé par « Aligner l'inventaire » (voir `docs/EXTERNAL_BLOCKERS.md`), **mais** la station `paris-demo` de staging, semée avec historique, sera refusée : il faut décider entre fermer ses locations de démo ou créer une station neuve — et il n'existe pas de commande de dissociation d'un `externalId`.
3. **Aucune tâche planifiée n'est configurée** (`vercel.json` n'a pas de `crons`) : ni la synchronisation fournisseur (`internal/manufacturer/sync`, secret `MANUFACTURER_SYNC_SECRET`), ni la capture de caution après 48 h de retard (`internal/rentals/capture-overdue-losses`, secret `OVERDUE_CAPTURE_SECRET`) ne tournent seules. Sans cron, une batterie non rendue n'est jamais facturée et la détection de retour ne se déclenche que par webhook ou synchro manuelle. À câbler côté Vercel (plan Hobby = cron quotidien seulement).
4. **Le modèle local des slots n'est pas la réalité de la borne réelle** : la disponibilité vue par le client vient des slots locaux, pas du snapshot fournisseur.
5. **Paiement par carte sur la borne** non construit (décision produit ouverte).
6. **Pas d'email** (aucun envoi : pas de « mot de passe oublié », pas de reçu par mail) ni de **surveillance d'erreurs** (rien d'autre que `console.error`).
7. **App mobile** jamais lancée sur un appareil ; **Vercel Blob** à activer ; RGPD/mentions légales non traitées.


## Méthode de travail attendue

- **Vérifie par compilation/exécution réelle, jamais par conviction.** Plusieurs vrais bugs de cette session n'ont été trouvés qu'en testant contre la vraie API et le vrai déploiement.
- Commit et push au fur et à mesure sur `main`. Termine les messages de commit par la ligne d'attribution fournie par les instructions système de la session en cours (elle varie selon le modèle — ne la devine pas).
- Respecte le style du repo : `core/` et `server/` sont volontairement en lignes très denses. Ne reformate pas ce que tu ne touches pas. Commentaires rares, uniquement le « pourquoi » non évident.
- L'utilisateur n'est pas familier du vocabulaire infra (Vercel, variables d'environnement, Supabase) — explique en français, une instruction à la fois, en nommant précisément où cliquer. Formule la conséquence concrète avant le mécanisme.
- Avant d'écrire dans la vraie base de production, demande-toi si l'action est réversible. Il n'existe aucune suppression de partenaire ni d'établissement : préfère valider une route neuve avec une requête volontairement rejetée plutôt qu'en créant de la vraie donnée.
