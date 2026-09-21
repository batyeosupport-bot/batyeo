# Mise en service — checklist dans l'ordre

> **Paiement par carte — construit le 2026-09-21.** Le client saisit sa carte **sur son téléphone**
> après avoir scanné le QR (formulaire Stripe : carte, Apple Pay, Google Pay). BATYEO ne voit jamais
> le numéro de carte. La location ne démarre, et la batterie ne sort, **qu'après** que le serveur a
> relu chez Stripe que la caution est réellement bloquée (`requires_capture`, montant exact). Un
> client qui n'a pas confirmé sa carte au bout de 15 minutes voit sa demande expirer, son blocage
> annulé chez Stripe, et peut recommencer ailleurs. Le lecteur de carte de la borne n'est plus
> nécessaire. En mode `stripe_test`, on paie avec la carte **4242 4242 4242 4242** (date future,
> code au choix) : c'est une vraie répétition, avec le vrai formulaire.
> Nouveau réglage obligatoire : `STRIPE_PUBLISHABLE_KEY` (voir la section 4).
> **L'application mobile n'a pas été adaptée** : elle ne sait pas afficher le formulaire de carte.
> Elle fonctionne en mode simulé (`mock`) uniquement ; en mode Stripe, la location doit se faire
> depuis la page web.

Tout ce qui peut être fait par le code l'est. Ce document liste ce qu'il reste à faire, dans l'ordre
où le faire est sûr. Chaque étape dit ce qu'elle débloque. Ne saute pas d'étape : les dernières
font sortir de vraies batteries et prendre de l'argent réel.

**Piège à connaître : migrations avant déploiement.** Vercel déploie le code dès qu'il est poussé,
mais **ne migre jamais la base**. Si le code attend une colonne que la base n'a pas encore, *toute*
l'API répond « service temporairement indisponible » (503). À chaque fois que le dossier
`prisma/migrations/` s'agrandit : appliquer `pnpm db:migrate` sur la base concernée **avant** (ou
tout de suite après) le déploiement. Diagnostic : Vercel → Deployments → Logs → chercher la ligne
JSON `request_failed`, qui nomme la route et l'erreur.

Règle générale : les commandes qui touchent une base de données exigent que tu écrives toi-même
l'hôte de la base visée (`BATYEO_CONFIRM_DATABASE`). C'est volontaire : une mauvaise variable dans
ton terminal est la façon la plus simple d'abîmer la production.

---

## 0. Avant tout : les décisions qui ne sont pas du code

- [ ] **Statut de l'exploitant** : SIRET, IBAN pour recevoir l'argent.
- [ ] **Assurance** responsabilité civile qui couvre des batteries lithium dans un lieu public.
- [ ] **Conditions et confidentialité** relues par un juriste. Les pages `/terms` et `/privacy`
      décrivent le service réel, mais il y manque ton identité, ton adresse, le médiateur de la
      consommation et le droit de rétractation.
- [ ] **Convention écrite avec le bar** : emplacement, prise et réseau, commission, responsabilité en
      cas de vol ou d'incendie, durée, conditions de reprise de la borne.
- [ ] **Coût réel de la borne et de la batterie de remplacement** (demande à Tony) : c'est ce qui
      décide si 20 € de caution couvrent une perte.

## 1. Tony (fournisseur)

- [ ] Il **désactive le système de location de ChargeNow** sur ton compte. Tant qu'il tourne, leur
      QR code et le tien peuvent promettre la même batterie.
      *Test possible sans lui, et réversible* : arrête leur application de force (ne la supprime
      pas), puis lance `pnpm manufacturer:check`. Si la borne répond « Device not online », leur
      application porte la connexion : relance-la et n'y touche plus.
- [ ] Il te confirme le **format exact** de l'inscription au webhook (`cabinet/eventPush/config`) :
      paramètres d'URL ou corps JSON ? Une signature est-elle envoyée ? Je n'ai pas deviné ce
      format : le client fournisseur de BATYEO ne sait envoyer que des paramètres d'URL.
- [ ] Une fois inscrit, l'adresse à lui donner est
      `https://TON-DOMAINE/api/core/manufacturer/webhook`, pour les événements `BATTERY_IN`,
      `BATTERY_BORROW_OUT`, `CABINET_OFFLINE` et `CABINET_ONLINE`.

*Sans le webhook, ça marche quand même* : consulter le site déclenche une lecture de la borne (au
plus une par 2 minutes pour tout le service), ouvrir une location en cours en déclenche une (au
plus une par 30 secondes), et la tâche de 3 h du matin rattrape le reste. Une borne débranchée est
donc vue hors ligne à la prochaine visite du site, et un retour est clôturé dès que le client
regarde sa location. Le webhook rend simplement la détection immédiate même quand personne ne
regarde.

## 2. Stripe

