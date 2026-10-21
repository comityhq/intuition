import cron from "node-cron";
import { closeStaleTickets } from "./jobs/closeStale.js";

cron.schedule("0 3 * * *", closeStaleTickets);
