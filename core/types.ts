import type { PricingStrategy } from './pricing';
import type { RentalState } from './state-machine';
import type { StationMedia } from './media';
import type { StationDisplayConfigRecord } from './station-runtime';
import type { StationHeartbeat } from './heartbeat';
export interface StationHeartbeatRecord extends StationHeartbeat { id:string; }
export const ROLES = ['SUPER_ADMIN','ADMIN','OPERATIONS','FINANCE','SUPPORT','PARTNER_ADMIN','PARTNER_USER'] as const;
export type Role = typeof ROLES[number];
export interface User { id:string; email:string; name:string; role:Role; partnerId:string|null; passwordHash:string; disabledAt?:number|null; authVersion?:number; }
export interface Partner { id:string; name:string; city:string; /** Taux de commission propre au partenaire. null = ce partenaire suit le taux de la grille tarifaire active. */ commissionBps:number|null; }
export interface Venue { id:string; partnerId:string; name:string; city:string; address:string; category:string; hours:string; latitude?:number|null; longitude?:number|null; }
export type FailureMode = 'none'|'ejection'|'timeout'|'payment';
export interface Station { id:string; publicId:string; venueId:string; partnerId:string; online:boolean; failure:FailureMode; capacity:number; provider?:'mock'|'manufacturer'; providerDeviceId?:string|null; providerStatus?:string|null; providerLastSyncedAt?:number|null; lastSeenAt?:number|null; stripeTerminalLocationId?:string|null; stripeTerminalLocationUpdatedAt?:number|null; rentalsBlocked?:boolean; rentalsBlockedReason?:string|null; rentalsBlockedAt?:number|null; archivedAt?:number|null; }
export interface Battery { id:string; charge:number; status:'AVAILABLE'|'RENTED'|'MAINTENANCE'|'LOST'; }
export interface Slot { id:string; stationId:string; batteryId:string|null; position:number; }
export const PAYMENT_STATES = ['PENDING','AUTHORIZING','AUTHORIZED','CAPTURING','CAPTURED','RELEASING','RELEASED','FAILED','UNKNOWN'] as const;
export type PaymentState = typeof PAYMENT_STATES[number];
export const PHYSICAL_STATES = ['IDLE','EJECTING','EJECTED','RETURN_PENDING','RETURNED','FAILED','UNKNOWN'] as const;
export type PhysicalState = typeof PHYSICAL_STATES[number];
export interface Rental { id:string; customerId:string; partnerId:string; stationId:string; batteryId:string|null; returnStationId:string|null; state:RentalState; paymentState?:PaymentState; physicalState?:PhysicalState; createdAt:number; startedAt:number|null; returnedAt:number|null; deadline:number|null; pricing:PricingStrategy; amountCents:number; commissionCents:number; idempotencyKey:string; contactEmail?:string|null; error:string|null; simulatedMinutes:number; }
export interface RentalEvent { id:string; rentalId:string; at:number; type:string; detail:string; }
export type PaymentProviderName = 'mock'|'stripe';
export interface Payment { id:string; rentalId:string; authorizedCents:number; capturedCents:number; releasedCents:number; refundedCents?:number; disputedAt?:number|null; status:PaymentState; provider?:PaymentProviderName; providerReference?:string|null; error?:string|null; requestedCents?:number; }
export interface TermsAcceptance {id:string; rentalId:string; version:string; acceptedAt:number; customerId:string;}
export interface SupportTicket {id:string; partnerId:string|null; email:string; subject:string; message:string; status:'OPEN'|'RESOLVED'; createdAt:number; rentalId?:string|null; stationId?:string|null; batteryId?:string|null; paymentId?:string|null;}
export interface AuditLog {id:string; userId:string; action:string; at:number;}
export interface Session {id:string; userId:string; expiresAt:number; authVersion?:number;}
export interface CustomerSession {id:string; customerId:string; expiresAt:number;}
/** Short-lived, single-use bridge from a web session to a fresh mobile session — never the session secret itself. */
export interface CustomerHandoffToken {id:string; customerId:string; createdAt:number; expiresAt:number; usedAt:number|null;}
export interface WebhookEvent {id:string; source:string; externalId:string; payloadHash:string; payload:unknown; receivedAt:number; processedAt:number|null; status:'RECEIVED'|'UNTRUSTED'|'PROCESSED'|'FAILED'; error:string|null;}
export type ManufacturerName='BAJIE';
export interface StationProviderLink {id:string;stationId:string;manufacturer:ManufacturerName;externalId:string;active:boolean;createdAt:number;updatedAt:number;}
/** Latest normalized provider observation. Documented vendor values remain telemetry, never domain truth. */
export interface StationProviderSnapshot {id:string;linkId:string;stationId:string;syncedAt:number;online:boolean;totalSlots:number;emptySlots:number;busySlots:number;availability:number;signal:string;deviceType:string;ip:string;shopId:string;shopName:string;shopAddress:string;slots:{position:number;batteryId:string|null;voltage:number|null}[];}
export type ReconciliationKind='STATION_STATUS'|'BATTERY_COUNT'|'AVAILABILITY'|'SLOT_MISMATCH'|'UNKNOWN_SLOT'|'UNKNOWN_BATTERY'|'MISSING_BATTERY'|'UNEXPLAINED_SLOT_CHANGE'|'PROVIDER_ERROR'|'MALFORMED_PROVIDER_RESPONSE';
export interface ReconciliationRecord {id:string;stationId:string;linkId:string;kind:ReconciliationKind;position:number|null;localValue:unknown;providerValue:unknown;status:'OPEN'|'RESOLVED';firstDetectedAt:number;lastDetectedAt:number;resolvedAt:number|null;}
export type ProviderHealth='HEALTHY'|'DEGRADED'|'DOWN'|'UNKNOWN';
export interface ManufacturerSyncRun {id:string;provider:ManufacturerName;trigger:'SCHEDULED'|'MANUAL'|'WEBHOOK'|'ON_DEMAND';requestedBy:string|null;startedAt:number;completedAt:number|null;status:'RUNNING'|'COMPLETED'|'PARTIAL'|'FAILED';total:number;succeeded:number;failed:number;mismatches:number;errorSummary:{stationId:string;kind:string}[];}
export interface RuntimeCredentialRecord {id:string;runtimeId:string;stationId:string;partnerId:string;digest:string;version:number;createdAt:number;lastUsedAt:number|null;revokedAt:number|null;}
export interface RuntimeEnrollmentTokenRecord {id:string;stationId:string;partnerId:string;digest:string;createdAt:number;expiresAt:number;usedAt:number|null;}
export interface HardwareDiscoveryRecord {id:string;stationId:string;runtimeId:string;collectedAt:number;report:unknown;}
export interface StationCapabilityRecord {id:string;stationId:string;capability:string;status:string;source:string;verifiedAt:number|null;evidence:string|null;version:string|null;}
export interface PartnerUser {id:string; userId:string; partnerId:string;}
export interface RateLimit {id:string; count:number; expiresAt:number;}
export interface Data { users:User[]; partners:Partner[]; venues:Venue[]; stations:Station[]; slots:Slot[]; batteries:Battery[]; rentals:Rental[]; events:RentalEvent[]; payments:Payment[]; pricing:PricingStrategy[]; terms:TermsAcceptance[]; tickets:SupportTicket[]; audits:AuditLog[]; sessions:Session[]; partnerUsers:PartnerUser[]; limits:RateLimit[]; customerSessions:CustomerSession[]; customerHandoffTokens:CustomerHandoffToken[]; webhookEvents:WebhookEvent[]; stationProviderLinks:StationProviderLink[]; stationProviderSnapshots:StationProviderSnapshot[]; reconciliationRecords:ReconciliationRecord[]; manufacturerSyncRuns:ManufacturerSyncRun[]; runtimeCredentials:RuntimeCredentialRecord[]; runtimeEnrollmentTokens:RuntimeEnrollmentTokenRecord[]; hardwareDiscoveryReports:HardwareDiscoveryRecord[]; stationCapabilities:StationCapabilityRecord[]; media:StationMedia[]; displayConfigs:StationDisplayConfigRecord[]; stationHeartbeats:StationHeartbeatRecord[]; }
export const emptyData = ():Data => ({users:[],partners:[],venues:[],stations:[],slots:[],batteries:[],rentals:[],events:[],payments:[],pricing:[],terms:[],tickets:[],audits:[],sessions:[],partnerUsers:[],limits:[],customerSessions:[],customerHandoffTokens:[],webhookEvents:[],stationProviderLinks:[],stationProviderSnapshots:[],reconciliationRecords:[],manufacturerSyncRuns:[],runtimeCredentials:[],runtimeEnrollmentTokens:[],hardwareDiscoveryReports:[],stationCapabilities:[],media:[],displayConfigs:[],stationHeartbeats:[]});
export type Actor = {id:string;role:Role;partnerId:string|null};