- [ ] Compte Stripe **activé** pour l'entreprise (vérification d'identité, IBAN).
- [ ] Créer un **point d'accès webhook** dans Stripe (Développeurs → Webhooks) vers
      `https://TON-DOMAINE/api/core/stripe/webhook`, avec ces événements :
      `payment_intent.amount_capturable_updated`, `payment_intent.requires_capture`,
      `payment_intent.succeeded`, `charge.succeeded`, `payment_intent.canceled`,
      `payment_intent.payment_failed`, **`charge.dispute.created`** et **`charge.refunded`**.
      Les deux derniers sont indispensables : sans eux, une contestation bancaire ou un
      remboursement fait depuis Stripe ne remonte pas dans BATYEO.
- [ ] Noter la clé de signature (`whsec_…`), la clé secrète **réelle** (`sk_live_…`) et la clé
      **publique** (`pk_live_…`, Développeurs → Clés API).

## 3. Base de données de production

À faire depuis ton terminal, dans le dossier du projet, avec l'adresse de la base **de production**
(pas celle de staging).

1. Appliquer les migrations (elles n'effacent rien) :
   `DATABASE_URL="…" pnpm db:migrate`
2. Créer ton vrai compte administrateur :
   `BATYEO_CONFIRM_DATABASE=<hôte de la base> DATABASE_URL="…" BATYEO_ADMIN_EMAIL=toi@… BATYEO_ADMIN_NAME="Ton nom" pnpm db:bootstrap`
   Le mot de passe temporaire s'affiche **une seule fois** : note-le, puis change-le dans
   Paramètres à ta première connexion.
3. Si la base contient la démo : verrouiller les comptes `@batyeo.demo` :
   `… pnpm db:bootstrap -- --retire-demo`
   (refusé tant qu'il n'existe pas un vrai administrateur actif, pour ne pas te bloquer dehors).

## 4. Variables sur Vercel

Projet → Settings → Environment Variables → environnement **Production**.

| Variable | Valeur | Rôle |
|---|---|---|
| `DATABASE_URL` | base de production | — |
| `PAYMENT_PROVIDER` | `stripe_live` | prend de vrais paiements |
| `STRIPE_SECRET_KEY` | `sk_live_…` | doit correspondre au mode, sinon refus au démarrage |
| `STRIPE_PUBLISHABLE_KEY` | `pk_live_…` (ou `pk_test_…` en test) | **obligatoire** : sert à afficher le formulaire de carte. Doit être du même environnement que la clé secrète, sinon le serveur refuse de démarrer |
| `STRIPE_WEBHOOK_SECRET` | `whsec_…` | vérifie que Stripe est bien l'expéditeur |
| `CRON_SECRET` | une longue chaîne aléatoire | protège la tâche de 3 h du matin |
| `MANUFACTURER_PROVIDER` | `bajie` | — |
| `MANUFACTURER_API_BASE_URL`, `MANUFACTURER_USERNAME`, `MANUFACTURER_PASSWORD` | identifiants ChargeNow | lecture de la borne |
| `MANUFACTURER_SYNC_SECRET` | une longue chaîne aléatoire | exigé dès que ChargeNow est configuré |
| `RESEND_API_KEY`, `MAIL_FROM` | clé et adresse d'envoi vérifiées chez Resend | envoi des reçus (**les deux ou aucun**) |
| `OPS_ALERT_EMAIL` | ton adresse | résumé quotidien des alertes |
| `MANUFACTURER_ALLOW_PHYSICAL_ACTIONS` | `true` — **en tout dernier** | fait sortir de vraies batteries |

Sans `RESEND_API_KEY`/`MAIL_FROM`, tout fonctionne mais aucun email ne part, et la page de location
ne demande pas d'adresse (elle ne promet pas ce qu'elle ne peut pas tenir).

Après chaque changement de variable : **Redeploy** (les variables ne s'appliquent qu'au déploiement
suivant). Puis ouvre **Admin → Système** : les quatre cartes doivent afficher ce que tu attends
(paiements réels, fournisseur connecté, sortie physique selon ce que tu as fixé).

Optionnel : **Vercel → Storage → Blob** pour envoyer des images ou vidéos sur l'écran de la borne.

## 5. La borne réelle dans BATYEO

Dans l'admin, dans cet ordre :

1. **Stations → Nouvelle station** pour la vraie borne (identifiant public par exemple `bar-nom`).
2. Sur cette station : bouton **Fabricant** → saisir l'identifiant de la borne (`DTA55480`) →
   **Rattacher ici**. Si la borne était liée à la station de démo, elle est déplacée (refusé tant
   qu'une location est en cours sur l'une des deux).
3. **Synchroniser**, puis **Aligner l'inventaire** : BATYEO recopie les batteries réelles de la
   borne. Refusé si la station porte un historique de démonstration : c'est pour cela qu'il faut
   une station neuve.
4. Vérifier dans **Système** que la synchronisation est « À jour ».

## 5 bis. L'écran de la borne

L'écran affiché sur la borne est une **application Android à installer** (`runtime/`, package
`com.batyeo.runtime`). Elle affiche la page `/kiosk/<identifiant public>` : nom du lieu, état,
nombre de batteries, **le QR code pour louer**, et un carrousel d'images ou vidéos après 60 s
d'inactivité. Le client loue **depuis son téléphone** en scannant le QR ; l'écran n'est pas une
caisse tactile.

