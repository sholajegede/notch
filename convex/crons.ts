import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();
crons.interval("report changed totals", { minutes: 1 }, internal.recon.reportDue, {});
crons.daily("reconcile every account", { hourUTC: 2, minuteUTC: 0 }, internal.recon.reconcileAll, {});
export default crons;
