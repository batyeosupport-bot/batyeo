/** Stable client contract shared by the web rental flow and the future mobile app. */
export type CustomerRentalState =
  | 'CREATED' | 'PAYMENT_AUTH' | 'EJECTING' | 'ACTIVE' | 'RETURN_PENDING'
  | 'RETURNED' | 'COMPLETED' | 'PAYMENT_FAILED' | 'EJECTION_FAILED'
  | 'CANCELLED' | 'EXPIRED' | 'OVERDUE' | 'ERROR';

export interface CustomerRentalSnapshot {
  id: string;
  state: CustomerRentalState;
  batteryId: string | null;
  createdAt: number;
  startedAt: number | null;
  returnedAt: number | null;
  deadline: number | null;
  elapsedMs: number;
  currentCents: number;
  amountCents: number;
  returnStationId?: string | null;
  error?: string | null;
  pricing: {
    hourlyCents: number;
    capCents: number;
    depositCents: number;
    deadlineHours: number;
  };
  station?: {
    id: string;
    publicId: string;
    venue: {name:string;city:string;address:string;hours:string};
  };
  payment?: {
    authorizedCents:number;
    capturedCents:number;
    releasedCents:number;
    status:string;
  };
}

export interface CustomerStationSnapshot {
  id:string;
  publicId:string;
  online:boolean;
  available:number;
  freeSlots:number;
  venue:{name:string;city:string;address:string;hours:string;latitude?:number;longitude?:number};
}

export interface CustomerPublicResponse {
  stations:CustomerStationSnapshot[];
  pricing:CustomerRentalSnapshot['pricing'];
  demo:boolean;
}

export interface CustomerSessionResponse {
  rental: CustomerRentalSnapshot | null;
  serverTime: number;
}
export interface CustomerHistoryResponse {
  rentals: CustomerRentalSnapshot[];
  serverTime: number;
}

/**
 * Every client must treat BATYEO Core as authoritative. Prices and states are
 * display-only here; mutations accept only station/idempotency/terms inputs.
 */
export interface StartRentalRequest {
  stationPublicId: string;
  termsAccepted: true;
  idempotencyKey: string;
}

export interface CustomerHandoffRequest {
  rentalId?: string;
}

export interface CustomerHandoffResponse {
  handoffToken: string;
  expiresAt: number;
  rental: CustomerRentalSnapshot | null;
}
