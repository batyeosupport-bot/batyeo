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
