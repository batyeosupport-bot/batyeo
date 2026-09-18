# Intégration Bajie / ChargeNow — points externes à confirmer

État : adapter **READ-ONLY** implémenté sur la documentation publique consultée le 12 septembre 2026, **confirmé en conditions réelles le 18 septembre 2026** contre la borne `DTA55480` avec des credentials marchand valides.

## Confirmé le 2026-09-18 contre l'Open API réelle

- **Authentification HTTP Basic fonctionne** en production avec les credentials marchand fournis par le fabricant (`username`/`password`). L'ambiguïté Basic vs OAuth2/Bearer citée plus bas est donc résolue côté `cabinet/query` et `cabinet/list` : c'est Basic.
- **`GET /rent/cabinet/query?deviceId=DTA55480`** répond avec des données réelles (`code:0`), parsées avec succès par `core/manufacturer.ts` **après un correctif** : `shop.address` est absent du payload réel quand non renseigné (pas une chaîne vide, contrairement à `city`/`openingTime`/`icon` dans le même objet) — le schéma Zod l'accepte désormais en optionnel. Fixture de régression capturée dans `tests/manufacturer.test.ts`.
- **`POST /rent/cabinet/list`** répond aussi `code:0` (liste vide pour les coordonnées de test utilisées — pas une erreur, juste aucun résultat pour cette recherche géographique).
- Juste après l'activation du compte par le fabricant, un premier appel a renvoyé `{"msg":"The record already exists in the database.","code":800}` sur **tous** les appels (query et list, quels que soient les paramètres) — a priori un délai de propagation côté leur provisioning. Un nouvel essai quelques minutes plus tard a fonctionné. À garder en tête si ça se reproduit : ce n'est pas un problème de paramètres de notre côté.
- **Commande d'éjection confirmée sur l'Open API publique** (voir section dédiée plus bas) — plus une inconnue technique.

Sources officielles :

- https://s.apifox.cn/4855b8fe-4c43-48f6-8bd6-37cc29b98fe5
- https://developer.chargenow.top/cdb-open-api/v1

## Contrats utilisés

- `GET /rent/cabinet/query?deviceId=...` : détail cabinet, boutique, batteries et slots.
- `POST /rent/cabinet/list?coordType=...&zoomLevel=...&lat=...&lng=...&showPrice=...` : liste géographique documentée.
- Les pages de ces deux routes documentent une authentification HTTP Basic.

## Ambiguïtés documentaires

