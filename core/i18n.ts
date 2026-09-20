/**
 * Runtime translation contract for the station display.
 *
 * RUNTIME_STRING_KEYS is the full screen-by-screen inventory a station kiosk
 * has to be able to render: idle screen, language picker, pricing, the card and
 * app payment paths, ejection, return, receipt, and every failure state. It is
 * the checklist that keeps a translation pack from silently shipping half a
 * flow — `missingStringKeys` reports what a pack still owes before publication.
 */
export const RUNTIME_STRING_KEYS=['additionalPayment','additionalPaymentDesc','back','bigNoBatteries','bigStationUnavailable','cardExpirationYearInvalid','cardNotSupportedTips','chargeCablesIncluded','checkPrice','checkSent','choosePayment','close','confirmed','cost','day','deposit','depositAmountSmallTips','displayQrCode','downloadApp','emptySlots','endRental','feeDetails','feeRates','followTheLink','forgetReturnTips','freeTimeTips','getCheck','getCheckDesc','goToPayment','hour','howItWorks','howItWorksPricing','iHaveRead','info','infoTips','initialization','initializationError','insertCard','insertCardTips','insertYourPowerBank','mainHomeTips','max','maxRentalPeriod','minute','nfc','offline','only','open','or','orderApprovedSubTitle','orderApprovedTitle','orderProcessingSubTitle','orderProcessingTitle','payingByApp','payingByCard','paymentError','paymentFailed','paymentSuccessful','paymentWasSuccessful','perDay','perDayTips','perMinutes','perMinutesTips','pleaseReverseScanCode','pleaseTapSwipe','pleaseWait','posNotCompletedConnectTips','posReady','powerBanks','priceInfo','priceInfoSymbolAfter','prices','processingYourOrder','refundAmount','refundAmountDesc','removeYourCard','rentAPowerBank','rentPowerBank','rentTime','rentTimeUnit','rentTitle','rentalDuration','rentalSuccessfulMiddleTitle','rentalSuccessfulSubTitle','rentalSuccessfulTitle','returnMain','returnPower','returnPowerBank','returnSuccessfulAmountCharged','returnSuccessfulContactUs','returnSuccessfulDuration','returnSuccessfulReceipt','returnSuccessfulTitle','scanQr','scanQrCode','scanQrCodeTips','scanQrTitle','selectLanguage','send','stationOffline','stationsMap','swipeCard','swipeCardTips','takePowerBank','tapSwipeCard','tapSwipeCardTitle','tapYourCard','termOfService','thankChoosing','thankYouUsing','troublesWithBattery','troublesWithBatteryTips','tryAgain','upTo'] as const;
export type RuntimeStringKey=typeof RUNTIME_STRING_KEYS[number];
export interface RuntimeLocale {code:string;label:string;locale:string;}
export interface RuntimeTranslations {defaultLocale:string;available:readonly RuntimeLocale[];strings:Readonly<Record<string,Readonly<Record<string,string>>>>;}
export const MAX_RUNTIME_LOCALES=40,MAX_RUNTIME_STRING_LENGTH=2000;
export function validateTranslations(translations:RuntimeTranslations):RuntimeTranslations {
 if(!translations.defaultLocale?.trim())throw new Error('Runtime default locale required.');
 if(!translations.available.length||translations.available.length>MAX_RUNTIME_LOCALES)throw new Error('Invalid runtime locale list.');
 const seen=new Set<string>();
 for(const locale of translations.available){
  if(!locale.code?.trim()||!locale.locale?.trim()||!locale.label?.trim())throw new Error('Invalid runtime locale entry.');
  if(seen.has(locale.locale))throw new Error(`Duplicate runtime locale ${locale.locale}.`);
  seen.add(locale.locale);
 }
 if(!seen.has(translations.defaultLocale))throw new Error('Default locale absent from the available locales.');
 for(const locale of translations.available){
  const dictionary=translations.strings[locale.locale];
  if(!dictionary)throw new Error(`Missing translation dictionary for ${locale.locale}.`);
  for(const [key,value] of Object.entries(dictionary)){
   if(typeof value!=='string'||value.length>MAX_RUNTIME_STRING_LENGTH)throw new Error(`Invalid translation value for ${locale.locale}.${key}.`);
  }
 }
 if(!Object.keys(translations.strings[translations.defaultLocale]??{}).length)throw new Error('Default locale dictionary is empty.');
 return translations;
}
/** Keys a locale still has to translate before it can be offered on a station. */
export function missingStringKeys(translations:RuntimeTranslations,locale:string):RuntimeStringKey[]{
 const dictionary=translations.strings[locale]??{};
 return RUNTIME_STRING_KEYS.filter(key=>!dictionary[key]?.trim());
}
/** A partially translated locale still renders: unknown keys fall back to the default locale. */
export function resolveStrings(translations:RuntimeTranslations,locale:string):Record<string,string>{
 return {...translations.strings[translations.defaultLocale],...(translations.strings[locale]??{})};
}

