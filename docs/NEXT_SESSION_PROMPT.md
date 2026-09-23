# Brief de reprise — BATYEO (état au 2026-09-23)

> Colle ce brief tel quel au démarrage d'une nouvelle session. Aucun secret ici : mots de passe,
> clés Stripe et identifiants ChargeNow restent dans les notes personnelles de l'utilisateur,
> jamais dans le dépôt. Ce fichier remplace l'historique jour par jour des sessions précédentes :
> l'état actuel seul est gardé, pas le récit. Pour le détail des choix techniques déjà faits, voir
> `docs/AUDIT.md` (incohérences trouvées/corrigées) et `docs/EXTERNAL_BLOCKERS.md` (intégration
> fabricant ChargeNow/Bajie).

## Le projet

BATYEO loue des batteries externes dans des bornes physiques chez des commerçants (bars, hôtels).
Le client scanne un QR, paie par carte sur son téléphone, prend une batterie, la rend sous 48 h
dans n'importe quelle borne BATYEO.

Repo `/Users/anismeslin/Developer/BATYEO` :
- `core/` — domaine métier, très testé (325 tests).
- `server/http.ts` — toutes les routes API, un seul dispatcher par chaîne de caractères.
- `app/` + `components/batyeo/` — site public, portail admin/partenaire, écran de borne
  `/kiosk/[publicId]`, parcours client `/rent/[publicId]`.
- `mobile/` — app cliente Expo/React Native (npm, pas pnpm). **Ne gère pas le paiement par
  carte** (formulaire Stripe non implémenté côté mobile) : en mode Stripe, la location se fait
  depuis la page web, pas l'app.
- `runtime/` — app Android native (Kotlin) pour l'écran physique de la borne. Jamais compilée
  faute de toolchain Java/Android sur la machine de développement (Mac). En attendant, l'écran
  fonctionne dans **n'importe quel navigateur** via `/kiosk/[publicId]` (voir plus bas).

## Déploiement actuel

- Site : `batyeo.vercel.app`. Base Postgres : Supabase projet `mrmbhdachgrzzjtylzwv`
  (`aws-1-eu-west-1.pooler.supabase.com`), gérée par Prisma.
- `PAYMENT_PROVIDER=stripe_test`, `STRIPE_PUBLISHABLE_KEY` configurée : le **paiement par carte
  réel (mode test Stripe) est vérifié de bout en bout**, avec la vraie interface Stripe (carte
  4242, formulaire réel, pas un simulateur).
- Un vrai compte `SUPER_ADMIN` existe (créé par SQL direct faute d'accès réseau aux outils en
  ligne de commande depuis cette machine — voir « Limite d'environnement » plus bas). Les comptes
  `@batyeo.demo` sont désactivés (`disabledAt`).
- Une seule station : `paris-demo`, encore liée à la vraie borne `DTA55480` mais porteuse d'un
  historique de démo — voir point 1 des priorités.
- `MANUFACTURER_ALLOW_PHYSICAL_ACTIONS=false` partout. Aucune commande physique n'a jamais été
  envoyée à une borne réelle.

## Interdits absolus

1. **Ne jamais mettre `MANUFACTURER_ALLOW_PHYSICAL_ACTIONS=true`** sans instruction explicite de
   l'utilisateur — le fournisseur (Tony, ChargeNow) n'a pas confirmé la désactivation de son
   propre flux de location natif ; deux systèmes pourraient distribuer la même batterie.
2. **Ne jamais cliquer sur un bouton d'action physique** dans le panneau admin ChargeNow (Eject,
   Restart…). Lecture seule.
3. **Ne jamais lancer de commande locale (Prisma, psql, scripts `db:*`) sans donner explicitement
   les deux URLs (`DATABASE_URL` et `DIRECT_DATABASE_URL`) et sans confirmer le projet visé**
   (`BATYEO_CONFIRM_DATABASE`). Les scripts `pnpm db:migrate` et `pnpm db:bootstrap` refusent de
   partir sans ça — ne jamais contourner ce refus.
