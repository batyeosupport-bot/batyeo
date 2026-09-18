# Brief de reprise — état au 2026-09-18 (fin de journée)

> Colle ce brief tel quel au démarrage d'une nouvelle session Claude Code.
> Rédigé à la fin d'une session longue qui a fait passer le blocage externe
> ChargeNow de « aucun contact » à « API réelle confirmée et branchée ».

---

## Le projet

BATYEO loue des batteries externes dans des bornes physiques installées chez des commerçants (bars, hôtels). Le client scanne un QR ou paie par carte sur la borne, prend une batterie, la rend sous 48 h.

Repo à `/Users/anismeslin/Developer/BATYEO` (monorepo) :
- **`core/`** — domaine métier, très testé (211 tests, tous passants).
- **`server/http.ts`** — toutes les routes API.
- **`app/` + `components/batyeo/`** — site public Next.js, portail admin/partenaire, page kiosque `/kiosk/[publicId]`.
- **`mobile/`** — app **cliente** Expo/React Native (npm, pas pnpm) — à ne pas confondre avec `runtime/`.
- **`runtime/`** — app kiosque Android native en Kotlin qui tourne **sur la borne physique**.

## Où en est le projet

- Backend/Web/Runtime kiosque : `READY`, vérifiés à l'exécution (voir sessions précédentes).
- Mobile client Android : build vérifié (APK généré), **jamais lancé sur un vrai émulateur/device** — toujours aucun émulateur configuré sur cette machine.
- 211 tests, `tsc`, ESLint, `next build --webpack` : tous verts au dernier commit.

## Le vrai changement de cette session : le fournisseur a répondu

Le compte marchand ChargeNow (260901043602, borne réelle `DTA55480`) a été exploré avec l'autorisation explicite de l'utilisateur (panneau admin `admin.chargenow.top/web-new/`, captcha résolu manuellement à chaque connexion). **Jamais cliqué sur aucun bouton d'action physique** (Eject, Restart, Firmware update, etc.) — uniquement lecture, capture d'écran, et inspection du JS chargé.

