import type {RawRuleOf} from '@casl/ability';
import type {AppAbility} from './index.ts';
export interface Actor {userId:string;organizationId?:string;roles:readonly string[]}
// Project owned. Populate only from a verified session and server-loaded membership.
// Add tenant/owner conditions for each project model; the initial policy denies all actions.
export function rulesForActor(_actor:Actor):RawRuleOf<AppAbility>[]{return [];}