4. **Ne jamais coller un secret (mot de passe, clé) dans le dépôt.** L'utilisateur les colle
   parfois en clair dans le chat par nécessité (pas d'autre moyen de les transmettre) — ne jamais
   les répéter inutilement, et rappeler de les faire tourner une fois le problème réglé.
5. La borne physique est débranchable à la main : « Device not online » (code 2004) est son état
   réel, pas un bug.

## Limite d'environnement importante

**Cette machine (sandbox Claude) ne peut pas joindre Postgres directement**, ni par connexion
directe ni par le pooler Supabase (`P1001: Can't reach database server`), quel que soit le port.
Le Mac de l'utilisateur non plus, la plupart du temps. Seuls fonctionnent : les requêtes HTTP vers
`batyeo.vercel.app` (Vercel joint la base sans problème) et l'éditeur SQL du site de Supabase
(exécuté côté serveur Supabase). **Pour toute opération de base de données, préparer le SQL à
coller dans l'éditeur Supabase plutôt que d'essayer une commande locale** — ça évite plusieurs
allers-retours inutiles.

### Créer un compte à la main (SQL), si nécessaire

Le format de mot de passe de l'app est `pbkdf2-sha256$100000$<salt>$<hash hex 256 bits>`
(PBKDF2-HMAC-SHA256, sel = texte brut en UTF-8, calculable hors-ligne en Python avec
`hashlib.pbkdf2_hmac('sha256', password.encode(), salt.encode(), 100000, dklen=32)` — vérifié
identique à `core/security.ts`). Calculer le hash localement, puis :
```sql
INSERT INTO "User" (id, email, name, "passwordHash", "partnerId", "authVersion", role)
VALUES ('<uuid>', '<email>', '<nom>', '<hash>', NULL, 0, 'SUPER_ADMIN');
```

### Si le site répond 503 avec `PrismaClientKnownRequestError` / `P1000`

= identifiants de base refusés. C'est arrivé plusieurs fois, toujours résolu de la même façon :
1. Supabase → Project Settings → Database → **Reset database password**, copier le nouveau.
2. Vercel → projet → Settings → Environment Variables → `DATABASE_URL` → coller la nouvelle valeur
   complète (`postgresql://postgres.mrmbhdachgrzzjtylzwv:<mdp>@aws-1-eu-west-1.pooler.supabase.com:5432/postgres`),
   vérifier qu'il n'y a **pas de doublon** de variable du même nom, **Production** coché.
3. Deployments → dernier déploiement → **Redeploy**, attendre « Ready ».
4. Revérifier `GET /api/core/health` → `"status":"ok"`.
Le mot de passe finit toujours par être écrit en clair dans le chat à un moment ou un autre : le
faire tourner une dernière fois une fois tout stabilisé, sans redéployer entre-temps par surprise.

## Ce qu'il reste à faire, par priorité

0. **Migration `202609230001_screen_branding_promos` à coller dans l'éditeur SQL de Supabase
   AVANT de pousser le code du 2026-09-23** (commits locaux non poussés tant qu'elle n'est pas
   appliquée) : le code lit `VenuePromo`, `DisplayConfig`, `StationHeartbeat` et les nouvelles
   colonnes `Partner`/`Venue` ; poussé sans elle, toutes les requêtes répondent 503. Rejouable
   sans erreur. Elle répare aussi deux données qui n'étaient jamais enregistrées en Postgres
   (réglages d'affichage des bornes, dernier signal de vie) et ajoute le statut batterie `MISSING`.
1. **Écran de la borne** : l'affiche BATYEO (`/kiosk/[publicId]`) doit être affichée par l'écran
   physique. Soit l'APK `runtime/` (build debug existant du 2026-09-18, jamais installé), soit une
   URL personnalisée dans l'app du fabricant — question pour Tony. L'app native garde aussi son
   propre carrousel de médias, redondant avec celui de la page : à neutraliser à l'installation.
2. **Tony (fournisseur)** : désactiver le flux de location natif ChargeNow (condition avant
   `MANUFACTURER_ALLOW_PHYSICAL_ACTIONS`), confirmer l'inscription au webhook
   `cabinet/eventPush/config`, et **le TPE intégré à la borne est celui du fournisseur** : le code
   Stripe Terminal (`runtime/.../TerminalManager.kt`) ne peut pas le piloter. Demander son modèle et
   son protocole, ou s'il peut router le paiement. En attendant, paiement par téléphone uniquement.
3. **Secrets Vercel** : `CRON_SECRET`, `STRIPE_WEBHOOK_SECRET`, `RESEND_API_KEY` + `MAIL_FROM`, et
   **activer Vercel Blob** (sinon l'envoi de logos/photos d'habillage et de promos échoue).
4. **Statut légal** : SIRET, IBAN, assurance, TVA (absente partout : mention « TVA non
   applicable, art. 293 B du CGI » ou TVA affichée, selon le statut), relecture juridique.
5. **Sécurité restante** : double authentification des comptes admin, « mot de passe oublié »,
   alertes automatiques en cas de panne (Sentry ou équivalent), vérifier les sauvegardes Supabase.
6. **Passage en argent réel** après tout le reste et un test complet sur la vraie borne.

## Fait le 2026-09-23

- Écran de borne : affiche animée (batterie qui se charge, prix et stock en direct, QR), français
  par défaut et choix de langue au toucher (FR, EN, ES, IT, DE, PT, 中文), retour au français après
  60 s. Promos des établissements intercalées, programmées par jour et créneau à l'heure de Paris.
- Admin → Affichage : « Habillage des écrans » (logo, photo, style, langues, accroches, aperçu
  exact) et « Promos des établissements ». Un établissement ne modifie plus rien sur son écran
  (permission `screen` = SUPER_ADMIN/ADMIN) ; il peut seulement **demander** une promo (ticket).
- Fiche légale partenaire (raison sociale, SIRET, adresse, contact, IBAN, contrat) : BATYEO seul
  la modifie, IBAN masqué aux rôles sans accès finance. Téléphone de l'établissement.
- **Stock toujours aligné sur la borne** : après chaque lecture réussie, `mirrorCabinetInventory`
  recopie le contenu réel (batteries placées, créées, `MISSING` si sorties sans location, remises en
  service si elles reviennent). « Aligner l'inventaire » utilise la même fonction : l'ancienne
  version supprimait des lignes et échouait toujours en Postgres. L'éjecteur ne choisit plus
  qu'une batterie déjà enregistrée disponible dans la station. Délai de mise à jour : 2 min au plus
  tant qu'un écran ou un client consulte le site (instantané une fois le webhook fabricant actif).
- En-têtes anti-clickjacking (`vercel.json`).

## Ce qui est solide (ne pas re-questionner sans raison)

Paiement par carte de bout en bout (vérifié avec le vrai Stripe), détection de retour et de borne
hors ligne sans webhook (lecture à la demande + tâche planifiée), remboursement et contestations
bancaires, relevé de commissions par partenaire exportable en CSV, gestion de compte en libre-
service, écran de borne utilisable dans un navigateur (médias, message d'accueil, bandeau de
maintenance), 325 tests + `test:sql` + `test:integration` + build tous verts au dernier commit.

## Méthode de travail attendue

- Vérifier par exécution réelle (tests, build, navigateur), jamais par conviction.
- Commit et push au fur et à mesure sur `main`, avec la ligne d'attribution donnée par les
  instructions système de la session en cours (elle varie selon le modèle — ne pas la deviner).
- Style du dépôt : `core/` et `server/` en lignes denses, ne pas reformater ce qu'on ne touche
  pas. Commentaires rares, seulement le « pourquoi » non évident.
- L'utilisateur n'est pas familier du vocabulaire infra — expliquer en français, une instruction
  à la fois, en nommant précisément où cliquer, la conséquence avant le mécanisme.
- Avant toute écriture en production, se demander si l'action est réversible ; préférer un test
  volontairement rejeté à la création de vraies données quand un doute existe.