- La page OAuth2 documente `POST /oauth2/login`, mot de passe préalablement haché en SHA-256, puis un header `Authorization: Bearer ...` pour l’Open API. Les pages cabinet et leurs exemples utilisent cependant HTTP Basic. L’adapter suit les exemples propres aux routes cabinet ; le fabricant doit confirmer le mode d’authentification production.
- La réponse OAuth2 publiée ne décrit pas précisément le champ contenant le token. Aucun parser OAuth2 n’est donc inventé.
- La liste cabinet ne publie pas d’identifiant cabinet dans son exemple ; elle est exposée comme liste de lieux/résumés, pas comme source d’association automatique avec une station BATYEO.
- Aucun champ `lastSeen` n’est publié dans le détail cabinet. BATYEO retourne donc `lastSeenAt: null` et conserve séparément la date de synchronisation locale.
- `vol` est conservé comme tension fournisseur (`voltage`) et n’est pas converti en pourcentage de charge sans règle officielle.
- `busySlots`, `emptySlots`, `freeNum` et `infoStatus` sont conservés sans interprétation métier supplémentaire au-delà de leur nom documenté.
- Mise à jour 2026-09-18 : un mécanisme de webhook **officiel et documenté** existe en fait (voir section dédiée plus bas), jamais repéré avant cette session. Tant que sa forme exacte (signature, identifiant d'événement, idempotence) n'est pas entièrement vérifiée, la prudence ci-dessus reste de mise : le récepteur BATYEO continue de traiter ces événements comme non fiables, de les dédupliquer par empreinte interne du payload et de ne jamais les utiliser directement pour modifier l'état métier — une lecture API documentée reste le déclencheur de réconciliation.

## Synchronisation BATYEO

- Les associations sont stockées par couple `manufacturer + externalId` avec unicité en base, afin de pouvoir accueillir plusieurs fabricants sans confondre leurs identifiants.
- Le dernier snapshot est normalisé et interne. Le JSON fournisseur brut n’est pas exposé aux clients.
- Une synchronisation met à jour uniquement la télémétrie provider et les divergences. Elle ne remplace pas automatiquement l’état métier, les slots ou les batteries BATYEO.
- Les retries bornés concernent uniquement les lectures ayant échoué par timeout ou indisponibilité temporaire. Aucune commande physique n’est implémentée.
- `pnpm manufacturer:check` est prêt pour un environnement staging : il exécute uniquement `cabinet/query` puis `cabinet/list`, affiche des métriques anonymisées et peut capturer des fixtures dépersonnalisées avec `MANUFACTURER_CAPTURE_FIXTURE=true` et `MANUFACTURER_FIXTURE_PATH=/chemin/fixtures`.
- Le scheduler appelle `POST /api/core/internal/manufacturer/sync` avec `Authorization: Bearer $MANUFACTURER_SYNC_SECRET`. Le verrou est enregistré dans `ManufacturerSyncRun` et expire après dix minutes pour permettre la récupération d’un worker interrompu.

## Commande d'éjection — confirmée le 2026-09-18 sur l'Open API publique

D'abord repérée en inspectant le panneau admin marchand (`admin.chargenow.top/web-new/`), qui appelle en interne `GET /cdb-web-api/v1/cdb/cabinet/operation?cId=...&operationType=pop&kakou=...` pour éjecter une batterie. Cette API interne (session humaine + captcha) est distincte de l'Open API publique — la question posée au fabricant était de savoir si un équivalent existait côté Open API.

**Réponse du fabricant (Tony, 2026-09-18)** : confirmé via la documentation officielle Apifox (https://s.apifox.cn/4855b8fe-4c43-48f6-8bd6-37cc29b98fe5/api-104222009), endpoint **« Device Operation »** :

```
POST https://developer.chargenow.top/cdb-open-api/v1/cabinet/operation
Authorization: Basic <username:password>
Query params : cabinetid (requis), slotNum (requis), operationType (requis), reason,
               batcabFault, batteryFault, type, gpsTime (optionnels)
```

`operationType` documenté : `restart, pop, popall, popallForNoAuth, popallForAuth, heartbeat, lock, unlock, lockStopCharge, report` — quasi identique à ce qui avait été repéré dans le panneau admin (differences : `lockStopCharge` documenté ici mais pas vu côté panneau ; `trunoff` vu côté panneau mais absent de cette doc). Implémenté dans `ManufacturerHttpClient.operateDevice()` (`core/manufacturer.ts`), testé contre ce contrat exact (`tests/manufacturer.test.ts`). **Jamais appelé depuis `server/` ou `core/stripe-coordinator.ts`** — `MANUFACTURER_ALLOW_PHYSICAL_ACTIONS` reste `false`, et aucune commande n'a été envoyée à la borne réelle pendant cette session, y compris les moins risquées (`heartbeat`, `report`).

Le fabricant documente aussi deux autres endpoints d'éjection, vérifiés le 2026-09-18 :
- `POST /cabinet/ejectByRepair` (`cabinetid`, `slotNum` — 0 ou null pour tout éjecter) : même indépendance vis-à-vis de leur système de commandes que `cabinet/operation`, mais sémantiquement une éjection de réparation/maintenance, pas une location normale.
- `POST /cabinet/ejectByRent` (`cabinetid`, `rentOrderId`, `slotNum`) : **nécessite un `rentOrderId`**, donc dépend forcément d'avoir d'abord créé une commande via leur `Create Rent Order`.

Choix délibéré de rester sur `cabinet/operation?operationType=pop` : BATYEO veut rester la seule source de vérité pour ses locations (voir question de désactivation du flux natif ci-dessous), et c'est le seul des trois qui pilote la borne directement sans dépendre ni créer de commande dans le système du fabricant.

Reste à concevoir avant toute implémentation réelle du flux de location (pas juste le contrat bas niveau) : **quel slot/quelle batterie cibler** au moment d'appeler `operateDevice` — `AsyncBatteryEjector.ejectBatteryAsync()` n'a explicitement pas accès à `Data` (voir son commentaire dans `core/stripe-coordinator.ts`), donc ce choix ne peut pas se faire par une simple lecture locale au moment de l'appel.

## Webhook officiel — repéré le 2026-09-18, forme exacte du push encore à vérifier

La même documentation Apifox expose une section **« Cabinet Event Push »**, jamais repérée avant cette session (la doc précédente ne listait que `cabinet/query` et `cabinet/list`, tous deux lecture seule). Deux endpoints de configuration confirmés :

```
POST https://developer.chargenow.top/cdb-open-api/v1/cabinet/eventPush/config
GET  https://developer.chargenow.top/cdb-open-api/v1/cabinet/eventPush/config/get
```

Ils permettent d'enregistrer une `pushUrl` (globale ou par événement) et de s'abonner à : `CABINET_ONLINE`, `CABINET_OFFLINE`, `CABINET_STATUS`, `BATTERY_IN`, **`BATTERY_BORROW_OUT`** (la sortie d'une batterie — exactement ce qui manquait pour une réconciliation en temps réel plutôt que par sondage), `BATTERY_ABNORMAL_WARNING`, `BATTERY_POPUP`, `ADMIN_RENTAL_ORDER`, `POS_INFO_STATUS`.

**Non encore vérifié** : le endpoint documentant le contenu du push lui-même (ce que ChargeNow envoie réellement vers `pushUrl` — schéma exact, signature éventuelle, idempotence) existe dans la doc (« Cabinet Event Push », `POST`) mais son URL n'a pas pu être atteinte — le site de documentation est devenu inaccessible en cours de vérification (timeout, y compris en `curl` brut, probablement une limitation de débit après plusieurs requêtes automatisées). À reprendre avant toute intégration du webhook : tant que le format exact n'est pas confirmé, `core/manufacturer.ts` continue de ne traiter aucun événement entrant comme fiable par défaut (voir « Ambiguïtés documentaires » plus haut).

## Préparé côté BATYEO en attendant, sans rien deviner sur le contrat fabricant

- `core/ejection-log.ts` : `EjectionLogReader` (contrat seul, comme `AsyncBatteryEjector` dans `core/stripe-coordinator.ts`) + `suggestEjectionMatches`, une fonction pure qui associe chaque location au résultat physique inconnu (`physicalState==='UNKNOWN'`) à l'entrée la plus plausible d'un log d'éjection (forme observée dans le panneau admin : PID, borne, slot, batterie, opérateur, horodatage). Ne s'applique jamais automatiquement : seule `resolveEjectionConfirmed`/`resolveEjectionFailed` change l'état, exactement comme aujourd'hui. Aucun appel réseau n'est fait tant qu'aucun lecteur réel n'est branché.
- `compareManufacturerSnapshot` (`core/manufacturer-sync.ts`) distingue désormais une batterie disparue du snapshot fournisseur mais expliquée par une location BATYEO récente (`MISSING_BATTERY`, bruit attendu) d'une batterie disparue sans aucune location BATYEO pour l'expliquer (`UNEXPLAINED_SLOT_CHANGE`, alerte HIGH) — un signal fort de location « étrangère » passée par le flux natif du fabricant, construit uniquement à partir de `cabinet/query`, déjà confirmé.
- `Station.rentalsBlocked` : un interrupteur de maintenance côté serveur BATYEO (`station/block-rentals`, `station/unblock-rentals`), indépendant de tout `No Lease` fabricant. `RentalEngine.create` le respecte.
- **Non implémenté volontairement** : la télémétrie enrichie vue dans le panneau admin (température batterie, type de câble, versions firmware, historique fin de connectivité) n'est **pas** ajoutée à `ManufacturerBatterySnapshot`/`StationProviderSnapshot`, car ces champs viennent de `cdb-web-api` (panneau interne) et n'ont aucune confirmation d'existence sur `cdb-open-api` (le contrat public documenté). Les ajouter maintenant reviendrait à deviner un contrat non confirmé — voir la règle déjà en vigueur plus haut dans ce document.

## Cas BJH02347

La réponse historiquement observée `code: 2002`, message `QR code unbound device.` est conservée comme erreur fournisseur typée avec son code et son message. BATYEO ne lui attribue aucune signification opérationnelle définitive sans confirmation documentaire.

## Vérification externe restante

- ~~Credentials OpenAccount/Bajie valides pour l'Open API~~ — obtenus et confirmés fonctionnels le 2026-09-18.
- ~~Confirmation Basic versus OAuth2/Bearer pour les routes cabinet~~ — confirmé : Basic.
- ~~Équivalent `operationType=pop` de `cdb-web-api` confirmé (ou non) sur `cdb-open-api`~~ — confirmé le 2026-09-18, voir section dédiée plus haut.
- ~~Fixtures réelles anonymisées pour valider les champs optionnels et unités~~ — une fixture réelle capturée et intégrée en test de régression (`shop.address` absent).
- Désactivation du flux de location natif du fabricant (prix/caution/QR propres à ChargeNow, vus dans le panneau admin) pour ce compte marchand — question posée, réponse en attente.
- Autorisation explicite séparée avant toute future commande physique. `MANUFACTURER_ALLOW_PHYSICAL_ACTIONS=false` reste obligatoire dans cette phase.
