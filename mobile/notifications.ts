import * as Notifications from 'expo-notifications';
import {notificationPlan, type NotificationPlan, type NotificationKind} from '../core/mobile';
/** Adapter boundary for Expo Notifications. It is deliberately a no-op until push credentials exist. */
export interface NotificationAdapter {requestPermission():Promise<boolean>;schedule(plan:NotificationPlan):Promise<string|null>;cancel(id:string):Promise<void>;}
export class NoopNotificationAdapter implements NotificationAdapter {async requestPermission(){return false;}async schedule(_plan:NotificationPlan){return null;}async cancel(_id:string){} }
/** On-device reminders only (deadline_reminder). No push credentials, no server, nothing sent remotely. */
export class LocalNotificationAdapter implements NotificationAdapter {
 async requestPermission(){const {status}=await Notifications.requestPermissionsAsync();return status==='granted';}
 async schedule(plan:NotificationPlan){if(plan.scheduledAt===null)return null;return Notifications.scheduleNotificationAsync({content:{title:plan.title,body:plan.body},trigger:{type:Notifications.SchedulableTriggerInputTypes.DATE,date:plan.scheduledAt}});}
 async cancel(id:string){await Notifications.cancelScheduledNotificationAsync(id);}
}
export function notificationFor(kind:NotificationKind,now=Date.now(),deadline:number|null=null){return notificationPlan(kind,now,deadline);}
