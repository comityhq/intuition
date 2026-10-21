import cron from "node-cron";
import { closeStaleTickets } from "./jobs/closeStale.js";
import { summarizeAllTickets } from "./jobs/summarizeTickets.js";

cron.schedule("0 3 * * *", closeStaleTickets);
// Keep inbox previews fresh.
cron.schedule("* * * * *", summarizeAllTickets);
