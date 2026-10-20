/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as analytics from "../analytics.js";
import type * as crons from "../crons.js";
import type * as ledger from "../ledger.js";
import type * as lib_analytics from "../lib/analytics.js";
import type * as lib_core from "../lib/core.js";
import type * as lib_guard from "../lib/guard.js";
import type * as lib_meter from "../lib/meter.js";
import type * as lib_post from "../lib/post.js";
import type * as lib_totals from "../lib/totals.js";
import type * as recon from "../recon.js";
import type * as sim from "../sim.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  analytics: typeof analytics;
  crons: typeof crons;
  ledger: typeof ledger;
  "lib/analytics": typeof lib_analytics;
  "lib/core": typeof lib_core;
  "lib/guard": typeof lib_guard;
  "lib/meter": typeof lib_meter;
  "lib/post": typeof lib_post;
  "lib/totals": typeof lib_totals;
  recon: typeof recon;
  sim: typeof sim;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
