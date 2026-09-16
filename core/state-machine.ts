export const STATES = ['CREATED','PAYMENT_AUTH','EJECTING','ACTIVE','RETURN_PENDING','RETURNED','COMPLETED','PAYMENT_FAILED','EJECTION_FAILED','CANCELLED','EXPIRED','OVERDUE','LOST','ERROR'] as const;
export type RentalState = typeof STATES[number];
const edges: Record<RentalState, readonly RentalState[]> = {
 CREATED: ['PAYMENT_AUTH','PAYMENT_FAILED','CANCELLED','EXPIRED'], PAYMENT_AUTH: ['EJECTING','CANCELLED','ERROR'], EJECTING: ['ACTIVE','EJECTION_FAILED','ERROR'], ACTIVE: ['RETURN_PENDING','OVERDUE','ERROR'], RETURN_PENDING: ['RETURNED','ERROR'], RETURNED: ['COMPLETED','ERROR'], COMPLETED: [], PAYMENT_FAILED: [], EJECTION_FAILED: [], CANCELLED: [], EXPIRED: [], OVERDUE: ['RETURN_PENDING','LOST','ERROR'], LOST: [], ERROR: ['RETURN_PENDING','RETURNED','COMPLETED','CANCELLED']
};
export function transition(from: RentalState, to: RentalState): RentalState {
 if (!edges[from].includes(to)) throw new Error(`Transition interdite : ${from} → ${to}`);
 return to;
}