Contact établi avec le fournisseur (« Tony », via l'utilisateur). Échanges et résultats :

1. **Credentials Open API obtenus et fonctionnels** (Basic auth confirmé). Testés en vrai contre `cabinet/query` sur `DTA55480` avec le code réel de `core/manufacturer.ts`.
2. **Bug trouvé et corrigé** : `shop.address` est absent du payload réel (pas une chaîne vide) quand non renseigné — schéma Zod corrigé, fixture de régression ajoutée.
3. **Commande d'éjection confirmée officiellement** : `POST /cabinet/operation` (`cabinetid`, `slotNum`, `operationType` parmi `restart,pop,popall,popallForNoAuth,popallForAuth,heartbeat,lock,unlock,lockStopCharge,report`, `reason`), doc Apifox officielle. Implémentée dans `ManufacturerHttpClient.operateDevice()`, testée contre le contrat exact. **Jamais appelée contre la vraie borne**, même pas les opérations les moins risquées (`heartbeat`/`report`) — `MANUFACTURER_ALLOW_PHYSICAL_ACTIONS` reste `false`.
4. **Deux autres endpoints d'éjection recensés** : `ejectByRepair` (indépendant, comme `cabinet/operation`) et `ejectByRent` (nécessite un `rentOrderId`, donc dépend de leur système `Create Rent Order`). Confirme que rester sur `cabinet/operation` est le bon choix pour que BATYEO reste seule source de vérité.
5. **Mécanisme de webhook officiel repéré** (`cabinet/eventPush/config`), avec un événement `BATTERY_BORROW_OUT` — potentiellement bien mieux que le sondage actuel. **Le format exact du contenu poussé n'a pas pu être récupéré** : le site de doc (`s.apifox.cn`) est devenu inaccessible en cours de vérification (timeout y compris en `curl` brut — probablement une limitation de débit après plusieurs requêtes automatisées). À reprendre en premier si tu as du temps libre : re-tenter l'accès à `https://s.apifox.cn/4855b8fe-4c43-48f6-8bd6-37cc29b98fe5/` et chercher l'entrée feuille « Cabinet Event Push » (POST) sous le groupe du même nom — attention à l'ambiguïté déjà rencontrée entre le dossier et l'entrée elle-même dans le menu latéral.
6. **Question toujours sans réponse claire** : comment désactiver le flux de location natif du fabricant (prix/caution/QR propres à ChargeNow, vus sur la fiche Venue de l'admin) pour ce compte. Tony a dit « You can modify the QR code redirection to your link » — mais une recherche complète dans le panneau admin (fiche borne, fiche Venue + formulaire d'édition complet, Marketing & Promotions > Configuration) n'a trouvé **aucun champ self-service** pour ça. Probablement qu'il faut juste lui envoyer le lien et qu'il s'en occupe lui-même, comme il l'avait dit la première fois.

Tout ça est documenté en détail dans `docs/EXTERNAL_BLOCKERS.md`, section par section, avec les dates.

## Ce qui a aussi été construit ce jour (indépendant du fournisseur)

- **Bug corrigé** : `Station.stripeTerminalLocationId`/`stripeTerminalLocationUpdatedAt` n'étaient jamais persistés en Postgres (absents du schéma Prisma et de toute migration) — un vrai write aurait planté. Migration ajoutée, vérifiée par écriture/lecture réelle contre Postgres local.
- **Mode maintenance station** (`Station.rentalsBlocked`) : interrupteur de blocage des locations côté serveur BATYEO, indépendant du `No Lease` fabricant. Routes `station/block-rentals`/`unblock-rentals`.
- **Détection de location « étrangère »** (`UNEXPLAINED_SLOT_CHANGE`) : distingue une batterie disparue du snapshot fournisseur mais expliquée par une location BATYEO récente, d'une batterie disparue sans aucune explication locale.
- **`core/ejection-log.ts`** : `EjectionLogReader` (contrat seul) + `suggestEjectionMatches`, prêt à brancher le jour où le format du Pop-up Log/webhook est confirmé.

## Déploiement Vercel — en cours, pas terminé

L'utilisateur a créé `vercel.com/batyeo` et connecté le repo GitHub. **Pas encore configuré côté build** : le script `build` par défaut du repo (`node scripts/run-framework.mjs build`) est pensé pour Cloudflare/wrangler, pas pour Vercel. Il faut overrider **Build Command** à `next build --webpack` dans les réglages du projet Vercel (Settings → Build & Development Settings) — c'est le chemin Postgres déjà vérifié toute cette session, contrairement au chemin Cloudflare/D1 par défaut, jamais testé.

**Décision en attente côté utilisateur avant d'aller plus loin** : quelle base de données utiliser pour ce déploiement —
- le Supabase de **production** déjà configuré dans `.env` (jamais utilisé pour de vrais clients jusqu'ici), ou
- un nouveau projet Supabase **de staging**, séparé, plus prudent.

Pas de nom de domaine acheté — pas la peine dans l'immédiat, Vercel donne une URL gratuite (`*.vercel.app`) suffisante pour un premier test avec le fournisseur.

## Interdits absolus (inchangés)

- **`MANUFACTURER_ALLOW_PHYSICAL_ACTIONS` doit rester `false`.** Ne l'implémente pas autrement sans instruction explicite et réfléchie.
- **Ne jamais cliquer sur un bouton d'action physique** dans le panneau admin ChargeNow (Eject, Restart, Firmware update, Enable/Disable POS, No Lease, etc.), même en exploration autorisée. Lecture et capture d'écran seulement.
- **Ne lance jamais le serveur de dev directement contre `.env`** : il pointe sur l'instance Supabase de **production**. `.env.local` a un `DATABASE_URL` local pour isoler le web ; toute commande Prisma en CLI doit exporter explicitement `DATABASE_URL`/`DIRECT_DATABASE_URL` locaux avant de s'exécuter.
- **Ne commit aucun secret**, y compris les identifiants du panneau admin ChargeNow ou de l'Open API — jamais dans un fichier, jamais dans un message de commit.
- N'ajoute pas de dépendance lourde sans raison.

## Ce qui reste ouvert

1. Format exact du contenu du webhook `Cabinet Event Push` — à récupérer (site à retenter).
2. Réponse du fournisseur sur la désactivation de son flux natif — en attente.
3. Configuration du build Vercel (`next build --webpack`) + décision base de données + variables d'environnement.
4. Conception de la sélection de slot/batterie à cibler avant d'implémenter réellement `AsyncBatteryEjector` (pas juste le contrat bas niveau `operateDevice`).
5. Lancement réel de l'app mobile client sur un vrai Android — toujours jamais fait.

## Méthode de travail attendue (inchangée)

- **Vérifie par compilation/exécution réelle, jamais par conviction.**
- **Commit et push au fur et à mesure** sur `main`.
- Termine les messages de commit par la ligne d'attribution fournie par les instructions système de la session en cours (elle varie selon le modèle — ne la devine pas).
- **Respecte le style du repo** : `core/` et `server/` sont volontairement en lignes très denses. Ne reformate pas ce que tu ne touches pas.
- **Commentaires rares**, uniquement le *pourquoi* non évident.
- **Sois honnête sur le non-testé.** Rien n'a jamais tourné sur la borne physique ni sur un Android réel. Écris « vérifié à la compilation », « vérifié à l'exécution » ou « confirmé contre l'API réelle » selon la vérité exacte.