/**
 * Copy for the customer-facing web rental flow (components/batyeo/rental.tsx) — a separate,
 * smaller inventory from RUNTIME_STRING_KEYS, because the kiosk's own list assumes a physical
 * card/NFC terminal (insertCard, swipeCard…) that has no equivalent in a browser tab. Kept in the
 * same admin editor and the same per-station RuntimeTranslations.strings dictionary (still just
 * Record<string,string>, nothing stops the two lists sharing it), but tracked separately so a
 * station's "kiosk translation completeness" isn't diluted by web-only keys it may never need.
 *
 * WEB_DEFAULT_STRINGS_FR is the load-bearing part: unlike the kiosk, which has no built-in
 * fallback and shows the raw key name when a dictionary is empty (see MainActivity.kt's
 * `translate()`), this page collects real payments and must never degrade to that. A station
 * with zero admin-configured translations still renders exactly the current French copy — other
 * locales are additive, never a prerequisite.
 */
export const WEB_STRING_KEYS=['web_intro_eyebrow','web_intro_perHour','web_intro_max','web_intro_deposit','web_intro_returnWithin','web_intro_acceptPrefix','web_intro_acceptTermsLink','web_intro_acceptSuffix','web_intro_cta','web_intro_securityNote','web_intro_offline','web_intro_noBattery','web_intro_available','web_busy_eyebrow','web_busy_authorizing','web_busy_preparing','web_busy_stayNearby','web_busy_preparingRental','web_busy_dontClose','web_active_eyebrow','web_active_title','web_active_body','web_active_duration','web_active_currentPrice','web_active_returnBefore','web_active_startStation','web_active_reference','web_active_overdue','web_active_cta','web_receipt_eyebrow','web_receipt_title','web_receipt_body','web_receipt_amount','web_receipt_totalDuration','web_receipt_depositReleased','web_receipt_amountAuthorized','web_receipt_reference','web_receipt_returnedAt','web_receipt_note','web_receipt_print','web_receipt_newRental','web_common_charged','web_common_support','web_common_otherStation','web_failed_eyebrow','web_failed_title','web_failed_fallback','web_failed_released','web_failed_retry','web_returning_eyebrow','web_returning_title','web_returning_body','web_review_eyebrow','web_review_title','web_review_body','web_review_fallback','web_cancelled_eyebrowCancelled','web_cancelled_eyebrowExpired','web_cancelled_titleCancelled','web_cancelled_titleExpired','web_cancelled_body','web_lost_eyebrow','web_lost_title','web_lost_body','web_intro_emailLabel','web_intro_emailPlaceholder','web_intro_emailHelp','web_mode_bannerMock','web_mode_bannerTest','web_intro_securityNoteTest','web_intro_securityNoteLive','web_intro_acceptSuffixLive','web_receipt_noteTest','web_receipt_noteLive'] as const;
export type WebStringKey=typeof WEB_STRING_KEYS[number];
export const WEB_DEFAULT_STRINGS_FR:Readonly<Record<WebStringKey,string>>={
 web_intro_eyebrow:'VOUS ÊTES AU BON ENDROIT',web_intro_perHour:'/ heure commencée',web_intro_max:'Maximum',web_intro_deposit:'Caution temporaire',web_intro_returnWithin:'Retour sous',
 web_intro_acceptPrefix:'J’accepte les ',web_intro_acceptTermsLink:'conditions de location',web_intro_acceptSuffix:' et l’autorisation simulée de {amount}.',
 web_intro_cta:'PRENDRE UNE BATTERIE',web_intro_securityNote:'Paiement simulé. Aucune carte nécessaire.',web_intro_offline:'Station hors ligne. Choisissez une autre station.',web_intro_noBattery:'Aucune batterie disponible pour le moment.',web_intro_available:'{count} batterie{plural} disponible{plural}',
 web_busy_eyebrow:'UN INSTANT, ON S’OCCUPE DE TOUT',web_busy_authorizing:'Autorisation simulée…',web_busy_preparing:'Préparation de votre batterie…',web_busy_stayNearby:'Restez près de la station. Ne relancez pas la demande.',web_busy_preparingRental:'Préparation de votre location…',web_busy_dontClose:'Ne fermez pas cette page. Ça ne prend que quelques secondes.',
 web_active_eyebrow:'VOTRE BATTERIE EST PRÊTE',web_active_title:'La suite vous appartient.',web_active_body:'Récupérez la batterie à la station. Gardez cette page pour suivre votre location.',web_active_duration:'Durée de location',web_active_currentPrice:'Prix actuel · max. {cap}',web_active_returnBefore:'À rendre avant',web_active_startStation:'Station de départ',web_active_reference:'Référence',
 web_active_overdue:'Le délai de retour est dépassé. Rendez votre batterie dès que possible : le plafond tarifaire reste inchangé, mais si elle n’est toujours pas rendue 48 h après ce message, votre caution de {deposit} sera intégralement débitée pour perte définitive.',
 web_active_cta:'Trouver une station pour la rendre',
 web_receipt_eyebrow:'BATTERIE RENDUE',web_receipt_title:'À la prochaine recharge.',web_receipt_body:'Votre location est terminée.',web_receipt_amount:'Montant final simulé',web_receipt_totalDuration:'Durée totale',web_receipt_depositReleased:'Caution libérée',web_receipt_amountAuthorized:'Montant autorisé',web_receipt_reference:'Référence',web_receipt_returnedAt:'Retour',web_receipt_note:'Reçu de démonstration. Aucun débit bancaire.',web_receipt_print:'Imprimer / enregistrer le reçu',web_receipt_newRental:'Nouvelle location',
 web_common_charged:'Montant débité', web_common_support:'Contacter l’assistance', web_common_otherStation:'Choisir une autre station', web_failed_eyebrow:'ON NE VOUS LAISSE PAS SANS RÉPONSE', web_failed_title:'Cette fois,\nça n’a pas fonctionné.', web_failed_fallback:'La location a échoué.', web_failed_released:'Autorisation libérée', web_failed_retry:'Réessayer', web_returning_eyebrow:'RETOUR EN COURS', web_returning_title:'On calcule\nvotre montant final.', web_returning_body:'Votre batterie a bien été reçue. Le reçu apparaîtra ici dans un instant.', web_review_eyebrow:'VÉRIFICATION EN COURS', web_review_title:'Un instant,\non vérifie tout.', web_review_body:'Un aléa technique nous empêche de confirmer automatiquement cette location. Aucun montant n’est débité tant que ce n’est pas résolu. Notre équipe a été alertée.', web_review_fallback:'Vérification en cours.', web_cancelled_eyebrowCancelled:'LOCATION ANNULÉE', web_cancelled_eyebrowExpired:'DEMANDE EXPIRÉE', web_cancelled_titleCancelled:'Cette location\na été annulée.', web_cancelled_titleExpired:'Cette demande\na expiré.', web_cancelled_body:'Aucun montant n’a été débité.', web_lost_eyebrow:'BATTERIE JAMAIS RESTITUÉE', web_lost_title:'Votre caution\na été débitée.', web_lost_body:'La batterie n’a pas été rendue dans le délai prévu. La caution a été intégralement débitée pour compenser la perte définitive.',
 web_intro_emailLabel:'Votre email (facultatif)',web_intro_emailPlaceholder:'vous@exemple.fr',web_intro_emailHelp:'Pour recevoir votre reçu et être prévenu avant tout débit de la caution. Vous pouvez louer sans le donner.',
 web_mode_bannerMock:'MODE DÉMO · AUCUN PAIEMENT RÉEL', web_mode_bannerTest:'MODE TEST · CARTE DE TEST UNIQUEMENT', web_intro_securityNoteTest:'Paiement Stripe en mode test. Aucun montant réel n’est débité.', web_intro_securityNoteLive:'Paiement sécurisé par Stripe. La caution est une empreinte, débitée seulement en cas de non-restitution.', web_intro_acceptSuffixLive:' et l’empreinte bancaire de {amount}.', web_receipt_noteTest:'Reçu de test. Aucun débit bancaire réel.', web_receipt_noteLive:'Un justificatif vous est également accessible depuis cette page.',
};
/** Keys a locale still owes for the web flow, mirroring missingStringKeys — never includes French, which always has the built-in baseline. */
export function missingWebStringKeys(translations:RuntimeTranslations,locale:string):WebStringKey[]{
 if(locale==='fr-FR')return [];
 const dictionary=translations.strings[locale]??{};
 return WEB_STRING_KEYS.filter(key=>!dictionary[key]?.trim());
}
/** French (built into the code, never dependent on admin configuration) overlaid with whatever an admin has translated for `locale`. Unlike resolveStrings, tolerates translations being entirely absent. */
export function resolveWebStrings(translations:RuntimeTranslations|null,locale:string):Record<WebStringKey,string>{
 return {...WEB_DEFAULT_STRINGS_FR,...(translations?.strings[locale]??{})};
}
