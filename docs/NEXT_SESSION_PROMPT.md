# Brief de reprise — BATYEO (état au 2026-09-22)

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

1. **Déplacer la borne réelle** (`DTA55480`) de `paris-demo` (historique de démo) vers une
   station neuve, avant le premier vrai client. Outil prêt : bouton « Rattacher ici » dans la
   fiche station (admin), ou route `manufacturer/move-link`. Puis **« Aligner l'inventaire »**
   pour que les batteries locales reflètent la vraie borne (refusé tant qu'il y a de
   l'historique ou des locations en cours).
2. **Tony (fournisseur)** doit répondre à deux questions : désactiver le flux de location natif
   ChargeNow (sinon deux systèmes peuvent distribuer la même batterie — condition avant
   d'activer `MANUFACTURER_ALLOW_PHYSICAL_ACTIONS`), et confirmer le format d'inscription au
   webhook `cabinet/eventPush/config` (BATTERY_IN/BATTERY_BORROW_OUT). Sans webhook, la
   détection de retour et de borne hors ligne fonctionne quand même mais avec un délai (lecture
   à la demande à chaque visite du site, au plus une fois toutes les 2 min ; tâche planifiée à
   3 h du matin en secours).
3. **Secrets Vercel à vérifier/compléter** : `CRON_SECRET` (tâche planifiée quotidienne
   `internal/cron` : synchronisation fournisseur + capture des cautions en retard — déjà
   déclarée dans `vercel.json`), `STRIPE_WEBHOOK_SECRET` (webhook Stripe avec
   `charge.dispute.created` et `charge.refunded` en plus des événements de paiement standards),
   `RESEND_API_KEY` + `MAIL_FROM` (aucun email n'est envoyé sans ça — le code est prêt : reçu,
   avertissement 24 h avant capture de caution, avis de perte, résumé quotidien).
4. **Statut légal** : SIRET, IBAN, assurance responsabilité (batteries lithium en lieu public).
   Les pages `/terms` et `/privacy` décrivent déjà le vrai service mais il manque l'identité de
   l'exploitant et une relecture juridique avant tout encaissement réel.
5. **Passage en argent réel** : mettre `PAYMENT_PROVIDER=stripe_live` avec une clé `sk_live_…`
   et `STRIPE_PUBLISHABLE_KEY=pk_live_…` (le serveur refuse tout mélange test/live au démarrage).
   Ne faire qu'après les points 1-4, et après un nouveau test complet en conditions réelles.
6. **Mineur, non bloquant** : activer Vercel Blob (Storage) pour le bon fonctionnement du
   téléversement de médias ; l'app mobile n'a jamais tourné sur un vrai appareil ; le texte
   « fonctionnement » (4 étapes) de l'écran de borne est encore fixe en français, pas éditable
   depuis l'admin.

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