1. **Construire l'APK** (à faire sur une machine avec JDK 17 et l'Android SDK, par exemple Android
   Studio) : `cd runtime && ./gradlew assembleRelease`. L'APK de test du 18 septembre existe
   (`runtime/app/build/outputs/apk/debug/app-debug.apk`) mais il a été construit **avant** la
   correction de l'adresse par défaut et de l'appairage en un geste : avec lui, saisis l'adresse
   d'affichage à la main (étape 4).
2. **L'installer sur la borne.** Cela dépend de l'Android de la borne (à vérifier : version 8.0
   minimum, installation d'applications tierces autorisée, câble USB ou accès réseau pour `adb`).
   Avec `adb` : `adb install -r app-debug.apk`. Sinon, clé USB puis gestionnaire de fichiers.
3. **Générer le code d'appairage** : Admin → Affichage → ligne de la station → **Appairer**. Le code
   est à usage unique et expire vite.
4. **Sur la borne** : appuyer **5 secondes** sur l'écran → « Configuration de la borne » → coller le
   code → **Appairer cette borne**. Avec la nouvelle version, l'écran à afficher se règle tout seul
   (`https://TON-DOMAINE/kiosk/<identifiant public>`) ; avec l'ancienne, renseigne « URL
   d'affichage » à la main puis **Enregistrer**.
5. **En faire l'écran par défaut** : appuie sur Accueil et choisis « BATYEO Runtime » → « Toujours ».
   L'application démarre ensuite toute seule au redémarrage de la borne.
6. **Vérifier** dans Admin → Affichage : la borne doit apparaître « répond » avec un signal récent.

À savoir :
- **Ne supprime pas l'application de ChargeNow** : c'est très probablement elle qui garde la borne
  connectée au cloud dont BATYEO dépend. La tienne s'affiche par-dessus.
- L'affichage verrouillé (impossible de sortir de l'application) ne fonctionne que si l'application
  est configurée comme « propriétaire de l'appareil » (`adb shell dpm set-device-owner …`, possible
  seulement sur une borne sans compte Google). Sans cela, elle tourne quand même, sans verrou.
- Les images du carrousel se gèrent dans Admin → Affichage → Médias (le téléversement de fichiers
  demande d'activer Vercel Blob).

## 6. Le test qui décide de tout — avant d'ouvrir au public

Avec **ta propre carte**, sur la vraie borne :

- [ ] Scanner le QR, louer, **saisir ta carte** dans le formulaire, prendre la batterie : elle sort
      physiquement seulement après validation de la carte.
- [ ] Ferme la page **avant** de valider la carte : la location expire au bout de 15 minutes et le
      blocage sur ta carte disparaît (vérifie dans Stripe que le paiement est « annulé »).
- [ ] La rendre : la location se clôt, l'empreinte est libérée, seul le prix est encaissé.
- [ ] Ouvrir la location dans l'admin : montants cohérents, contact client visible.
- [ ] Si la borne n'a pas détecté le retour : Admin → Locations → la location → **Clôturer : batterie
      rendue** (choisir la borne, saisir un motif). Le prix est calculé jusqu'à maintenant et la
      caution est libérée.
- [ ] Te **rembourser** depuis le détail de la location, puis vérifier dans Stripe.
- [ ] Débrancher la borne, puis recharger la page des stations : elle passe **hors ligne** et n'est
      plus proposée (dans les 2 minutes qui suivent, sans webhook).
- [ ] Louer et ne **pas** rendre : la location passe « en retard » 48 h après le départ, et
      l'avertissement part à la première tâche de 3 h du matin qui suit (si Resend est branché) ; la
      caution n'est prise qu'au moins 24 h après cet avertissement. C'est le seul test qui prend
      plusieurs jours : ne l'omets pas avant de passer en réel.

Ne fais ce test qu'avec `PAYMENT_PROVIDER=stripe_test` et `MANUFACTURER_ALLOW_PHYSICAL_ACTIONS=true`
d'abord : de vraies batteries, de l'argent de test. Passe en `stripe_live` seulement après.

## 7. Sur place

- [ ] **Autocollant avec ton QR** (l'adresse est `https://TON-DOMAINE/rent/<identifiant public>`),
      qui **recouvre** celui de ChargeNow.
- [ ] Prix (2 €/h, plafond 8 €) et caution (20 €) lisibles, avec un moyen de te contacter.
- [ ] Prise et réseau du bar vérifiés. Si le bar débranche la borne la nuit, elle sera signalée
      hors ligne : c'est le comportement voulu.

## 8. Chaque jour, les premières semaines

- Ouvrir **Admin → Vue d'ensemble** : alertes ouvertes, demandes d'assistance.
- Lire le résumé quotidien par email (si `OPS_ALERT_EMAIL` est défini).
- Une contestation bancaire lève une alerte **critique** : elle ne se refuse pas, elle se traite
  côté Stripe dans le délai imparti.
