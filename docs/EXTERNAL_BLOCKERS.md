# Intégration Bajie / ChargeNow — points externes à confirmer

État : adapter **READ-ONLY** implémenté sur la documentation publique consultée le 12 septembre 2026.

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
- Aucun mécanisme officiel de signature, identifiant d’événement ou contrat webhook fabricant n’a été confirmé. Le récepteur BATYEO conserve donc ces événements comme non fiables, les déduplique par empreinte interne du payload et ne les utilise jamais directement pour modifier l’état métier. Une lecture API documentée est déclenchée pour réconciliation lorsque le provider est configuré.

## Synchronisation BATYEO

- Les associations sont stockées par couple `manufacturer + externalId` avec unicité en base, afin de pouvoir accueillir plusieurs fabricants sans confondre leurs identifiants.
- Le dernier snapshot est normalisé et interne. Le JSON fournisseur brut n’est pas exposé aux clients.
- Une synchronisation met à jour uniquement la télémétrie provider et les divergences. Elle ne remplace pas automatiquement l’état métier, les slots ou les batteries BATYEO.
- Les retries bornés concernent uniquement les lectures ayant échoué par timeout ou indisponibilité temporaire. Aucune commande physique n’est implémentée.
- `pnpm manufacturer:check` est prêt pour un environnement staging : il exécute uniquement `cabinet/query` puis `cabinet/list`, affiche des métriques anonymisées et peut capturer des fixtures dépersonnalisées avec `MANUFACTURER_CAPTURE_FIXTURE=true` et `MANUFACTURER_FIXTURE_PATH=/chemin/fixtures`.
- Le scheduler appelle `POST /api/core/internal/manufacturer/sync` avec `Authorization: Bearer $MANUFACTURER_SYNC_SECRET`. Le verrou est enregistré dans `ManufacturerSyncRun` et expire après dix minutes pour permettre la récupération d’un worker interrompu.

## Commande d'éjection — piste trouvée le 2026-09-18, encore à confirmer

En inspectant le panneau admin marchand (`admin.chargenow.top/web-new/`, compte propriétaire du projet), une action « Eject »/« Eject all battery » existe réellement sur la fiche d'une borne (onglet Slot). Le bundle JS de ce panneau montre l'appel réseau exact :

```
GET https://admin.chargenow.top/cdb-web-api/v1/cdb/cabinet/operation
    ?cId=<cabinetId>&operationType=pop&kakou=<numéro de slot>
```
(`operationType=popall` / `popallForAuth` / `popallForNoAuth` pour éjecter tout le caisson d'un coup ; `operationType=unlock` existe aussi, utilisé par l'action de déblocage manuel.)

**Ce que ça confirme** : une commande d'éjection existe bien côté fabricant, au niveau firmware/backend — ce n'était pas garanti avant cette vérification.

**Ce que ça ne confirme pas** : ce endpoint vit sous `cdb-web-api` (l'API interne du panneau web, authentifiée par session de connexion humaine + captcha), pas sous `cdb-open-api` (l'API publique documentée que le serveur BATYEO est censé appeler avec les credentials marchand Basic/OAuth2). Rien ne garantit que ce même `operationType=pop` est exposé côté `cdb-open-api`, ni sous quelle authentification. C'est précisément la question à poser au fabricant, de façon nettement plus précise qu'avant : *« Le panneau admin appelle `GET /cdb-web-api/v1/cdb/cabinet/operation?operationType=pop` pour éjecter une batterie — un équivalent existe-t-il sur l'Open API publique, avec quelle authentification ? »*

Aucune tentative d'éjection réelle n'a été faite pendant cette vérification (le bouton n'a jamais été cliqué) — `MANUFACTURER_ALLOW_PHYSICAL_ACTIONS` reste `false` et cette découverte ne le change pas.

## Préparé côté BATYEO en attendant, sans rien deviner sur le contrat fabricant

- `core/ejection-log.ts` : `EjectionLogReader` (contrat seul, comme `AsyncBatteryEjector` dans `core/stripe-coordinator.ts`) + `suggestEjectionMatches`, une fonction pure qui associe chaque location au résultat physique inconnu (`physicalState==='UNKNOWN'`) à l'entrée la plus plausible d'un log d'éjection (forme observée dans le panneau admin : PID, borne, slot, batterie, opérateur, horodatage). Ne s'applique jamais automatiquement : seule `resolveEjectionConfirmed`/`resolveEjectionFailed` change l'état, exactement comme aujourd'hui. Aucun appel réseau n'est fait tant qu'aucun lecteur réel n'est branché.
- `compareManufacturerSnapshot` (`core/manufacturer-sync.ts`) distingue désormais une batterie disparue du snapshot fournisseur mais expliquée par une location BATYEO récente (`MISSING_BATTERY`, bruit attendu) d'une batterie disparue sans aucune location BATYEO pour l'expliquer (`UNEXPLAINED_SLOT_CHANGE`, alerte HIGH) — un signal fort de location « étrangère » passée par le flux natif du fabricant, construit uniquement à partir de `cabinet/query`, déjà confirmé.
- `Station.rentalsBlocked` : un interrupteur de maintenance côté serveur BATYEO (`station/block-rentals`, `station/unblock-rentals`), indépendant de tout `No Lease` fabricant. `RentalEngine.create` le respecte.
- **Non implémenté volontairement** : la télémétrie enrichie vue dans le panneau admin (température batterie, type de câble, versions firmware, historique fin de connectivité) n'est **pas** ajoutée à `ManufacturerBatterySnapshot`/`StationProviderSnapshot`, car ces champs viennent de `cdb-web-api` (panneau interne) et n'ont aucune confirmation d'existence sur `cdb-open-api` (le contrat public documenté). Les ajouter maintenant reviendrait à deviner un contrat non confirmé — voir la règle déjà en vigueur plus haut dans ce document.

## Cas BJH02347

La réponse historiquement observée `code: 2002`, message `QR code unbound device.` est conservée comme erreur fournisseur typée avec son code et son message. BATYEO ne lui attribue aucune signification opérationnelle définitive sans confirmation documentaire.

## Vérification externe restante

- Credentials OpenAccount/Bajie valides pour l'Open API (distincts du compte de connexion au panneau admin web).
- Confirmation Basic versus OAuth2/Bearer pour les routes cabinet.
- Équivalent `operationType=pop` de `cdb-web-api` confirmé (ou non) sur `cdb-open-api`, avec son authentification — voir section ci-dessus.
- Fixtures réelles anonymisées pour valider les champs optionnels et unités.
- Autorisation explicite séparée avant toute future commande physique. `MANUFACTURER_ALLOW_PHYSICAL_ACTIONS=false` reste obligatoire dans cette phase.
